// Service worker: precaches the site so it works offline, serves the
// toolchains the page installs (web/packs.js) from their own cache, serves
// the docs' pages out of their compressed chunks, and
// adds the cross-origin isolation headers (COOP/COEP) that SharedArrayBuffer
// needs, since GitHub Pages cannot send them itself.
//
// scripts/stamp-sw.mjs fills in VERSION and PRECACHE ([path, bytes] pairs)
// when the site is built.
import { createDocs } from "./docs.js";
import { decompress } from "./zstd.js";

const VERSION = "dev";
const PRECACHE = [];

const SCOPE = new URL(self.registration.scope).pathname;
/** Caches kept across versions: AI completion's runtime and model
 *  (web/lm.js), and optional toolchains (web/packs.js). */
const KEPT = ["lm", "packs"];
const TOTAL = PRECACHE.reduce((n, [, size]) => n + size, 0);

async function broadcast(msg) {
  for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage(msg);
}

/** Bytes of the precache already in this version's cache. */
async function cachedBytes(cache) {
  let done = 0;
  for (const [path, size] of PRECACHE) if (await cache.match(path)) done += size;
  return done;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    let done = await cachedBytes(cache);
    let lastReport = 0;
    const report = (force) => {
      if (force || Date.now() - lastReport > 250) {
        lastReport = Date.now();
        broadcast({ type: "offline-progress", done, total: TOTAL });
      }
    };
    report(true);
    // One file at a time, so a failed install resumes where it stopped.
    for (const [path, size] of PRECACHE) {
      if (await cache.match(path)) continue;
      const res = await fetch(path, { cache: "reload" });
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      // Count bytes as they arrive, for the progress bar.
      const reader = res.clone().body.getReader();
      const base = done;
      for (let r = await reader.read(), n = 0; !r.done; r = await reader.read()) {
        n += r.value.length;
        done = base + Math.min(n, size);
        report(false);
      }
      await cache.put(path, res);
      done = base + size;
    }
    report(true);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== VERSION && !KEPT.includes(name)) await caches.delete(name);
    await self.clients.claim();
    broadcast({ type: "offline-ready", version: VERSION });
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "offline-status") {
    event.waitUntil((async () => {
      const done = await cachedBytes(await caches.open(VERSION));
      event.source.postMessage({ type: done === TOTAL ? "offline-ready" : "offline-progress", done, total: TOTAL, version: VERSION });
    })());
  }
});

/** The response, with headers that make the page cross-origin isolated. */
function isolated(res) {
  if (res.status === 0) return res; // opaque: headers cannot be changed
  const headers = new Headers(res.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** The cached response for `req`: this version's, or a kept cache's. */
async function cached(req) {
  for (const name of [VERSION, ...KEPT]) {
    const res = await (await caches.open(name)).match(req, { ignoreSearch: true });
    if (res) return res;
  }
}

const serveDoc = createDocs({
  read: async (name) => {
    const res = (await cached(`docs/${name}`)) ?? (await fetch(`docs/${name}`));
    return new Uint8Array(await res.arrayBuffer());
  },
  decompress,
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Not from a cache, as web/packs.js asks for downloads.
  if (req.method !== "GET" || url.origin !== self.location.origin || req.cache === "no-store") return;
  const path = url.pathname.slice(SCOPE.length);
  event.respondWith((async () => {
    // Pages of the docs, but not the packed chunks they come from.
    if (path.startsWith("docs/") && !path.endsWith(".zst")) return isolated(await serveDoc(path.slice(5)));
    // Any other page in scope is the app: offline, the cached one.
    const res = (await cached(req))
      ?? (req.mode === "navigate" ? await (await caches.open(VERSION)).match("./") : undefined)
      ?? (await fetch(req));
    return isolated(res);
  })());
});
