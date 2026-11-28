import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeMappings, findLocations, inspect, mapStack, moduleOrder, originalPosition, resolveImport, rewriteImports,
} from "../../web/js-modules.js";
import { findDefinition } from "../../web/js-definitions.js";

const names = new Set(["main.js", "util.js", "lib/math.ts", "lib/io.js"]);

test("an import names a project file relative to the importer, .js naming a .ts too", () => {
  assert.equal(resolveImport("main.js", "./util.js", names), "util.js");
  assert.equal(resolveImport("main.js", "./util", names), "util.js");
  assert.equal(resolveImport("main.js", "./lib/math.js", names), "lib/math.ts");
  assert.equal(resolveImport("lib/io.js", "../util.js", names), "util.js");
  assert.equal(resolveImport("lib/io.js", "./math", names), "lib/math.ts");
  assert.equal(resolveImport("main.js", "../util.js", names), null);
  assert.equal(resolveImport("main.js", "./nothing.js", names), null);
  assert.equal(resolveImport("main.js", "lodash", names), null);
});

test("import specifiers are rewritten, static, re-exported, bare and dynamic", () => {
  const code = 'import { f } from "./a.js";\nimport x, * as y from \'./b.js\';\nimport "./c.js";\n' +
    'export * from "./d.js";\nconst m = await import("./e.js");\nimport z from "pkg";\n';
  const out = rewriteImports(code, (spec) => (spec.startsWith("./") ? `blob:${spec.slice(2, 3)}` : null));
  assert.equal(out, 'import { f } from "blob:a";\nimport x, * as y from \'blob:b\';\nimport "blob:c";\n' +
    'export * from "blob:d";\nconst m = await import("blob:e");\nimport z from "pkg";\n');
});

test("modules are ordered dependencies first; a cycle is an error", () => {
  const files = new Map([
    ["main.js", 'import { f } from "./util.js";\nimport { g } from "./lib/math.js";\n'],
    ["util.js", 'import { g } from "./lib/math.ts";\n'],
    ["lib/math.ts", "export const g = 1;\n"],
    ["unused.js", ""],
  ]);
  assert.deepEqual(moduleOrder(files, "main.js"), ["lib/math.ts", "util.js", "main.js"]);
  files.set("lib/math.ts", 'import "../main.js";\n');
  assert.throws(() => moduleOrder(files, "main.js"), /Circular import: main\.js → util\.js → lib\/math\.ts → main\.js/);
});

test("a place in TypeScript's output is found in the source by its source map", () => {
  // TypeScript's map of `interface P {…}` (3 lines and a blank one) then
  // `const f = (p: P): number => {\n  throw new Error("boom");\n};\nf({ x: 1 });`,
  // output after a "use strict" line.
  const map = decodeMappings(";AAIA,MAAM,CAAC,GAAG,CAAC,CAAI,EAAU,EAAE;IACzB,MAAM,IAAI,KAAK,CAAC,MAAM,CAAC,CAAC;AAC1B,CAAC,CAAC;AACF,CAAC,CAAC,EAAE,CAAC,EAAE,CAAC,EAAE,CAAC,CAAC");
  assert.deepEqual(originalPosition(map, 3, 11), { line: 6, col: 9 }); // new Error
  assert.deepEqual(originalPosition(map, 5, 1), { line: 8, col: 1 }); // f(…)
  assert.equal(originalPosition(map, 9, 1), null);
});

test("a stack trace names the project's files, not Blob URLs, nor the worker's frames", () => {
  const url = "blob:http://127.0.0.1:8080/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
  const stack = `Error: boom\n    at half (${url}:2:9)\n    at ${url}:5:1\n    at async run (http://127.0.0.1:8080/js-worker.js:120:5)`;
  const where = (u, line, col) => (u === url ? { file: "calc.js", line, col: col + 1 } : null);
  assert.equal(mapStack(stack, where), "Error: boom\n    at half (calc.js:2:10)\n    at calc.js:5:2");
});

test("places in stack traces and TypeScript's errors are found", () => {
  const text = "Error: boom\n    at half (lib/calc.js:2:9)\nmain.ts:3:7 - error TS1110: Type expected.\nhttp://x/a.js:1:1";
  assert.deepEqual(findLocations(text).map(({ file, line, col }) => [file, line, col]),
    [["lib/calc.js", 2, 9], ["main.ts", 3, 7]]);
});

test("console.log shows values much as Node does", () => {
  assert.equal(inspect("hi"), "hi");
  assert.equal(inspect([1, "a", [null, undefined]]), '[1, "a", [null, undefined]]');
  assert.equal(inspect({ x: 1, "a-b": { y: "z" } }), '{ x: 1, "a-b": { y: "z" } }');
  assert.equal(inspect(new Map([["k", 1]])), 'Map(1) { "k" => 1 }');
  assert.equal(inspect(new Set([1, 2])), "Set(2) { 1, 2 }");
  assert.equal(inspect(10n), "10n");
  assert.equal(inspect(function f() {}), "[Function: f]");
  class Point { constructor() { this.x = 1; } }
  assert.equal(inspect(new Point()), "Point { x: 1 }");
  const loop = { a: 1 };
  loop.self = loop;
  assert.equal(inspect(loop), "{ a: 1, self: [Circular] }");
});

test("F12 in JavaScript: the nearest declaration, then an import's, then another file's", () => {
  const files = {
    "main.js": 'import { half } from "./calc.js";\nlet n = 1;\nfunction show() {}\nlet m = half(n);\nshow(other);\n',
    "calc.js": "// Halves.\nexport function half(x) {\n  return x / 2;\n}\n",
    "lib.ts": "export const other: number = 2;\ninterface Shape {}\n",
  };
  const pos = (word) => files["main.js"].lastIndexOf(word);
  assert.deepEqual(findDefinition(files, "main.js", "n", pos("n)")), { file: "main.js", line: 2, col: 5 });
  assert.deepEqual(findDefinition(files, "main.js", "show", pos("show")), { file: "main.js", line: 3, col: 10 });
  assert.deepEqual(findDefinition(files, "main.js", "half", pos("half")), { file: "calc.js", line: 2, col: 17 });
  assert.deepEqual(findDefinition(files, "main.js", "other", pos("other")), { file: "lib.ts", line: 1, col: 14 });
  assert.deepEqual(findDefinition(files, "main.js", "Shape", 0), { file: "lib.ts", line: 2, col: 11 });
  assert.equal(findDefinition(files, "main.js", "nothing", 0), null);
});
