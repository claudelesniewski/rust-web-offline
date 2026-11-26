// AI completion: a small language model (SmolLM2-135M) run in the browser
// by wllama (llama.cpp compiled to wasm). Off by default; turning it on
// downloads the runtime and the model (lm/index.json, made by
// scripts/build.sh) into a cache of their own, which sw.js keeps across
// versions, so it works offline from then on.

const CACHE = "lm"; // the name sw.js keeps
/** Shown to the model before the code, so it continues in idiomatic Rust
 *  rather than in some other language. */
const PREAMBLE = `// Idiomatic Rust (edition 2024), standard library only.
use std::collections::HashMap;
use std::io::{self, BufRead};

#[derive(Debug, Clone, PartialEq)]
struct Item {
    name: String,
    price: f64,
}

impl Item {
    fn new(name: &str, price: f64) -> Self {
        Item { name: name.to_string(), price }
    }
}

fn read_numbers() -> Vec<i64> {
    let mut line = String::new();
    io::stdin().read_line(&mut line).expect("read failed");
    line.split_whitespace().filter_map(|s| s.parse().ok()).collect()
}

fn tally(words: &[&str]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for w in words {
        *counts.entry(w.to_string()).or_insert(0) += 1;
    }
    counts
}

`;
/** How much of the code before the cursor the model sees, in characters. */
const CONTEXT = 1500;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The response for `url` from the cache, downloading it first if needed. */
async function cached(cache, url) {
  if (!(await cache.match(url))) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    await cache.put(url, res);
  }
  return cache.match(url);
}

/** The model from the cache, downloading it first if needed, checked
 *  against its SHA-256; `onProgress(done, total)` follows the download. */
async function cachedModel(cache, { url, sha256, size }, onProgress) {
  const hit = await cache.match(url);
  if (hit) return hit.blob();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const reader = res.body.getReader();
  const parts = [];
  let done = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    parts.push(r.value);
    done += r.value.length;
    onProgress(done, size);
  }
  const blob = new Blob(parts);
  if (hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())) !== sha256) {
    throw new Error("the downloaded model is corrupt (checksum mismatch)");
  }
  await cache.put(url, new Response(blob));
  return blob;
}

/** Whether the model has been downloaded already. */
export async function isDownloaded() {
  const index = await (await fetch("lm/index.json")).json();
  return !!(await (await caches.open(CACHE)).match(index.model.url));
}

/** Download (if needed) and load the model. `onProgress(done, total)`
 *  follows the download. Returns { complete(prefix, signal), unload() }. */
export async function loadModel(onProgress) {
  const index = await (await fetch("lm/index.json")).json();
  const cache = await caches.open(CACHE);
  const keep = new Set([index.js, index.wasm, index.model.url].map((u) => new URL(u, location.href).href));
  // Files of earlier versions.
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);

  const model = await cachedModel(cache, index.model, onProgress);
  await cached(cache, index.wasm);
  await cached(cache, index.js);
  const { Wllama } = await import(new URL(index.js, location.href).href);
  const wllama = new Wllama({ default: new URL(index.wasm, location.href).href }, { suppressNativeLog: true });
  // On the CPU: for a model this small, as fast, and more predictable.
  await wllama.loadModel([model], { n_ctx: 1024, n_gpu_layers: 0 });
  // Read the preamble once now: later prompts start with it, and reuse it.
  await wllama.createCompletion({ prompt: PREAMBLE, max_tokens: 1 });

  return {
    /** The likeliest continuation of the line `prefix` ends in, or "";
     *  `grammar` (GBNF) constrains it. */
    async complete(prefix, signal, { grammar } = {}) {
      // A space at the end tokenizes badly (words' tokens start with one):
      // let the model write it instead. Measured on 18 lines: dropping all
      // the indentation instead made the model start new items (4 right,
      // against 7); keeping it all, 6.
      const typed = prefix.endsWith(" ") ? " " : "";
      const r = await wllama.createCompletion({
        prompt: PREAMBLE + prefix.slice(-CONTEXT, prefix.length - typed.length),
        max_tokens: 32, temperature: 0, grammar, stop: ["\n"], abortSignal: signal,
      });
      const text = (r.choices[0]?.text ?? "").replace(/\n$/, "");
      return typed ? text.replace(/^[ \t]+/, "") : text;
    },
    unload: () => wllama.exit(),
  };
}
