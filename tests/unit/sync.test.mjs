import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitHub } from "../../web/github.js";
import { SyncConflict, cargoToml, changedSince, paths, pull, push } from "../../web/sync.js";
import { createFakeGitHub } from "../fake-github.mjs";

/** A repository with a README, and a client for it. */
function setup() {
  const fake = createFakeGitHub("me/code");
  fake.commitFiles({ "README.md": "# Code\n" });
  const gh = createGitHub({ token: "t", repo: "me/code", fetch: fake.fetch });
  return { fake, gh };
}

const project = (entries) => new Map(Object.entries(entries));

test("paths of a link's files", () => {
  assert.deepEqual(paths(""), { src: "src/", cargo: "Cargo.toml" });
  assert.deepEqual(paths("/rust/hello/"), { src: "rust/hello/src/", cargo: "rust/hello/Cargo.toml" });
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
