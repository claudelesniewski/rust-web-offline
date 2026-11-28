import assert from "node:assert/strict";
import { test } from "node:test";
import { findDefinition } from "../../web/python-definitions.js";

const files = {
  "main.py": [
    "import util",
    "from geometry.shapes import Square as Sq, area",
    "from .helpers import shout",
    "",
    "LIMIT = 10",
    "",
    "def run(items):",
    "    for i, item in enumerate(items):",
    "        total: int = area(item)",
    "        with open('x') as fh:",
    "            print(util.double(total), Sq, LIMIT, fh, i, shout)",
    "",
    "class App:",
    "    pass",
  ].join("\n"),
  "util.py": "def double(x):\n    return 2 * x\n",
  "geometry/__init__.py": "",
  "geometry/shapes.py": "class Square:\n    pass\n\narea = lambda s: s.side ** 2\n",
  "helpers.py": "async def shout(s):\n    return s.upper()\n",
};
const use = files["main.py"].lastIndexOf("print(");
const find = (word, pos = use) => findDefinition(files, "main.py", word, pos);

test("a def or class in the file, then a binding above the cursor", () => {
  assert.deepEqual(find("App"), { file: "main.py", line: 13, col: 7 });
  assert.deepEqual(find("run"), { file: "main.py", line: 7, col: 5 });
  assert.deepEqual(find("LIMIT"), { file: "main.py", line: 5, col: 1 });
  assert.deepEqual(find("total"), { file: "main.py", line: 9, col: 9 });
  assert.deepEqual(find("item"), { file: "main.py", line: 8, col: 12 });
  assert.deepEqual(find("i"), { file: "main.py", line: 8, col: 9 });
  assert.deepEqual(find("fh"), { file: "main.py", line: 10, col: 27 });
  assert.equal(find("total", 0), null); // not bound yet
});

test("imports lead to where their module defines the name, or to the module", () => {
  assert.deepEqual(find("util"), { file: "util.py", line: 1, col: 1 });
  assert.deepEqual(find("Sq"), { file: "geometry/shapes.py", line: 1, col: 7 });
  assert.deepEqual(find("area"), { file: "geometry/shapes.py", line: 4, col: 1 });
  assert.deepEqual(find("shout"), { file: "helpers.py", line: 1, col: 11 });
});

test("else a def in another file; nothing for an unknown name", () => {
  assert.deepEqual(find("double"), { file: "util.py", line: 1, col: 5 });
  assert.equal(find("nowhere"), null);
  assert.equal(find("not a word"), null);
});
