// Stamps build/site/sw.js with the site's version (a hash of every file) and
// the list of files to precache, with their sizes for progress reporting.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const site = process.argv[2];
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(site)
  .map((p) => relative(site, p).split("\\").join("/"))
  .filter((p) => p !== "sw.js" && p !== "_headers")
  // AI completion's runtime is cached only when it is turned on (web/lm.js).
  .filter((p) => !/^lm\/.*\.[0-9a-f]{12}\./.test(p))
  .sort();
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
