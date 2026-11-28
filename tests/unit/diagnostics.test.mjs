import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDiagnostics } from "../../web/diagnostics.js";

test("an error and a warning, each at its place, with its carets' width", () => {
  const output = [
    "warning: unused variable: `y`",
    " --> src/util.rs:3:9",
    "  |",
    "3 |     let y = 1;",
    "  |         ^ help: if this is intentional, prefix it with an underscore: `_y`",
    "  |",
    "  = note: `#[warn(unused_variables)]` on by default",
    "",
    "error[E0308]: mismatched types",
    " --> src/main.rs:2:18",
    "  |",
    '2 |     let x: i32 = "nope";',
    "  |            ---   ^^^^^^ expected `i32`, found `&str`",
    "  |            |",
    "  |            expected due to this",
    "",
    "error: aborting due to 1 previous error; 1 warning emitted",
    "",
    "For more information about this error, try `rustc --explain E0308`.",
  ].join("\n");
  assert.deepEqual(parseDiagnostics(output), [
    {
      file: "util.rs", line: 3, col: 9, width: 1, severity: "warning",
      message: "unused variable: `y`\nhelp: if this is intentional, prefix it with an underscore: `_y`",
    },
    {
      file: "main.rs", line: 2, col: 18, width: 6, severity: "error",
      message: "mismatched types\nexpected `i32`, found `&str`",
    },
  ]);
});

test("colours are ignored, and notes' places are not diagnostics", () => {
  const E = "\x1b";
  const output = [
    `${E}[0m${E}[1m${E}[38;5;9merror[E0061]${E}[0m${E}[0m${E}[1m: this function takes 1 argument but 0 arguments were supplied${E}[0m`,
    `${E}[0m ${E}[0m${E}[0m${E}[1m${E}[38;5;12m--> ${E}[0m${E}[0msrc/a/b.rs:5:5${E}[0m`,
    `${E}[0m5${E}[0m ${E}[0m${E}[0m${E}[1m${E}[38;5;12m|${E}[0m ${E}[0m    f();${E}[0m`,
    `${E}[0m  ${E}[0m${E}[0m${E}[1m${E}[38;5;12m|${E}[0m     ${E}[0m${E}[0m${E}[1m${E}[38;5;9m^${E}[0m${E}[0m${E}[1m${E}[38;5;9m--${E}[0m`,
    `${E}[0m${E}[1m${E}[38;5;10mnote${E}[0m${E}[0m: function defined here${E}[0m`,
    " --> src/a/b.rs:1:4",
  ].join("\n");
  assert.deepEqual(parseDiagnostics(output), [{
    file: "a/b.rs", line: 5, col: 5, width: 1, severity: "error",
    message: "this function takes 1 argument but 0 arguments were supplied",
  }]);
});

test("rustc's suggested fixes, from its JSON diagnostics, applied to the line", async () => {
  const { fixOnLine } = await import("../../web/diagnostics.js");
  const span = (o) => ({ file_name: "src/main.rs", line_start: 3, line_end: 3, is_primary: true, suggested_replacement: null, ...o });
  const diagnostic = (level, spans, children = []) => JSON.stringify({ level, spans, children });
  const text = "    std::io::stdin().read_line(input);";
  const fix = (column, replacement, applicability = "MachineApplicable") =>
    ({ spans: [span({ column_start: column, column_end: column, suggested_replacement: replacement, suggestion_applicability: applicability })] });
  const output = [
    diagnostic("error", [span({ column_start: 32, column_end: 37 })], [{ spans: [] }, fix(32, "&mut ")]),
    diagnostic("warning", [span({ column_start: 5, column_end: 8 })], [fix(5, "let _ = ")]),
    "not JSON",
  ].join("\n");
  assert.deepEqual(fixOnLine(output, "main.rs", 3, text), { fixed: "    std::io::stdin().read_line(&mut input);" });
  // Not this line, or not an error: no problem.
  assert.equal(fixOnLine(output, "main.rs", 4, text), null);
  assert.equal(fixOnLine(diagnostic("warning", [span({})]), "main.rs", 3, text), null);
  // Alternatives at the same place: the first; placeholders: none.
  const two = diagnostic("error", [span({ column_start: 32, column_end: 37 })], [fix(32, "&mut "), fix(32, "&")]);
  assert.deepEqual(fixOnLine(two, "main.rs", 3, text), { fixed: "    std::io::stdin().read_line(&mut input);" });
  const placeholder = diagnostic("error", [span({ column_start: 32, column_end: 37 })], [fix(32, "/* value */", "HasPlaceholders")]);
  assert.deepEqual(fixOnLine(placeholder, "main.rs", 3, text), { fixed: null });
});
