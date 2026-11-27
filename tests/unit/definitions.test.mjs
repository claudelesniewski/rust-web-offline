import assert from "node:assert/strict";
import { test } from "node:test";
import { findDefinition } from "../../web/definitions.js";

test("a fn in the same file", () => {
  const main = "fn main() {\n    helper();\n}\n\nfn helper() {}\n";
  assert.deepEqual(findDefinition({ "main.rs": main }, "main.rs", "helper", 20),
    { file: "main.rs", line: 5, col: 4 });
});

test("a struct in another file", () => {
  const files = {
    "main.rs": "mod shapes;\nfn main() { let p = shapes::Point { x: 1 }; }\n",
    "shapes.rs": "// Shapes.\npub struct Point { pub x: i32 }\n",
  };
  assert.deepEqual(findDefinition(files, "main.rs", "Point", 30), { file: "shapes.rs", line: 2, col: 12 });
});

test("the current file comes before others", () => {
  const files = { "a.rs": "fn f() {}\n", "main.rs": "fn main() { f() }\nfn f() {}\n" };
  assert.deepEqual(findDefinition(files, "main.rs", "f", 13), { file: "main.rs", line: 2, col: 4 });
});

test("mod name; leads to the module's file", () => {
  const files = { "main.rs": "mod util;\nfn main() {}\n", "util/mod.rs": "pub fn x() {}\n" };
  assert.deepEqual(findDefinition(files, "main.rs", "util", 5), { file: "util/mod.rs", line: 1, col: 1 });
  const nested = { "a.rs": "mod b;\n", "a/b.rs": "", "b.rs": "" };
  assert.deepEqual(findDefinition(nested, "a.rs", "b", 4), { file: "a/b.rs", line: 1, col: 1 });
});

test("the nearest let above the cursor, not one below", () => {
  const main = "fn main() {\n    let x = 1;\n    let mut x = x + 1;\n    x;\n    let x = 3;\n}\n";
  const pos = main.indexOf("x;");
  assert.deepEqual(findDefinition({ "main.rs": main }, "main.rs", "x", pos), { file: "main.rs", line: 3, col: 13 });
  assert.equal(findDefinition({ "main.rs": main }, "main.rs", "x", 12), null);
});

test("not found", () => {
  const main = "fn main() { println!(\"{}\", nothing); }\n";
  assert.equal(findDefinition({ "main.rs": main }, "main.rs", "nothing", main.length), null);
  assert.equal(findDefinition({ "main.rs": main }, "main.rs", "(", 0), null);
});
