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
  // Brackets left open on the line are closed, but not those in strings.
  const macro = '    println!("{} (", r.\n';
  assert.equal(probeSource(macro, macro.length - 1, macro.length - 1), '    println!("{} (", r.__rwo_probe);\n');
  const index = "    let x = [a[0].\n";
  assert.equal(probeSource(index, index.length - 1, index.length - 1), "    let x = [a[0].__rwo_probe];\n");
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
    unparsed: "error: expected expression, found `)`\n --> src/main.rs:2:9\n",
  };
  for (const [kind, expected] of [["unknown", []], ["elsewhere", null], ["unparsed", null]]) {
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

test("stable functions from a rustdoc page, marked if they take self", () => {
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
    { name: "push", sig: "fn push(&mut self, value: T)", doc: "Appends an element to the back of a collection.", takesSelf: true },
    { name: "new", sig: "const fn new() -> Vec<T>", doc: "", takesSelf: false },
    { name: "next", sig: "fn next(&mut self) -> Option<Self::Item>", doc: "", takesSelf: true },
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

test("after ::, a module's public items, a type's associated functions, an enum's variants", async () => {
  const { publicItems, variants } = await import("../../web/types.js");
  assert.deepEqual(publicItems("pub fn area() {}\nfn hidden() {}\npub struct Square;\npub(crate) const N: u8 = 1;\npub mod inner;"),
    [{ label: "area", type: "function" }, { label: "Square", type: "type" }, { label: "N", type: "constant" }, { label: "inner", type: "namespace" }]);
  assert.deepEqual(variants(["enum Shape {\n    Circle(f64),\n    #[allow(dead_code)]\n    Rect { w: f64, h: f64 },\n    Dot,\n}"], "Shape"),
    ["Circle", "Rect", "Dot"]);
  const files = [
    { name: "main.rs", content: "mod geometry;\nfn main() {\n    let a = geometry::\n}\n" },
    { name: "geometry.rs", content: "pub fn area(w: f64, h: f64) -> f64 { w * h }\n" },
    { name: "config.rs", content: "pub struct Config;\nimpl Config {\n    pub fn load() -> Config { Config }\n    pub fn verbose(&self) -> bool { false }\n}\n" },
  ];
  const vecPage = '<section id="method.new" class="method"><h4 class="code-header">pub const fn new() -&gt; Vec&lt;T&gt;</h4></section>'
    + '<section id="method.push" class="method"><h4 class="code-header">pub fn push(&amp;mut self, value: T)</h4></section>';
  const complete = createTypeCompletion({
    check: async () => { throw new Error("no compiling after ::"); },
    fetchText: async (path) => (path === "docs/types.json" ? JSON.stringify({ Vec: "std/vec/struct.Vec.html" }) : vecPage),
  });
  const at = (doc) => complete(doc, doc.length, doc.length, files, "main.rs");
  assert.deepEqual((await at("let a = geometry::")).map((o) => o.label), ["area"]);
  assert.deepEqual((await at("let c = Config::")).map((o) => o.label), ["load"]); // not the method
  assert.deepEqual((await at("let v = Vec::")).map((o) => o.label), ["new"]);
  assert.equal(await at("let t = std::fs::"), null); // a std module without a docs page here
  assert.equal(await at("let t = Nowhere::"), null);
});

test("after a std module's ::, its stable items, from its docs page", async () => {
  const { moduleItems } = await import("../../web/types.js");
  const page = '<dl class="item-table">'
    + '<dt><a class="struct" href="struct.File.html" title="struct std::fs::File">File</a></dt><dd>An object providing access to an open file.</dd>'
    + '<dt><a class="fn" href="fn.read_to_string.html" title="fn std::fs::read_to_string">read_<wbr>to_<wbr>string</a></dt><dd>Reads the entire contents of a file into a string.</dd>'
    + '<dt><a class="fn" href="fn.exists.html" title="fn std::fs::exists">exists</a><wbr><span class="stab unstable" title="">Experimental</span></dt><dd>x</dd>'
    + '<dt><a class="mod" href="unix/index.html" title="mod std::fs::unix">unix</a></dt><dd></dd>'
    + '<dt><a class="macro" href="macro.vec.html" title="macro std::vec">vec</a></dt><dd>Creates a Vec.</dd></dl>';
  assert.deepEqual(moduleItems(page), [
    { label: "File", type: "type", detail: "struct", info: "An object providing access to an open file." },
    { label: "read_to_string", type: "function", detail: "fn", info: "Reads the entire contents of a file into a string." },
    { label: "unix", type: "namespace", detail: "mod", info: undefined },
    { label: "vec!", type: "function", detail: "macro", info: "Creates a Vec." },
  ]);
  const complete = createTypeCompletion({
    check: async () => "",
    fetchText: async (path) => (path === "docs/std/fs/index.html" ? page : "not available offline"),
  });
  const files = [{ name: "main.rs", content: "" }];
  const at = (doc) => complete(doc, doc.length, doc.length, files, "main.rs");
  assert.deepEqual((await at("let s = fs::")).map((o) => o.label), ["File", "read_to_string", "unix", "vec!"]);
  assert.equal((await at("let s = std::fs::")).length, 4);
  assert.equal(await at("let s = nowhere::"), null);
});
