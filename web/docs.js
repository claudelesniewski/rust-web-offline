// Serves the offline Rust documentation from the chunks made by
// scripts/pack-docs.mjs, for the service worker.

const TYPES = {
  html: "text/html", js: "text/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png",
  woff2: "font/woff2", woff: "font/woff", json: "application/json", txt: "text/plain", md: "text/plain",
};
/** Decompressed chunks kept in memory, most recently used last. */
const KEEP = 4;

/** `read(name)` returns the bytes of a file under docs/ (a chunk or the
 *  index); `decompress` undoes zstd. Returns `serve(path)`, which answers a
 *  request for `path` (relative to docs/) with a Response. */
export function createDocs({ read, decompress }) {
  let index = null;
  const recent = new Map();
  const json = async (name) => JSON.parse(new TextDecoder().decode(decompress(await read(name))));

  async function chunk(n) {
    const name = (await (index ??= json("index.json.zst"))).chunks[n];
    let bytes = recent.get(name);
    if (bytes) recent.delete(name);
    else {
      bytes = decompress(await read(name));
      if (recent.size >= KEEP) recent.delete(recent.keys().next().value);
    }
    recent.set(name, bytes);
    return bytes;
  }

  return async function serve(path) {
    const { files } = await (index ??= json("index.json.zst"));
    if (path === "" || path.endsWith("/")) path += "index.html";
    const entry = files[path] ?? files[`${path}/index.html`];
    if (!entry) return notIncluded(path);
    const [n, offset, length] = entry;
    const body = (await chunk(n)).slice(offset, offset + length);
    const type = TYPES[path.slice(path.lastIndexOf(".") + 1)] ?? "application/octet-stream";
    return new Response(body, { headers: { "Content-Type": type } });
  };
}

function notIncluded(path) {
  const online = `https://doc.rust-lang.org/nightly/${path.replace(/[<>"&]/g, "")}`;
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Not available offline</title>
<body style="font: 16px system-ui; margin: 2em">
<h1>Not available offline</h1>
<p>This page is not part of the offline documentation (which has the Book, the
Reference, and the std, core and alloc APIs).</p>
<p>Online: <a href="${online}">${online}</a></p>`,
    { status: 404, headers: { "Content-Type": "text/html" } });
}
