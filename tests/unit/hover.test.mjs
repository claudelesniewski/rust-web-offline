import assert from "node:assert/strict";
import { test } from "node:test";
import { createRustHover, topDoc } from "../../web/hover.js";

const vecPage = '<details class="toggle top-doc" open><summary class="hideme"><span>Expand description</span></summary>'
  + '<div class="docblock"><p>A contiguous growable array type, written as <code>Vec&lt;T&gt;</code>,\nshort for ‘vector’.</p>'
  + "<h2>Examples</h2></div></details>";

test("a rustdoc page's summary is its description's first paragraph, as text", () => {
  assert.equal(topDoc(vecPage), "A contiguous growable array type, written as Vec<T>, short for ‘vector’.");
  assert.equal(topDoc("<p>no description</p>"), "");
});

test("Rust: a type by its name, from the docs; a member after a dot, from completion", async () => {
  const files = {
    "docs/types.json": JSON.stringify({ Vec: "std/vec/struct.Vec.html", i32: "std/primitive.i32.html" }),
    "docs/std/vec/struct.Vec.html": vecPage,
    "docs/std/primitive.i32.html": "",
  };
  const hover = createRustHover({
    // As completion at the end of `v.`, with nothing after the dot.
    members: async (doc, from, to) => (doc === "v." && from === 2 && to === 2
      ? [{ label: "push", detail: "(&mut self, value: T)", info: "Appends an element." }] : []),
    fetchText: async (path) => files[path],
  });
  const at = (doc, word) => hover(doc, doc.indexOf(word), doc.indexOf(word) + word.length);
  assert.deepEqual(await at("let v: Vec<i32> = Vec::new();", "Vec"), {
    title: "struct std::vec::Vec", body: topDoc(vecPage), link: "docs/std/vec/struct.Vec.html",
  });
  assert.equal((await at("let x: i32 = 1;", "i32")).title, "primitive i32");
  assert.deepEqual(await at("v.push(1);", "push"), { title: "push(&mut self, value: T)", body: "Appends an element." });
  assert.equal(await at("v.nope();", "nope"), null);
  assert.equal(await at("let constructor = 1;", "constructor"), null); // not an Object property, either
  assert.equal(await at("fn main() {}", "main"), null);
});
