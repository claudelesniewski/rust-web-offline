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
