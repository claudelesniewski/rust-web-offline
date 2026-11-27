import assert from "node:assert/strict";
import { test } from "node:test";
import { createSuggester, memberGrammar, withoutComment } from "../../web/suggest.js";

test("the member grammar starts the line with a member, as a whole word", () => {
  assert.equal(memberGrammar(["push", "pop", "len"], "p"),
    'root ::= ("ush" | "op") ([^a-zA-Z0-9_\\n] [^\\n]*)? "\\n"');
  assert.equal(memberGrammar(["len"], "len"), 'root ::= ("") ([^a-zA-Z0-9_\\n] [^\\n]*)? "\\n"');
  assert.equal(memberGrammar(["len"], "x"), null);
});

test("comments at the end are cut, but not // in strings", () => {
  assert.equal(withoutComment("x.len(); // the length"), "x.len();");
  assert.equal(withoutComment('println!("http://a"); // b'), 'println!("http://a");');
  assert.equal(withoutComment('println!("\\"//"); // b'), 'println!("\\"//");');
  assert.equal(withoutComment("// all comment"), "");
  assert.equal(withoutComment("no comment  "), "no comment  ");
});

/** A suggester with a fake model answering `answer`, and fake toolchain. */
function suggester(answer, { members = null, errors = "" } = {}) {
  const calls = { grammar: undefined, checked: null };
  const suggest = createSuggester({
    complete: async (prefix, signal, { grammar }) => { calls.grammar = grammar; return answer; },
    members: members && (async () => members),
    check: async (source) => { calls.checked = source; return errors; },
  });
  return { suggest, calls };
}

test("after a dot, the model is held to the type's members", async () => {
  const doc = "fn main() {\n    v.\n}\n";
  const pos = doc.indexOf(".") + 1;
  const { suggest, calls } = suggester("push(1);", { members: [{ label: "push" }, { label: "pop" }] });
  assert.equal(await suggest(doc, pos), "push(1);");
  assert.match(calls.grammar, /^root ::= \("push" \| "pop"\)/);
  assert.equal(calls.checked, "fn main() {\n    v.push(1);\n}\n");
});

test("nothing after a dot where nothing exists", async () => {
  const { suggest } = suggester("push(1);", { members: [] });
  assert.equal(await suggest("nope.", 5), "");
});

test("nothing when rustc finds an error on the line; errors elsewhere don't count", async () => {
  const doc = "fn main() {\n    let x = \n}\n";
  const pos = doc.indexOf("= ") + 2;
  const error = (line) => `error[E0308]: mismatched types\n --> src/main.rs:${line}:13\n`;
  assert.equal(await suggester("\"a\" + 1;", { errors: error(2) }).suggest(doc, pos), "");
  assert.equal(await suggester("5;", { errors: error(9) }).suggest(doc, pos), "5;");
  const warning = "warning: unused variable: `x`\n --> src/main.rs:2:9\n";
  assert.equal(await suggester("5;", { errors: warning }).suggest(doc, pos), "5;");
});

test("comments: none alone or at the end in code, but all of it in a comment", async () => {
  const code = "fn main() {\n    let x = 5;\n";
  assert.equal(await suggester("// a note").suggest(code, code.length), "");
  assert.equal(await suggester("x + 1; // add").suggest(code, code.length), "x + 1;");
  const comment = "fn main() {\n    // Add the ";
  assert.equal(await suggester("numbers // up").suggest(comment, comment.length), "numbers // up");
});

test("the model is told the file and given the project's other files", async () => {
  let seen;
  const suggest = createSuggester({
    complete: async (prefix, signal, opts) => { seen = opts; return "1;"; },
    main: () => "app.rs",
    others: () => [{ name: "geometry.rs", content: "pub fn area() {}" }],
  });
  assert.equal(await suggest("let x = ", 8), "1;");
  assert.equal(seen.file, "app.rs");
  assert.deepEqual(seen.others, [{ name: "geometry.rs", content: "pub fn area() {}" }]);
});
