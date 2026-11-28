// Stamps build/site/sw.js with the site's version (a hash of every file) and
// the list of files to precache, with their sizes for progress reporting;
// first adds the Rust pack (web/packs.js) to packs.json: the toolchain and
// its docs, cached when Rust is installed rather than with the site.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const site = process.argv[2];
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const sha256 = (f) => createHash("sha256").update(readFileSync(join(site, f))).digest("hex");
const all = walk(site).map((p) => relative(site, p).split("\\").join("/")).sort();

// Content-hashed files first: an update cut short then leaves the indexes
// that name them (toolchain/index.json, docs/index.json.zst) as they were.
const hashed = (p) => /\.[0-9a-f]{12}\./.test(p);
const rust = all.filter((p) => /^(toolchain\/(?!licenses\.html$)|docs\/)/.test(p))
  .sort((a, b) => hashed(b) - hashed(a));
const packs = JSON.parse(readFileSync(join(site, "packs.json"), "utf8"));
writeFileSync(join(site, "packs.json"), JSON.stringify({
  rust: {
    title: "Rust (nightly)",
    about: "rustc with the Cranelift backend, the Wild linker and the standard library, compiled to "
      + "WebAssembly by rust-playground-inbrowser (Apache-2.0), with the Rust docs. Standard library only.",
    base: "",
    dir: "",
    default: true,
    files: rust.map((name) => ({ name, sha256: sha256(name), size: statSync(join(site, name)).size })),
  },
  ...packs,
}, null, 1));

const files = all
  .filter((p) => p !== "sw.js" && p !== "_headers" && !rust.includes(p))
  // AI completion's runtime is cached only when it is turned on (web/lm.js).
  .filter((p) => !/^lm\/.*\.[0-9a-f]{12}\./.test(p));
const hash = createHash("sha256");
for (const f of files) hash.update(f).update(readFileSync(join(site, f)));
const version = `rust-offline-${hash.digest("hex").slice(0, 12)}`;
// "./" is the page itself, as navigations request it.
const precache = [["./", statSync(join(site, "index.html")).size],
  ...files.filter((f) => f !== "index.html").map((f) => [f, statSync(join(site, f)).size])];

const sw = join(site, "sw.js");
let text = readFileSync(sw, "utf8");
let stamped = 0;
text = text.replace(/^const VERSION = .*$/m, () => (stamped++, `const VERSION = ${JSON.stringify(version)};`));
text = text.replace(/^const PRECACHE = .*$/m, () => (stamped++, `const PRECACHE = ${JSON.stringify(precache)};`));
if (stamped !== 2) throw new Error("sw.js needs `const VERSION = ...` and `const PRECACHE = ...` lines");
writeFileSync(sw, text);
const mb = precache.reduce((n, [, size]) => n + size, 0) / 1e6;
console.log(`stamped sw.js: ${version}, ${precache.length} files, ${mb.toFixed(1)} MB`);
