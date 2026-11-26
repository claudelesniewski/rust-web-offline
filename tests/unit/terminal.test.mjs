import assert from "node:assert/strict";
import { test } from "node:test";
import { AnsiParser, findLocations } from "../../web/terminal.js";

const ESC = "\x1b";

test("plain text is one unstyled segment", () => {
  assert.deepEqual(new AnsiParser().push("hello"), [{ text: "hello", fg: null, bold: false }]);
});

test("rustc-style colours and bold, then reset", () => {
  const segs = new AnsiParser().push(`${ESC}[0m${ESC}[1m${ESC}[38;5;9merror${ESC}[0m${ESC}[1m: oops${ESC}[0m\n`);
  assert.deepEqual(segs, [
    { text: "error", fg: 9, bold: true },
    { text: ": oops", fg: null, bold: true },
    { text: "\n", fg: null, bold: false },
  ]);
});

test("basic and bright foreground codes", () => {
  const p = new AnsiParser();
  assert.equal(p.push(`${ESC}[31mx`)[0].fg, 1);
  assert.equal(p.push(`${ESC}[94mx`)[0].fg, 12);
  assert.equal(p.push(`${ESC}[39mx`)[0].fg, null);
});

test("an escape split across chunks is still applied", () => {
  const p = new AnsiParser();
  assert.deepEqual(p.push(`a${ESC}[3`), [{ text: "a", fg: null, bold: false }]);
  assert.deepEqual(p.push("2mb"), [{ text: "b", fg: 2, bold: false }]);
  assert.deepEqual(p.push(`c${ESC}`), [{ text: "c", fg: 2, bold: false }]);
  assert.deepEqual(p.push("[0md"), [{ text: "d", fg: null, bold: false }]);
});

test("non-colour escape sequences are dropped", () => {
  assert.deepEqual(new AnsiParser().push(`a${ESC}[2Kb`), [
    { text: "a", fg: null, bold: false },
    { text: "b", fg: null, bold: false },
  ]);
});

test("places in the code, from rustc and from panics, but not the library's", () => {
  const text = [
    "error[E0308]: mismatched types",
    " --> src/main.rs:3:17",
    "note: required by a bound in `max`",
    "  --> /rustc/1.101.0/library/core/src/cmp.rs:253:0",
    "thread 'main' panicked at src/geometry/mod.rs:12:5:",
  ].join("\n");
  assert.deepEqual(findLocations(text).map(({ file, line, col }) => [file, line, col]),
    [["main.rs", 3, 17], ["geometry/mod.rs", 12, 5]]);
  const [first] = findLocations(text);
  assert.equal(text.slice(first.index, first.index + first.length), "src/main.rs:3:17");
});
