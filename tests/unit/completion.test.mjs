import assert from "node:assert/strict";
import { test } from "node:test";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { rustCompletions } from "../../vendor/completion.js";

/** Completions at the `|` in `doc`. */
async function complete(doc, explicit = false) {
  const pos = doc.indexOf("|");
  const state = EditorState.create({ doc: doc.replace("|", "") });
  const result = await rustCompletions(new CompletionContext(state, pos, explicit));
  return result && { from: result.from, labels: result.options.map((o) => o.label) };
}

test("keywords, types, macros and snippets at the start of a word", async () => {
  const { from, labels } = await complete("fn main() { pri| }");
  assert.equal(from, 12);
  for (const l of ["println!", "match", "Vec", "for"]) assert.ok(labels.includes(l), l);
});

test("methods after a dot, even with no word typed yet", async () => {
  const { labels } = await complete("let v = vec![1]; v.|");
  assert.ok(labels.includes("push") && labels.includes("iter"));
  assert.ok(!labels.includes("match"));
});

test("associated functions after ::", async () => {
  const { labels } = await complete("let s = String::wi|");
  assert.ok(labels.includes("with_capacity") && labels.includes("new"));
});

test("words from the file are offered too", async () => {
  const { labels } = await complete("let total_count = 1;\nprintln!(\"{}\", tot|);");
  assert.ok(labels.includes("total_count"));
});

test("nothing unasked-for after whitespace", async () => {
  assert.equal(await complete("let x = |"), null);
  assert.ok(await complete("let x = |", true));
});
