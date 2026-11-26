import assert from "node:assert/strict";
import { test } from "node:test";
import { decompress } from "fzstd";
import { zstdCompressSync } from "node:zlib";
import { pack, typeIndex } from "../../scripts/pack-docs.mjs";
import { createDocs } from "../../web/docs.js";

const enc = new TextEncoder();
const files = [
  { path: "book/index.html", bytes: enc.encode("<h1>Book</h1>") },
  { path: "static.files/app.js", bytes: enc.encode("console.log(1)") },
  { path: "std/index.html", bytes: enc.encode("<h1>std</h1>") },
  { path: "std/vec/struct.Vec.html", bytes: enc.encode("<h1>Vec</h1>".repeat(50)) },
];

/** Docs served from `files` packed into tiny chunks, so that several are used. */
function serveFrom(files) {
  const { chunks, files: index } = pack(files, 20);
  const store = { "index.json.zst": zstdCompressSync(JSON.stringify({ chunks: chunks.map((_, i) => `${i}.zst`), files: index })) };
  chunks.forEach((c, i) => { store[`${i}.zst`] = c; });
  return createDocs({ read: async (name) => new Uint8Array(store[name]), decompress });
}

test("every packed file is served back with its type", async () => {
  const serve = serveFrom(files);
  for (const { path, bytes } of files) {
    const res = await serve(path);
    assert.equal(res.status, 200, path);
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes, path);
  }
  assert.equal((await serve("static.files/app.js")).headers.get("Content-Type"), "text/javascript");
  assert.equal((await serve("std/index.html")).headers.get("Content-Type"), "text/html");
});

test("directories serve their index.html", async () => {
  const serve = serveFrom(files);
  assert.equal(await (await serve("std/")).text(), "<h1>std</h1>");
  assert.equal(await (await serve("book")).text(), "<h1>Book</h1>");
});

test("pages not included get a 404 pointing online", async () => {
  const res = await serveFrom(files)("core/arch/index.html");
  assert.equal(res.status, 404);
  assert.match(await res.text(), /https:\/\/doc\.rust-lang\.org\/nightly\/core\/arch\/index\.html/);
});

test("the type index finds pages by full path and by name, preferring std", () => {
  const index = typeIndex([
    "std/vec/struct.Vec.html", "alloc/vec/struct.Vec.html", "std/primitive.i32.html",
    "core/slice/struct.Iter.html", "std/slice/struct.Iter.html", "std/collections/hash_map/struct.Iter.html",
    "std/vec/index.html",
  ]);
  assert.equal(index["std::vec::Vec"], "std/vec/struct.Vec.html");
  assert.equal(index["alloc::vec::Vec"], "alloc/vec/struct.Vec.html");
  assert.equal(index.Vec, "std/vec/struct.Vec.html");
  assert.equal(index.i32, "std/primitive.i32.html");
  assert.equal(index.Iter, "std/slice/struct.Iter.html");
  assert.equal(index["std::collections::hash_map::Iter"], "std/collections/hash_map/struct.Iter.html");
  assert.equal(Object.keys(index).length, 8);
});
