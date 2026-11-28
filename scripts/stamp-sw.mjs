// Stamps build/site/sw.js with the site's version (a hash of every file) and
// the list of files to precache, with their sizes for progress reporting;
// first adds the packs (web/packs.js) of the site's own files to packs.json:
// Rust's toolchain and its docs, and Python's docs, cached when installed
// rather than with the site.
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
const sitePacks = {
  rust: {
    title: "Rust (nightly)",
    about: "rustc with the Cranelift backend, the Wild linker and the standard library, compiled to "
      + "WebAssembly by rust-playground-inbrowser (Apache-2.0), with the Rust docs. Standard library only.",
    default: true,
    match: /^(toolchain\/(?!licenses\.html$)|docs\/)/,
  },
  "python-docs": {
    title: "Python docs",
    about: "The documentation of Python 3.14 (PSF licence): the tutorial, the library and the "
      + "language reference, with search (Docs menu).",
    match: /^python-docs\//,
  },
};
const inPacks = new Set();
const packs = {};
for (const [id, { match, ...pack }] of Object.entries(sitePacks)) {
  const names = all.filter((p) => match.test(p)).sort((a, b) => hashed(b) - hashed(a));
  names.forEach((n) => inPacks.add(n));
  packs[id] = { ...pack, base: "", dir: "",
    files: names.map((name) => ({ name, sha256: sha256(name), size: statSync(join(site, name)).size })) };
}
const { rust, ...docs } = packs;
writeFileSync(join(site, "packs.json"), JSON.stringify({
  rust, ...JSON.parse(readFileSync(join(site, "packs.json"), "utf8")), ...docs,
}, null, 1));

const files = all
  .filter((p) => p !== "sw.js" && p !== "_headers" && !inPacks.has(p))
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
