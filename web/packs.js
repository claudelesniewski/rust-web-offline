// Optional toolchains ("packs"), such as Python, and their packages:
// downloaded only when installed, into a cache of their own that sw.js
// keeps across versions and serves offline, under packs/<id>/<file>.
// What each pack is, pinned by SHA-256, is in packs.json.

const CACHE = "packs"; // the name sw.js keeps
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The packs that can be installed: { id: { title, about, base, files, lock } }. */
export async function available() {
  return (await fetch("packs.json")).json();
}

/** Where a pack's file is served from, offline. */
export const localPath = (id, name) => `packs/${id}/${name}`;

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

/** Download `url` and check it against `sha256`; `onBytes(n)` follows it. */
async function download(url, sha256, onBytes) {
  const res = await fetch(url);
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

const typeOf = (name) => (name.endsWith(".mjs") ? "text/javascript"
  : name.endsWith(".wasm") ? "application/wasm"
  : name.endsWith(".json") ? "application/json" : "application/octet-stream");

async function put(cache, id, name, blob) {
  await cache.put(localPath(id, name), new Response(blob, { headers: { "Content-Type": typeOf(name) } }));
}

/** Install pack `id` (its files, not yet any packages); `onProgress(done,
 *  total)` follows it, in bytes. */
export async function install(pack, id, onProgress) {
  const cache = await caches.open(CACHE);
  const total = pack.files.reduce((n, f) => n + f.size, 0);
  let done = 0;
  for (const f of pack.files) {
    if (await cache.match(localPath(id, f.name))) {
      done += f.size;
      continue;
    }
    const blob = await download(pack.base + f.name, f.sha256, (n) => onProgress?.((done += n), total));
    await put(cache, id, f.name, blob);
  }
  onProgress?.(total, total);
}

/** Whether pack `id` is installed: all its files are cached. */
export async function isInstalled(pack, id) {
  const cache = await caches.open(CACHE);
  for (const f of pack.files) if (!(await cache.match(localPath(id, f.name)))) return false;
  return true;
}

/** The pack's lock file's packages: { name: { file_name, sha256, depends } }. */
export async function packages(id, pack) {
  const res = await (await caches.open(CACHE)).match(localPath(id, pack.lock));
  return res ? (await res.json()).packages : {};
}

/** The names of the packages installed in pack `id`. */
export async function installedPackages(id, pack) {
  const cache = await caches.open(CACHE);
  const all = await packages(id, pack);
  const names = [];
  for (const [name, p] of Object.entries(all)) if (await cache.match(localPath(id, p.file_name))) names.push(name);
  return names;
}

/** Install `names` and what they depend on; `onProgress(text)` says which. */
export async function installPackages(id, pack, names, onProgress) {
  const cache = await caches.open(CACHE);
  for (const p of withDependencies(await packages(id, pack), names)) {
    if (await cache.match(localPath(id, p.file_name))) continue;
    onProgress?.(`Downloading ${p.name}…`);
    await put(cache, id, p.file_name, await download(pack.base + p.file_name, p.sha256));
  }
}

/** Remove package `name` (not what depends on it, which then won't load). */
export async function removePackage(id, pack, name) {
  const p = (await packages(id, pack))[name];
  if (p) await (await caches.open(CACHE)).delete(localPath(id, p.file_name));
}

/** Remove pack `id` and its packages. */
export async function remove(id) {
  const cache = await caches.open(CACHE);
  for (const req of await cache.keys()) {
    if (new URL(req.url).pathname.includes(`/packs/${id}/`)) await cache.delete(req);
  }
}
