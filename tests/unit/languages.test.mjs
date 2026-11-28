import assert from "node:assert/strict";
import { test } from "node:test";
import { languageOf, validName, withExtension } from "../../web/languages.js";

test("file names are paths of module names ending in .rs, .py, .js or .ts", () => {
  for (const ok of ["main.rs", "my_mod.rs", "_x.rs", "A1.rs", "geometry/shapes.rs", "a/b/c.rs", "hello.py", "pkg/util.py", "app.js", "lib/util.ts"]) {
    assert.ok(validName(ok), ok);
  }
  for (const bad of ["main", "1x.rs", "my-mod.rs", "a b.rs", "../x.rs", "/x.rs", "a//b.rs", "a/.rs", ".rs", "x.rs.txt", "1a/b.rs", "x.pyc", "my-script.py"]) {
    assert.ok(!validName(bad), bad);
  }
});

test("a file's language is by its extension; .rs is added if it has none", () => {
  assert.equal(languageOf("a/b.py").id, "python");
  assert.equal(languageOf("main.rs").id, "rust");
  assert.equal(languageOf("a.js").id, "javascript");
  assert.equal(languageOf("lib/a.ts").id, "typescript");
  assert.equal(languageOf("notes.txt"), undefined);
  assert.equal(withExtension("util"), "util.rs");
  assert.equal(withExtension("util.py"), "util.py");
});
