import assert from "node:assert/strict";
import { test } from "node:test";
import { LANGUAGES } from "../../web/languages.js";
import { createSuggester, memberGrammar, withBlockBody, withoutComment } from "../../web/suggest.js";
import { errorOnLine } from "../../web/types.js";

const [rust, python] = LANGUAGES.map((l) => l.ai);

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
  // Python's: # comments, and strings in either quotes.
  assert.equal(withoutComment("x = 1  # one", python), "x = 1");
  assert.equal(withoutComment("s = '#' + \"'#\"  # hash", python), "s = '#' + \"'#\"");
  assert.equal(withoutComment("x = a // b", python), "x = a // b");
});

/** A suggester with a fake model answering `answer`, and fake rustc. */
function suggester(answer, { members = null, errors = "" } = {}) {
  const calls = { grammar: undefined, checked: null };
  const suggest = createSuggester({
    complete: async (prefix, signal, { grammar }) => { calls.grammar = grammar; return answer; },
    ai: rust,
    members: members && (async () => members),
    rejects: async (source, line) => {
      calls.checked = source;
      return errorOnLine(errors, "main.rs", line);
    },
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

test("the model is told the file and given the project's other files, as its language lays them out", async () => {
  let seen;
  const make = (ai, main, other) => createSuggester({
    complete: async (prefix, signal, opts) => { seen = opts; return "1"; },
    ai,
    main: () => main,
    others: () => [{ name: other, content: "x" }],
  });
  assert.equal(await make(rust, "app.rs", "geometry.rs")("let x = ", 8), "1");
  assert.deepEqual([seen.repo, seen.file, seen.others], ["rust-examples", "src/app.rs", [{ name: "src/geometry.rs", content: "x" }]]);
  assert.equal(await make(python, "app.py", "util.py")("x = ", 4), "1");
  assert.deepEqual([seen.repo, seen.file, seen.others], ["python-examples", "app.py", [{ name: "util.py", content: "x" }]]);
});

test("Python: a comment alone is no suggestion, nor one the check rejects", async () => {
  const make = (answer, rejected) => createSuggester({ complete: async () => answer, ai: python, rejects: async () => rejected });
  assert.equal(await make("# a note", false)("x = 1\n", 6), "");
  assert.equal(await make("print(x)  # show", false)("x = 1\n", 6), "print(x)");
  assert.equal(await make("print(y)", true)("x = 1\n", 6), "");
});

test("a Python line that opens a block gets a body, to be checked alone", () => {
  assert.equal(withBlockBody("def f():\n    if x:\nprint(1)", 2), "def f():\n    if x:\n        pass\nprint(1)");
  assert.equal(withBlockBody("x = 1\n", 1), "x = 1\n");
});
