// Packs a subset of the Rust documentation for offline use: files sorted by
// path and concatenated into ~8 MB chunks, each compressed with zstd. Pages
// share most of their markup, so a chunk compresses ~20x, where compressing
// each file alone gets ~9x. The service worker (web/docs.js) decompresses a
// chunk when one of its pages is requested.
//
//   node pack-docs.mjs <html-dir> <out-dir>
// writes <out-dir>/<n>.<hash>.zst and <out-dir>/index.json.zst, which is
// { chunks: [name], files: { path: [chunk, offset, length] } }.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { constants, zstdCompressSync } from "node:zlib";

/** What to include, relative to the docs' html directory. */
const DIRS = ["book", "reference", "std", "core", "alloc", "static.files", "search.index", "type.impl", "trait.impl"];
const EXCLUDE = [
  /^core\/(arch|core_arch)\//, // SIMD intrinsics for every platform: two thirds of all pages
  /^book\/(first|second|2018)-edition\//, // stubs pointing to the current edition
  /^(book|reference)\/print\.html$/, // every chapter again, on one page
];
const CHUNK = 8_000_000;

const compress = (bytes) => zstdCompressSync(bytes, {
  params: { [constants.ZSTD_c_compressionLevel]: 19, [constants.ZSTD_c_windowLog]: 23 },
});

/** Pack `files` ([{ path, bytes }], sorted) into compressed chunks:
 *  returns { chunks: [Uint8Array], files: { path: [chunk, offset, length] } }. */
export function pack(files, chunkSize = CHUNK) {
  const chunks = [];
  const index = {};
  let parts = [];
  let size = 0;
  const flush = () => {
    if (parts.length) chunks.push(compress(Buffer.concat(parts)));
    parts = [];
    size = 0;
  };
  for (const { path, bytes } of files) {
    index[path] = [chunks.length, size, bytes.length];
    parts.push(bytes);
    size += bytes.length;
    if (size >= chunkSize) flush();
  }
  flush();
  return { chunks, files: index };
}

/** The files of the docs at `root` that are served offline. */
export function selectFiles(root) {
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [relative(root, p).split("\\").join("/")];
  });
  const topLevel = readdirSync(root).filter((n) => !statSync(join(root, n)).isDirectory() && !n.startsWith("releases."));
  return [...topLevel, ...DIRS.flatMap((d) => walk(join(root, d)))]
    .filter((p) => !EXCLUDE.some((re) => re.test(p)))
    .sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [root, out] = process.argv.slice(2);
  const files = selectFiles(root).map((path) => ({ path, bytes: readFileSync(join(root, path)) }));
  const { chunks, files: index } = pack(files);
  mkdirSync(out, { recursive: true });
  const names = chunks.map((c, i) => {
    const name = `${i}.${createHash("sha256").update(c).digest("hex").slice(0, 12)}.zst`;
    writeFileSync(join(out, name), c);
    return name;
  });
  writeFileSync(join(out, "index.json.zst"), compress(Buffer.from(JSON.stringify({ chunks: names, files: index }))));
  const raw = files.reduce((n, f) => n + f.bytes.length, 0);
  const packed = chunks.reduce((n, c) => n + c.length, 0);
  console.log(`packed docs: ${files.length} files, ${(raw / 1e6).toFixed(0)} MB into ${chunks.length} chunks, ${(packed / 1e6).toFixed(1)} MB`);
}
