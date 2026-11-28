import assert from "node:assert/strict";
import { test } from "node:test";
import { rank, score } from "../../web/palette.js";

test("a match is the query's letters in order, ignoring case", () => {
  assert.notEqual(score("fmt", "Format"), null);
  assert.notEqual(score("NF", "new file"), null);
  assert.equal(score("tmf", "Format"), null);
  assert.equal(score("x", "Format"), null);
  assert.equal(score("", "Format"), 0);
});

test("letters together, at word starts or at the start rank higher", () => {
  assert.ok(score("form", "Format") > score("form", "Find in files: from…"));
  assert.ok(score("ef", "Export file") > score("ef", "Delete file"));
  assert.ok(score("run", "Run") > score("run", "Docs: Rust — Reference (unstable)"));
  // The best place, not just the first: "rs" together, later on.
  assert.ok(score("rs", "a r/x/s.rs") > score("rs", "a r/x/s"));
});

test("rank keeps the matches, best first, in their order when equal", () => {
  const items = ["Run", "Test", "Format", "Stop", "Delete file", "Export file"];
  assert.deepEqual(rank("", items), items);
  assert.deepEqual(rank("form", items), ["Format"]);
  assert.deepEqual(rank("file", items), ["Delete file", "Export file"]);
  assert.deepEqual(rank("t", items), ["Test", "Format", "Stop", "Delete file", "Export file"]);
  const files = [{ name: "src/game.rs" }, { name: "tests/map.rs" }, { name: "main.rs" }];
  assert.deepEqual(rank("ma", files, (f) => f.name).map((f) => f.name), ["main.rs", "tests/map.rs"]);
});
