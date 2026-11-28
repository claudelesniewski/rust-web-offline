import assert from "node:assert/strict";
import { test } from "node:test";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { pythonCompletions, rustCompletions } from "../../vendor/completion.js";

/** Completions at the `|` in `doc`. */
async function complete(doc, explicit = false) {
  const pos = doc.indexOf("|");
  const state = EditorState.create({ doc: doc.replace("|", "") });
  const result = await rustCompletions()(new CompletionContext(state, pos, explicit));
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

test("after a dot, the type's methods when they are known", async () => {
  const pos = "v.pu".length;
  const state = EditorState.create({ doc: "v.pu" });
  const typed = [{ label: "push", type: "method" }, { label: "spare_capacity_mut", type: "method" }];
  const result = await rustCompletions(async (doc, from, to) => (doc === "v.pu" && from === 2 && to === 4 ? typed : null))(
    new CompletionContext(state, pos, false));
  // Common methods are ranked first.
  assert.deepEqual(result.options, [{ ...typed[0], boost: 1 }, typed[1]]);
});

test("Python asks for members after a dot, and for names in imports, and nowhere else", async () => {
  const asked = [];
  const source = pythonCompletions((doc, from, to) => {
    asked.push(doc.slice(from, to));
    return [{ label: "upper" }];
  });
  const at = async (doc) => {
    const pos = doc.indexOf("|");
    const state = EditorState.create({ doc: doc.replace("|", "") });
    return source(new CompletionContext(state, pos, false));
  };
  assert.deepEqual(await at("s = 'x'\ns.up|"), { from: 10, options: [{ label: "upper" }], validFor: /^\w*$/ });
  for (const doc of ["import o|", "import os, sy|", "from coll|", "from os import pa|", "from os import (sep, pa|", "x.|"]) {
    assert.ok(await at(doc), doc);
  }
  for (const doc of ["pri|", "x = le|", "def f(a|"]) assert.equal(await at(doc), null, doc);
  assert.deepEqual(asked, ["up", "o", "sy", "coll", "pa", "pa", ""]);
});
