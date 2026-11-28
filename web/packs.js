// Toolchains ("packs"), such as Rust and Python, and their packages:
// downloaded only when installed, into a cache of their own that sw.js
// keeps across versions and serves offline, at the pack's `dir` + the
// file's name. What each pack is, pinned by SHA-256, is in packs.json
// (Rust's files there are the site's own: scripts/stamp-sw.mjs adds them).
// Each cached file is tagged with its pack and SHA-256, so an update
// downloads only what changed, and removes the rest.

const CACHE = "packs"; // the name sw.js keeps
const PACK = "X-Pack";
const SHA = "X-SHA256";
const PACKAGE = "X-Package";
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The packs that can be installed: { id: { title, about, base, dir, files,
 *  lock?, packages?, default?, model?, recommended? } }. Default packs are installed
 *  unless removed; `packages`, from the lock, are installed with the pack.
 *  A pack with `model` ({ format, fim? }, as web/lm.js reads them) is a
 *  model for AI suggestions, its one file the model; the `recommended` one
 *  is listed first. */
export async function available() {
  return (await fetch("packs.json")).json();
}

/** Where a pack's file is served from, offline. */
const localPath = (pack, name) => new URL(pack.dir + name, location.href).href;

/** Bytes to download for `pack`. */
export const size = (pack) => pack.files.reduce((n, f) => n + f.size, 0);

/** The packages `names` need, dependencies first: [{ name, file_name, sha256 }],
 *  from a Pyodide lock file's `packages`. Throws on an unknown name. */
export function withDependencies(packages, names) {
  const order = [];
  const seen = new Set();
  const visit = (name) => {
    const key = name.toLowerCase().replace(/[_.]/g, "-");
    if (seen.has(key)) return;
    seen.add(key);
    const p = packages[key];
    if (!p) throw new Error(`There is no package named ${name}.`);
    for (const dep of p.depends ?? []) visit(dep);
    order.push({ name: key, file_name: p.file_name, sha256: p.sha256 });
  };
  for (const name of names) visit(name);
  return order;
}

/** Packages for data work, offered to add in one click. */
export const COMMON_PACKAGES = ["numpy", "pandas", "matplotlib"];

/** Of COMMON_PACKAGES, those that a lock's `packages` have and that aren't
 *  `installed` (names, as installedPackages gives them). */
export const commonToAdd = (packages, installed) =>
  COMMON_PACKAGES.filter((name) => packages[name] && !installed.includes(name));

/** Download `url` and check it against `sha256`; `onBytes(n)` follows it. */
async function download(url, sha256, onBytes) {
  // Not from a cache: sw.js would serve an earlier version's file.
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const reader = res.body.getReader();
  const parts = [];
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    parts.push(r.value);
    onBytes?.(r.value.length);
  }
  const blob = new Blob(parts);
  if (hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())) !== sha256) {
    throw new Error(`${url}: the download is corrupt (checksum mismatch)`);
  }
  return blob;
}

const typeOf = (name) => (/\.m?js$/.test(name) ? "text/javascript"
  : name.endsWith(".wasm") ? "application/wasm"
  : name.endsWith(".json") ? "application/json" : "application/octet-stream");

/** Cache `blob` as file `name` of pack `id` (a package's, if `pkg`). */
async function put(cache, id, pack, { name, sha256 }, blob, pkg) {
  const headers = { "Content-Type": typeOf(name), [PACK]: id, [SHA]: sha256 };
  if (pkg) headers[PACKAGE] = pkg;
  await cache.put(localPath(pack, name), new Response(blob, { headers }));
}

/** Whether file `f` of `pack` is cached, as pinned. */
async function has(cache, pack, f) {
  return (await cache.match(localPath(pack, f.name)))?.headers.get(SHA) === f.sha256;
}

/** The cached files of pack `id`: [[request, response]]. */
async function cached(cache, id) {
  const all = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res?.headers.get(PACK) === id) all.push([req, res]);
  }
  return all;
}

/** Install or update pack `id` (its files and `packages`), then remove its
 *  files from earlier versions; `onProgress(done, total)` follows its files,
 *  in bytes. */
export async function install(pack, id, onProgress) {
  const cache = await caches.open(CACHE);
  const total = size(pack);
  let done = 0;
  for (const f of pack.files) {
    if (await has(cache, pack, f)) {
      done += f.size;
      continue;
    }
    const blob = await download(pack.base + f.name, f.sha256, (n) => onProgress?.((done += n), total));
    await put(cache, id, pack, f, blob);
  }
  const current = new Set(pack.files.map((f) => localPath(pack, f.name)));
  for (const [req, res] of await cached(cache, id)) {
    if (!current.has(req.url) && !res.headers.has(PACKAGE)) await cache.delete(req);
  }
  if (pack.packages) await installPackages(id, pack, pack.packages);
  onProgress?.(total, total);
}

/** Whether `pack` is installed: all its files and `packages` are cached,
 *  as pinned. */
export async function isInstalled(pack) {
  const cache = await caches.open(CACHE);
  for (const f of pack.files) if (!(await has(cache, pack, f))) return false;
  for (const p of pack.packages ? withDependencies(await packages(pack), pack.packages) : []) {
    if (!(await has(cache, pack, { name: p.file_name, sha256: p.sha256 }))) return false;
  }
  return true;
}

/** File `name` of installed `pack`, as a Blob. */
export async function file(pack, name) {
  const res = await (await caches.open(CACHE)).match(localPath(pack, name));
  if (!res) throw new Error(`${name} isn't installed`);
  return res.blob();
}

/** The pack's lock file's packages: { name: { file_name, sha256, depends } }. */
export async function packages(pack) {
  const res = pack.lock && await (await caches.open(CACHE)).match(localPath(pack, pack.lock));
  return res ? (await res.json()).packages : {};
}

/** The names of the packages installed in pack `id`. */
export async function installedPackages(id) {
  const names = (await cached(await caches.open(CACHE), id)).map(([, res]) => res.headers.get(PACKAGE));
  return names.filter(Boolean).sort();
}

/** Install `names` and what they depend on; `onProgress(text)` says which. */
export async function installPackages(id, pack, names, onProgress) {
  const cache = await caches.open(CACHE);
  for (const p of withDependencies(await packages(pack), names)) {
    const f = { name: p.file_name, sha256: p.sha256 };
    if (await has(cache, pack, f)) continue;
    onProgress?.(`Downloading ${p.name}…`);
    await put(cache, id, pack, f, await download(pack.base + f.name, f.sha256), p.name);
  }
}

/** Remove package `name` (not what depends on it, which then won't load). */
export async function removePackage(pack, name) {
  const p = (await packages(pack))[name];
  if (p) await (await caches.open(CACHE)).delete(localPath(pack, p.file_name));
}

/** Remove pack `id` and its packages. */
export async function remove(id) {
  const cache = await caches.open(CACHE);
  for (const [req] of await cached(cache, id)) await cache.delete(req);
}
