import assert from "node:assert/strict";
import { test } from "node:test";
import { toDiagnostics } from "../../web/ruff.js";

const at = (row, column) => ({ row, column });

test("a rule's finding is a warning, with its code", () => {
  assert.deepEqual(toDiagnostics([{ code: "F821", message: "Undefined name `x`", start_location: at(2, 7), end_location: at(2, 8), fix: null }]),
    [{ line: 2, col: 7, width: 1, severity: "warning", message: "F821 Undefined name `x`" }]);
});

test("a syntax error is an error; one at the end has no width", () => {
  assert.deepEqual(toDiagnostics([
    { code: "invalid-syntax", message: "unexpected EOF while parsing", start_location: at(4, 1), end_location: at(4, 1) },
    { code: null, message: "Expected a parameter", start_location: at(3, 7), end_location: at(3, 8) },
  ]), [
    { line: 4, col: 1, width: 0, severity: "error", message: "unexpected EOF while parsing" },
    { line: 3, col: 7, width: 1, severity: "error", message: "Expected a parameter" },
  ]);
});

test("one that spans lines underlines the rest of its first", () => {
  const [d] = toDiagnostics([{ code: "E731", message: "Do not assign a `lambda`", start_location: at(1, 1), end_location: at(3, 2) }]);
  assert.equal(d.width, Infinity);
});
