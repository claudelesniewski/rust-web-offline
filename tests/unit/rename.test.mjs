import assert from "node:assert/strict";
import { test } from "node:test";
import { renameError, renameIn } from "../../web/rename.js";

const rust = (text) => renameIn(text, "x", "y", "rust");
const python = (text) => renameIn(text, "x", "y", "python");

test("renames whole words only, and counts them", () => {
  assert.deepEqual(rust("let x = xs[x] + x_1 + ax + x2;\nfoo::x(x)"), {
    text: "let y = xs[y] + x_1 + ax + x2;\nfoo::y(y)", count: 4,
  });
  assert.deepEqual(rust("nothing"), { text: "nothing", count: 0 });
});

test("Rust: leaves comments and strings alone", () => {
  assert.equal(rust("x // x\n/* x /* x */ x */ x").text, "y // x\n/* x /* x */ x */ y");
  assert.equal(rust('x("x", "\\"x", b"x", c"x") x').text, 'y("x", "\\"x", b"x", c"x") y');
  assert.equal(rust('x(r"x\\", r#"x " x"#, br##"x"#x"##) x').text, 'y(r"x\\", r#"x " x"#, br##"x"#x"##) y');
  assert.equal(rust('r(x); b + x; r#x').text, "r(y); b + y; r#y");
});

test("Rust: chars are literals, lifetimes and labels are not the name", () => {
  assert.equal(rust("['x', '\\'', '\\u{78}', b'x', x]").text, "['x', '\\'', '\\u{78}', b'x', y]");
  assert.equal(rust("fn f<'x>(x: &'x str) { 'x: loop { break 'x; } }").text,
    "fn f<'x>(y: &'x str) { 'x: loop { break 'x; } }");
});

test("Python: leaves comments and strings alone, triple-quoted and prefixed too", () => {
  assert.equal(python("x = 1  # x\nprint(x)").text, "y = 1  # x\nprint(y)");
  assert.equal(python(`x("x", 'x', "it's x", 'say "x"', '\\'x')`).text, `y("x", 'x', "it's x", 'say "x"', '\\'x')`);
  assert.equal(python('"""x\n" x "\nx"""\nx\n\'\'\'x\'\'\'').text, '"""x\n" x "\nx"""\ny\n\'\'\'x\'\'\'');
  assert.equal(python('f"{x}" + rb"x" + Rf\'x\' + x').text, 'f"{x}" + rb"x" + Rf\'x\' + y');
  assert.equal(python("r = x; f(x)").text, "r = y; f(y)");
});

test("an unterminated string or comment runs to the end", () => {
  assert.equal(rust('x "x').text, 'y "x');
  assert.equal(rust("x /* x").text, "y /* x");
  assert.equal(python("x '''x").text, "y '''x");
});

test("the new name must be a name, and not a keyword", () => {
  assert.equal(renameError("x", "y_2", "rust"), null);
  assert.equal(renameError("x", "2y", "rust"), "2y is not a name");
  assert.equal(renameError("x", "a-b", "python"), "a-b is not a name");
  assert.equal(renameError("x", "fn", "rust"), "fn is a keyword");
  assert.equal(renameError("x", "fn", "python"), null);
  assert.equal(renameError("x", "lambda", "python"), "lambda is a keyword");
  assert.equal(renameError("struct", "y", "rust"), "struct can't be renamed");
});
