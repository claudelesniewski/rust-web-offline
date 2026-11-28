import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as git from "isomorphic-git";
import { changes, commit, filesAt, log, mirrorPlan, removeRepo } from "../../web/history.js";

const map = (entries) => new Map(Object.entries(entries));

test("mirroring a project's files into the working folder", () => {
  assert.deepEqual(mirrorPlan(map({}), map({ "main.rs": "a" })), { write: ["main.rs"], remove: [] });
  assert.deepEqual(
    mirrorPlan(map({ "main.rs": "a", "old.rs": "b", "same.rs": "c" }), map({ "main.rs": "a2", "same.rs": "c", "a/new.rs": "d" })),
    { write: ["a/new.rs", "main.rs"], remove: ["old.rs"] },
  );
});

test("the files changed between two commits", () => {
  assert.deepEqual(changes(map({ "a.rs": 1, "b.rs": 2, "c.rs": 3 }), map({ "a.rs": 1, "b.rs": 9, "d.rs": 4 })), [
    { name: "b.rs", status: "modified" },
    { name: "c.rs", status: "deleted" },
    { name: "d.rs", status: "added" },
  ]);
});

test("committing, listing commits and restoring one", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "history-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = { git, fs, dir: join(dir, "project") };
  assert.deepEqual(await log(repo), []);

  const first = await commit(repo, map({ "main.rs": "fn main() {}\n", "geometry/shapes.rs": "// shapes\n" }), "First");
  assert.equal(await commit(repo, map({ "main.rs": "fn main() {}\n", "geometry/shapes.rs": "// shapes\n" }), "Same"), null);
  const second = await commit(repo, map({ "main.rs": "fn main() { run() }\n", "run.rs": "" }), "Second");

  const commits = await log(repo);
  assert.deepEqual(commits.map((c) => [c.oid, c.message]), [[second, "Second"], [first, "First"]]);
  assert.ok(Math.abs(commits[0].time - Date.now()) < 60_000);
  assert.deepEqual(commits[0].changes, [
    { name: "geometry/shapes.rs", status: "deleted" },
    { name: "main.rs", status: "modified" },
    { name: "run.rs", status: "added" },
  ]);
  assert.deepEqual(commits[1].changes.map((c) => c.status), ["added", "added"]);
  assert.deepEqual(await filesAt(repo, first), { "geometry/shapes.rs": "// shapes\n", "main.rs": "fn main() {}\n" });
  assert.deepEqual(await filesAt(repo, second), { "main.rs": "fn main() { run() }\n", "run.rs": "" });

  await removeRepo(repo);
  assert.equal(fs.existsSync(repo.dir), false);
});
