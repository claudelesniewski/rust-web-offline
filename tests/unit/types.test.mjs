import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTypeCompletion, methodsFromHtml, parseProbe, probeSource, typeName, userMethods,
} from "../../web/types.js";

test("the probe replaces the word after the dot and ends the statement", () => {
  const doc = "fn main() {\n    v.pu\n}\n";
  const from = doc.indexOf("pu");
  assert.equal(probeSource(doc, from, from + 2), "fn main() {\n    v.__rwo_probe;\n}\n");
  const call = "f(v.)\n";
  assert.equal(probeSource(call, 4, 4), "f(v.__rwo_probe)\n");
});

test("after if, while, for and match the probe gets a block, so it parses", () => {
  for (const line of ["if v.", "} else if v.", "while v.", "for x in v.", "match v."]) {
    const doc = `    ${line}\n`;
    assert.equal(probeSource(doc, doc.length - 1, doc.length - 1), `    ${line}__rwo_probe {}\n`, line);
  }
});

test("nothing is offered after a name that doesn't exist; the plain list if the type can't be found", async () => {
  const doc = "fn main() {\n    foo.\n}\n";
  const from = doc.indexOf(".") + 1;
  const outputs = {
    unknown: "error[E0425]: cannot find value `foo` in this scope\n --> src/main.rs:2:5\n",
    elsewhere: "error: expected `;`\n --> src/other.rs:2:5\n",
  };
  for (const [kind, expected] of [["unknown", []], ["elsewhere", null]]) {
    const complete = createTypeCompletion({ check: async () => outputs[kind], fetchText: async () => "{}" });
    assert.deepEqual(await complete(doc, from, from, [doc], "main.rs"), expected, kind);
  }
});

test("rustc's errors give the type, and a struct's fields", () => {
  assert.deepEqual(parseProbe([
    "error[E0609]: no field `__rwo_probe` on type `Point`",
    "  --> src/main.rs:12:7",
    "   = note: available fields are: `x`, `y`",
  ].join("\n")), { type: "Point", fields: ["x", "y"] });
  assert.deepEqual(parseProbe("error[E0609]: no field `__rwo_probe` on type `Vec<{integer}>`"),
    { type: "Vec<{integer}>", fields: [] });
  assert.deepEqual(parseProbe("error[E0610]: `{integer}` is a primitive type and therefore doesn't have fields"),
    { type: "{integer}", fields: [] });
  assert.equal(parseProbe("error: expected `;`, found `}`"), null);
});

test("type names to look up", () => {
  const cases = {
    "Vec<{integer}>": "Vec", "&mut String": "String", "&'a str": "str", "std::slice::Iter<'_, i32>": "std::slice::Iter",
    "[i32; 3]": "array", "&[u8]": "slice", "(i32, char)": "tuple", "{float}": "f64",
    "impl Iterator<Item = i32>": "Iterator", "HashMap<String, usize>": "HashMap",
  };
  for (const [type, name] of Object.entries(cases)) assert.equal(typeName(type), name, type);
});

test("stable methods taking self, from a rustdoc page", () => {
  const section = (id, sig, after = "") =>
    `<section id="${id}" class="method"><span class="rightside">1.0.0</span><h4 class="code-header">${sig}</h4></section>${after}`;
  const html = [
    section("method.push", 'pub fn <a href="#method.push" class="fn">push</a>(&amp;mut self, value: T)',
      '</summary><div class="docblock"><p>Appends an element to the back of a collection.</p>'),
    section("method.push_within_capacity", "pub fn push_within_capacity(&amp;mut self, value: T)",
      '<span class="item-info"><div class="stab unstable">'),
    section("method.advance_by", "fn advance_by(&amp;mut self, n: usize)",
      '</summary><span class="item-info"><div class="stab unstable">'),
    section("method.new", "pub const fn new() -&gt; Vec&lt;T&gt;"),
    section("method.borrow_mut", "fn borrow_mut(&amp;mut self) -&gt; &amp;mut T"),
    section("tymethod.next", "fn next(&amp;mut self) -&gt; Option&lt;Self::Item&gt;"),
    section("method.push-1", "pub fn push(&amp;mut self, value: T)"),
  ].join("\n");
  assert.deepEqual(methodsFromHtml(html), [
    { name: "push", sig: "fn push(&mut self, value: T)", doc: "Appends an element to the back of a collection." },
    { name: "next", sig: "fn next(&mut self) -> Option<Self::Item>", doc: "" },
  ]);
});

test("your own types' methods, from their impl blocks", () => {
  const src = `
struct Stack<T> { items: Vec<T> }
impl<T> Stack<T> {
    fn push(&mut self, x: T) { if true { self.items.push(x); } }
    fn len(&self) -> usize { self.items.len() }
}
impl fmt::Display for Stack<i32> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { Ok(()) }
}
impl Other { fn nope(&self) {} }`;
  assert.deepEqual(userMethods([src], "Stack").map((m) => m.sig),
    ["fn push(&mut self, x: T)", "fn len(&self) -> usize", "fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result"]);
});
