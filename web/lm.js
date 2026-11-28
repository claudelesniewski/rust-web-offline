// AI completion: a small language model (SmolLM2-135M) run in the browser
// by wllama (llama.cpp compiled to wasm). Off by default; turning it on
// downloads the runtime and the model (lm/index.json, made by
// scripts/build.sh) into a cache of their own, which sw.js keeps across
// versions, so it works offline from then on.

const CACHE = "lm"; // the name sw.js keeps
/** The prompt is laid out as files of a repository, in the format of the
 *  model's code training data (StarCoder2's), so it continues them as code
 *  of that kind: the project's other files, then the open file up to the
 *  cursor. Measured on 26 lines of Rust, 8 of them unlike any example the
 *  model was shown before: as good as a preamble of idiomatic Rust (9 or 10
 *  right), better on those 8 (3 against 1), and 30% faster. The repository's
 *  name and paths are the language's (web/languages.js). */
/** How much of the other files the model sees, in characters. */
const OTHERS = 2000;
/** How much of the code before the cursor the model sees, in characters. */
const CONTEXT = 1500;

/** How each kind of model was shown repositories in training: StarCoder2's
 *  data (SmolLM2), or Qwen2.5-Coder's; and, for those trained so, the code
 *  after the cursor too (fill in the middle). */
const FORMATS = {
  starcoder2: { repo: (name) => `<repo_name>${name}`, file: (path, text) => `<file_sep>${path}\n${text}` },
  qwen: {
    repo: (name) => `<|repo_name|>${name}\n`,
    file: (path, text) => `<|file_sep|>${path}\n${text}\n`,
    fim: (path, before, after) => `<|file_sep|>${path}\n<|fim_prefix|>${before}<|fim_suffix|>${after}<|fim_middle|>`,
  },
};

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
  await wllama.loadModel([model], { n_ctx: 2048, n_gpu_layers: 0 });

  return {
    /** The likeliest continuation of the line `prefix` (of file `file`, a
     *  path in repository `repo`) ends in, or ""; `grammar` (GBNF)
     *  constrains it. `others` are the project's other files ([{ name (a
     *  path), content }]), for context. */
    async complete(prefix, signal, { grammar, repo = "rust-examples", file = "src/main.rs", others = [], suffix = null } = {}) {
      // A space at the end tokenizes badly (words' tokens start with one):
      // let the model write it instead. Measured on 18 lines: dropping all
      // the indentation instead made the model start new items (4 right,
      // against 7); keeping it all, 6.
      const typed = prefix.endsWith(" ") ? " " : "";
      const format = FORMATS[index.model.format ?? "starcoder2"];
      let prompt = format.repo(repo);
      let room = OTHERS;
      for (const other of others) {
        if (room <= 0) break;
        prompt += format.file(other.name, other.content.slice(0, room));
        room -= other.content.length;
      }
      const before = prefix.slice(-CONTEXT, prefix.length - typed.length);
      prompt += suffix !== null && format.fim ? format.fim(file, before, suffix.slice(0, CONTEXT))
        : format.file(file, before).replace(/\n$/, "");
      const r = await wllama.createCompletion({
        prompt,
        // 48: at 32, a long line was cut before its end, and failed the check
        // (Python's, on bench/: 22 right in 29, against 21; Rust's the same).
        max_tokens: 48, temperature: 0, grammar, stop: ["\n"], abortSignal: signal,
      });
      const text = (r.choices[0]?.text ?? "").replace(/\n$/, "");
      return typed ? text.replace(/^[ \t]+/, "") : text;
    },
    unload: () => wllama.exit(),
  };
}
