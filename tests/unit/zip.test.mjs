import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, zip } from "../../web/zip.js";

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("zip produces an archive Python's zipfile can read back", async () => {
  const files = [
    { name: "main.rs", content: 'fn main() { println!("héllo 🦀"); }\n' },
    { name: "empty.rs", content: "" },
  ];
  const path = join(mkdtempSync(join(tmpdir(), "zip-test-")), "out.zip");
  writeFileSync(path, new Uint8Array(await zip(files).arrayBuffer()));
  const read = execFileSync("python3", ["-I", "-c", `
import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps([{"name": i.filename, "content": z.read(i).decode()} for i in z.infolist()]))
`, path]);
  assert.deepEqual(JSON.parse(read), files);
});
