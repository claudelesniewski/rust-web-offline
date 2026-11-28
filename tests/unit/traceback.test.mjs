import assert from "node:assert/strict";
import { test } from "node:test";
import { findLocations, parseTraceback } from "../../web/traceback.js";

// As Pyodide's Python 3.14 prints them.
const files = new Map([
  ["main.py", "import util\n\ndef g():\n    if True:\n        return util.f(1) + undefined_name\n\nprint(g())\n"],
  ["util.py", "def f(x):\n    return x / 0\n"],
  ["bad.py", "x = 1\nprint(\n"],
]);
const runtime = [
  "Traceback (most recent call last):",
  '  File "/src/main.py", line 7, in <module>',
  "    print(g())",
  "          ~^^",
  '  File "/src/main.py", line 5, in g',
  "    return util.f(1) + undefined_name",
  "           ~~~~~~^^^",
  '  File "/src/util.py", line 2, in f',
  "    return x / 0",
  "           ~~^~~",
  "ZeroDivisionError: division by zero",
  "",
].join("\n");

test("a traceback's frames in the project are links", () => {
  const found = findLocations(`${runtime}  File "/lib/python3.14/runpy.py", line 1, in x\n`);
  assert.deepEqual(found.map(({ file, line, col }) => [file, line, col]), [["main.py", 7, 1], ["main.py", 5, 1], ["util.py", 2, 1]]);
  assert.equal(runtime.slice(found[2].index, found[2].index + found[2].length), 'File "/src/util.py", line 2');
});

test("where an exception was raised is an error, spanning its carets; the calls there, info", () => {
  assert.deepEqual(parseTraceback(runtime, files), [
    { file: "main.py", line: 7, col: 7, width: 3, severity: "info", message: "ZeroDivisionError: division by zero\n(in a call from here)" },
    { file: "main.py", line: 5, col: 16, width: 9, severity: "info", message: "ZeroDivisionError: division by zero\n(in a call from here)" },
    { file: "util.py", line: 2, col: 12, width: 5, severity: "error", message: "ZeroDivisionError: division by zero" },
  ]);
});

test("a syntax error, at its caret", () => {
  const output = '  File "/src/bad.py", line 2\n    print(\n         ^\nSyntaxError: \'(\' was never closed\n';
  assert.deepEqual(parseTraceback(output, files), [
    { file: "bad.py", line: 2, col: 6, width: 1, severity: "error", message: "SyntaxError: '(' was never closed" },
  ]);
});

test("without carets, the line's code; frames of files not in the project are left out", () => {
  const output = 'Traceback (most recent call last):\n  File "/src/main.py", line 1, in <module>\n    import util\n' +
    '  File "/src/gone.py", line 3, in <module>\nValueError\n';
  assert.deepEqual(parseTraceback(output, files), [
    { file: "main.py", line: 1, col: 1, width: 11, severity: "error", message: "ValueError" },
  ]);
  assert.deepEqual(parseTraceback("just output\n", files), []);
});
