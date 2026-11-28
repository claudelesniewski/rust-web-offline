import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitHub } from "../../web/github.js";
import { cargoToml } from "../../web/languages.js";
import { SyncConflict, changedSince, folder, layoutOf, pull, push } from "../../web/sync.js";
import { createFakeGitHub } from "../fake-github.mjs";

/** A repository with a README, and a client for it. */
function setup() {
  const fake = createFakeGitHub("me/code");
  fake.commitFiles({ "README.md": "# Code\n" });
  const gh = createGitHub({ token: "t", repo: "me/code", fetch: fake.fetch });
  return { fake, gh };
}

const project = (entries) => new Map(Object.entries(entries));

test("a link's folder, and how files are laid out there", () => {
  assert.equal(folder(""), "");
  assert.equal(folder("/rust/hello/"), "rust/hello/");
  assert.equal(layoutOf(["main.rs", "tool.py"]).src, "src/"); // Rust's, a Cargo package
  assert.equal(layoutOf(["Cargo.toml", "README.md"]).src, "src/");
  assert.equal(layoutOf(["main.py", "lib/util.py"]).src, ""); // Python's: as they are
});

test("a first push adds the files and a Cargo.toml, and keeps the rest", async () => {
  const { fake, gh } = setup();
  const files = project({ "main.rs": "fn main() {}\n", "geometry/mod.rs": "pub fn f() {}\n" });
  const head = await push(gh, { branch: "main", dir: "" }, files, { message: "First", project: "My project" });
  assert.equal(head, fake.head());
  assert.deepEqual(fake.files(), {
    "README.md": "# Code\n",
    "src/main.rs": "fn main() {}\n",
    "src/geometry/mod.rs": "pub fn f() {}\n",
    "Cargo.toml": cargoToml("My project"),
  });
  assert.match(cargoToml("My project"), /^name = "my-project"$/m);
});

test("a push writes changes and deletions, in its folder, and nothing when nothing changed", async () => {
  const { fake, gh } = setup();
  const link = { branch: "main", dir: "hello" };
  link.head = await push(gh, link, project({ "main.rs": "a", "old.rs": "b" }), { message: "1", project: "p" });
  link.head = await push(gh, link, project({ "main.rs": "a2", "new.rs": "c" }), { message: "2", project: "p" });
  assert.deepEqual(fake.files(), {
    "README.md": "# Code\n", "hello/Cargo.toml": cargoToml("p"), "hello/src/main.rs": "a2", "hello/src/new.rs": "c",
  });
  const again = await push(gh, link, project({ "main.rs": "a2", "new.rs": "c" }), { message: "3", project: "p" });
  assert.equal(again, link.head);
});

test("a push refuses when the repository changed since the last sync, or has files before the first", async () => {
  const { fake, gh } = setup();
  const link = { branch: "main", dir: "" };
  link.head = await push(gh, link, project({ "main.rs": "a" }), { message: "1", project: "p" });
  fake.commitFiles({ "src/main.rs": "changed on GitHub" });
  await assert.rejects(push(gh, link, project({ "main.rs": "b" }), { message: "2", project: "p" }), SyncConflict);
  await assert.rejects(push(gh, { branch: "main", dir: "" }, project({ "x.rs": "" }), { message: "3", project: "p" }), SyncConflict);
  assert.equal(fake.files()["src/main.rs"], "changed on GitHub");
});

test("a pull reads the .rs files under src/, and nothing else", async () => {
  const { fake, gh } = setup();
  fake.commitFiles({ "src/main.rs": "fn main() { \"héllo\" }", "src/util/mod.rs": "pub fn u() {}", "src/notes.txt": "x", "other.rs": "y" });
  const { head, files } = await pull(gh, { branch: "main", dir: "" });
  assert.equal(head, fake.head());
  assert.deepEqual(files, { "main.rs": "fn main() { \"héllo\" }", "util/mod.rs": "pub fn u() {}" });
});

test("errors say what went wrong", async () => {
  const fake = createFakeGitHub("me/code");
  fake.commitFiles({ "README.md": "" });
  const gh = createGitHub({ token: "t", repo: "me/other", fetch: fake.fetch });
  await assert.rejects(pull(gh, { branch: "main", dir: "" }), /me\/other wasn't found, or the token can't reach it/);
});

test("local changes are told apart from the snapshot", () => {
  assert.equal(changedSince(project({ "a.rs": "1" }), { "a.rs": "1" }), false);
  assert.equal(changedSince(project({ "a.rs": "2" }), { "a.rs": "1" }), true);
  assert.equal(changedSince(project({ "a.rs": "1", "b.rs": "" }), { "a.rs": "1" }), true);
  assert.equal(changedSince(project({}), undefined), false);
});

test("a Python project's files are its folder's: no src/, no Cargo.toml", async () => {
  const { fake, gh } = setup();
  const link = { branch: "main", dir: "py" };
  link.head = await push(gh, link, project({ "main.py": "print(1)", "lib/util.py": "x = 1" }), { message: "1", project: "p" });
  assert.deepEqual(fake.files(), { "README.md": "# Code\n", "py/main.py": "print(1)", "py/lib/util.py": "x = 1" });
  fake.commitFiles({ "py/main.py": "print(2)", "py/notes.txt": "not a project file" });
  const { head, files } = await pull(gh, link);
  assert.deepEqual(files, { "main.py": "print(2)", "lib/util.py": "x = 1" });
  link.head = await push(gh, { ...link, head }, project({ "main.py": "print(3)" }), { message: "2", project: "p" });
  assert.deepEqual(fake.files(), { "README.md": "# Code\n", "py/main.py": "print(3)", "py/notes.txt": "not a project file" });
});
