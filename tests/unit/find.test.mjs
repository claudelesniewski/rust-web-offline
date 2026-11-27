import assert from "node:assert/strict";
import { test } from "node:test";
import { find, replaceAll } from "../../web/find.js";

const files = new Map([
  ["main.rs", "fn main() {\n    let crab = Crab::new(); crab.go();\n}\n"],
  ["a.rs", "// CRAB\n"],
  ["b.rs", "nothing here\n"],
]);

test("finds every place, by file, with line and column from 1", () => {
  assert.deepEqual(find(files, "crab").map(({ file, line, col, length }) => [file, line, col, length]), [
    ["a.rs", 1, 4, 4],
    ["main.rs", 2, 9, 4],
    ["main.rs", 2, 16, 4],
    ["main.rs", 2, 29, 4],
  ]);
  assert.equal(find(files, "crab")[1].text, "    let crab = Crab::new(); crab.go();");
});

test("case-sensitive search, and plain strings, not patterns", () => {
  assert.deepEqual(find(files, "Crab", { caseSensitive: true }).map((m) => [m.file, m.col]), [["main.rs", 16]]);
  assert.deepEqual(find(files, "::").map((m) => m.col), [20]);
  assert.deepEqual(find(files, "c.a"), []);
  assert.deepEqual(find(files, ""), []);
});

test("replace all changes only the files with a match", () => {
  assert.deepEqual(replaceAll(files, "crab", "$&x"), new Map([
    ["main.rs", "fn main() {\n    let $&x = $&x::new(); $&x.go();\n}\n"],
    ["a.rs", "// $&x\n"],
  ]));
  assert.deepEqual(replaceAll(files, "crab", "ferris", { caseSensitive: true }), new Map([
    ["main.rs", "fn main() {\n    let ferris = Crab::new(); ferris.go();\n}\n"],
  ]));
  assert.deepEqual(replaceAll(files, "", "x"), new Map());
});
