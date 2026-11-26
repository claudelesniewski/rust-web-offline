import assert from "node:assert/strict";
import { test } from "node:test";
import { validName } from "../../web/store.js";

test("file names must be Rust module names ending in .rs", () => {
  for (const ok of ["main.rs", "my_mod.rs", "_x.rs", "A1.rs"]) assert.ok(validName(ok), ok);
  for (const bad of ["main", "1x.rs", "my-mod.rs", "a b.rs", "../x.rs", "dir/x.rs", ".rs", "x.rs.txt"]) {
    assert.ok(!validName(bad), bad);
  }
});
