import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";

/** A version-1 database, as the app made before projects. */
function makeVersion1(files, active) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("rust-offline", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("files", { keyPath: "name" });
      req.result.createObjectStore("settings");
    };
    req.onsuccess = () => {
      const t = req.result.transaction(["files", "settings"], "readwrite");
      for (const f of files) t.objectStore("files").put(f);
      t.objectStore("settings").put(active, "active");
      t.oncomplete = () => { req.result.close(); resolve(); };
    };
    req.onerror = () => reject(req.error);
  });
}

// One database for the whole file (the module opens it once): the upgrade
// test must come first.
const old = [{ name: "main.rs", content: "fn main() {}\n" }, { name: "shapes.rs", content: "struct S;\n" }];
await makeVersion1(old, "shapes.rs");
const store = await import("../../web/store.js");

test("upgrading moves the files into a first project, and keeps the old ones", async () => {
  assert.deepEqual(await store.listProjects(), [{ id: store.FIRST_PROJECT, name: "My project" }]);
  assert.deepEqual(await store.listFiles(store.FIRST_PROJECT),
    old.map((f) => ({ project: store.FIRST_PROJECT, ...f })));
  assert.equal(await store.getSetting(`active:${store.FIRST_PROJECT}`), "shapes.rs");
  // The version-1 store is still there, untouched.
  const db = await new Promise((resolve) => { indexedDB.open("rust-offline").onsuccess = (e) => resolve(e.target.result); });
  const kept = await new Promise((resolve) => {
    db.transaction("files").objectStore("files").getAll().onsuccess = (e) => resolve(e.target.result);
  });
  db.close();
  assert.deepEqual(kept, old);
});

test("projects keep their files apart, and deleting one deletes its files", async () => {
  await store.putProject({ id: "p2", name: "Second" });
  await store.putFile("p2", "main.rs", "fn main() { 2 }");
  await store.putFile("p2", "geometry/shapes.rs", "pub struct S;");
  assert.deepEqual((await store.listFiles("p2")).map((f) => f.name), ["geometry/shapes.rs", "main.rs"]);
  assert.equal((await store.listFiles(store.FIRST_PROJECT)).find((f) => f.name === "main.rs").content, "fn main() {}\n");
  await store.renameFile("p2", "main.rs", "app.rs", "fn main() { 3 }");
  assert.deepEqual((await store.listFiles("p2")).map((f) => [f.name, f.content]),
    [["app.rs", "fn main() { 3 }"], ["geometry/shapes.rs", "pub struct S;"]]);
  await store.deleteProject("p2");
  assert.deepEqual(await store.listFiles("p2"), []);
  assert.equal((await store.listProjects()).length, 1);
  assert.equal((await store.listFiles(store.FIRST_PROJECT)).length, 2);
});

test("file names are paths of module names ending in .rs or .py", () => {
  for (const ok of ["main.rs", "my_mod.rs", "_x.rs", "A1.rs", "geometry/shapes.rs", "a/b/c.rs", "hello.py", "pkg/util.py"]) {
    assert.ok(store.validName(ok), ok);
  }
  for (const bad of ["main", "1x.rs", "my-mod.rs", "a b.rs", "../x.rs", "/x.rs", "a//b.rs", "a/.rs", ".rs", "x.rs.txt", "1a/b.rs", "x.pyc", "my-script.py"]) {
    assert.ok(!store.validName(bad), bad);
  }
});
