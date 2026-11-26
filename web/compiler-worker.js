// The compiler worker: loads the toolchain into a browser-kernel, then
// compiles and runs programs for the page. Adapted from
// rust-playground-inbrowser's web/kernel/kernel-worker.js (Apache-2.0),
// trimmed to std-only programs.
//
// Messages from the page:
//   { type: "run", id, files: [{ name, content }], main }
//       Compile `main` (one of `files`, all written side by side in src/ so
//       `mod other;` works) and, if that succeeds, run it.
//   { type: "format", id, name, content }   rustfmt one file
//   { type: "check", id, files, main }      type-check only (for type-aware
//                                           completion); answered by "checked"
//   { type: "stdin", id, text }              feed the running program
//   { type: "eof", id }                      close its stdin
//   { type: "kill", id }                     stop compiling or running
// Messages to the page:
//   { type: "status", text }
//   { type: "ready" }
//   { type: "output", id, stream: "compiler" | "stdout" | "stderr", text }
//   { type: "done", id, stage: "compile" | "run" | "format", code, ms, formatted? }
//   { type: "checked", id, output }          the check's diagnostics, as text
//   { type: "error", id?, text }

import { Kernel, OutOfMemoryError, importedMemory } from "./browser-kernel/kernel.js";
import { File } from "./browser-kernel/fs.js";

const SYSROOT = "/sysroot";
const TARGET = "wasm32-wasip1-threads";
const SELF_CONTAINED = `${SYSROOT}/lib/rustlib/${TARGET}/lib/self-contained`;

// Memory limits, in 64 KiB pages, tried in turn, largest first. Shared
// memory is reserved up front, so devices with little memory get less.
const MIB = 16;
const LOW_MEMORY = (self.navigator?.deviceMemory ?? 8) < 4;
const limits = (low, normal) => (LOW_MEMORY ? low : normal).map((mib) => mib * MIB);
const RUSTC_MAX_PAGES = limits([512, 384, 256], [1024, 512, 384]);
const LINKER_MAX_PAGES = limits([128, 64], [256, 128]);
const PROGRAM_MAX_PAGES = limits([512, 256, 128, 64], [2048, 1024, 512, 256]);

const status = (text) => postMessage({ type: "status", text });

function createBrowserWorker() {
  const w = new Worker(new URL("./browser-kernel/thread-worker.js", import.meta.url), { type: "module" });
  return {
    postMessage: (m) => w.postMessage(m),
    onMessage: (f) => {
      w.onmessage = (e) => f(e.data);
      w.onerror = (e) => f({ type: "failed", message: e.message || "worker failed to load" });
    },
    terminate: () => w.terminate(),
  };
}

async function fetchOk(url) {
  const res = await fetch(new URL(url, import.meta.url));
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res;
}

/** The files at `urls`, one after the other, as one stream: big toolchain
 *  files are split into parts (see scripts/build.sh). */
function joined(urls) {
  return new ReadableStream({
    async start(controller) {
      for (const url of urls) {
        const reader = (await fetchOk(url)).body.getReader();
        for (let r = await reader.read(); !r.done; r = await reader.read()) controller.enqueue(r.value);
      }
      controller.close();
    },
  });
}

/** Download, decompress and compile a gzipped toolchain program. */
async function program(urls) {
  const bytes = new Uint8Array(
    await new Response(joined(urls).pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  return { module: await WebAssembly.compile(bytes), limits: importedMemory(bytes) };
}

/** Add a sysroot bundle (rust-playground-inbrowser's scripts/bundle.py
 *  format) to the filesystem under `root`. Files stay compressed until opened. */
function addBundle(fs, bundle, root) {
  const view = new DataView(bundle.buffer, bundle.byteOffset);
  if (new TextDecoder().decode(bundle.subarray(0, 4)) !== "PGB2") throw new Error(`${root}: not a bundle`);
  const len = view.getUint32(4, true);
  const files = JSON.parse(new TextDecoder().decode(bundle.subarray(8, 8 + len)));
  const base = 8 + len;
  for (const [path, offset, length, size] of files) {
    const bytes = bundle.slice(base + offset, base + offset + length);
    const file = length === size ? new File(bytes) : File.compressed(bytes, size);
    const parts = path.split("/");
    const name = parts.pop();
    fs.mkdirp(`${root}/${parts.join("/")}`).entries.set(name, file);
  }
}

let kernel, rustc;
let readyResolve;
const ready = new Promise((r) => (readyResolve = r));
/** The process each request is waiting for. */
const running = new Map();
const killed = new Set();

async function init() {
  try {
    status("Loading the Rust toolchain…");
    const names = await (await fetchOk("./toolchain/index.json")).json();
    const [compiler, linker, sysroot] = await Promise.all([
      program(names.rustc),
      program(names.wild),
      new Response(joined(names.sysroot)).arrayBuffer().then((b) => new Uint8Array(b)),
    ]);
    const wasmLd = { ...linker, maxPages: LINKER_MAX_PAGES };
    rustc = { ...compiler, maxPages: RUSTC_MAX_PAGES };
    kernel = new Kernel({ createWorker: createBrowserWorker, programs: { "wasm-ld": wasmLd }, pool: LOW_MEMORY ? 0 : 4 });
    if (!LOW_MEMORY) {
      kernel.keepWarm(rustc);
      kernel.keepWarm(wasmLd);
    }
    addBundle(kernel.fs, sysroot, SYSROOT);
    kernel.fs.mkdirp("/tmp");
    kernel.fs.mkdirp("/work");
    status("Ready.");
    postMessage({ type: "ready" });
    readyResolve();
  } catch (e) {
    postMessage({ type: "error", text: `Failed to load the toolchain: ${errorText(e)}` });
  }
}

/** A stream writer that decodes UTF-8 split across chunks. */
function sink(id, stream) {
  const dec = new TextDecoder();
  return (bytes) => {
    if (!killed.has(id)) postMessage({ type: "output", id, stream, text: dec.decode(bytes, { stream: true }) });
  };
}

/** Compiles one at a time: a type check for completion can come while a
 *  program compiles. */
let compilerFree = Promise.resolve();

/** Run the compiler with `args` on `files`, written into /work/<id>/src;
 *  its output goes to `out`, by default the page's output panel. */
async function compile(id, files, args, { env = {}, out = sink(id, "compiler") } = {}) {
  const dir = `/work/${id}`;
  const before = compilerFree;
  let free;
  compilerFree = new Promise((resolve) => (free = resolve));
  await before;
  try {
    if (killed.has(id)) return { code: 137, dir };
    for (const { name, content } of files) kernel.fs.writeFile(`${dir}/src/${name}`, content);
    const proc = kernel.spawn(rustc, {
      args: args(`${dir}/src`, dir),
      env: { RUST_BACKTRACE: "0", HOME: "/tmp", TMPDIR: "/tmp", ...env },
      stdout: out,
      stderr: out,
    });
    running.set(id, proc);
    return { code: await proc.exited, dir };
  } finally {
    running.delete(id);
    free();
  }
}

async function run({ id, files, main }) {
  await ready;
  status("Compiling…");
  let t0 = performance.now();
  const { code, dir } = await compile(id, files, (src, dir) => [
    "rustc", `${src}/${main}`, "--edition=2024", "--crate-name=main", "--crate-type=bin",
    `--target=${TARGET}`, `--sysroot=${SYSROOT}`, "-o", `${dir}/out.wasm`, "-Copt-level=0",
    // Trap on stack overflow instead of corrupting the heap (no guard pages in wasm).
    "-Cllvm-args=wasm-stack-limit",
    // Diagnostics name files as src/main.rs, as Cargo would.
    `--remap-path-prefix=${dir}/=`,
    // The target's C runtime, passed by hand to the in-browser linker.
    "-Clinker=wasm-ld", "-Clinker-flavor=wasm-ld",
    `-Clink-arg=${SELF_CONTAINED}/crt1-command.o`, "-L", SELF_CONTAINED,
    "-Clink-arg=--max-memory=4294967296",
    "--color=always", "-Zthreads=1",
  ]);
  const built = code === 0 && !killed.has(id) ? kernel.fs.readFile(`${dir}/out.wasm`)?.slice() : undefined;
  kernel.fs.remove(dir);
  postMessage({ type: "done", id, stage: "compile", code: killed.has(id) ? 137 : code, ms: performance.now() - t0 });
  if (!built) return finish(id);

  status("Running…");
  t0 = performance.now();
  const proc = kernel.spawn({ bytes: built, module: await WebAssembly.compile(built), maxPages: PROGRAM_MAX_PAGES }, {
    args: [main.replace(/\.rs$/, "")],
    env: { RUST_BACKTRACE: "0" },
    stdin: "pipe",
    stdout: sink(id, "stdout"),
    stderr: sink(id, "stderr"),
  });
  running.set(id, proc);
  if (killed.has(id)) kernel.kill(proc);
  const runCode = await proc.exited;
  running.delete(id);
  postMessage({ type: "done", id, stage: "run", code: runCode, ms: performance.now() - t0 });
  finish(id);
}

async function format({ id, name, content }) {
  await ready;
  status("Formatting…");
  const t0 = performance.now();
  const { code, dir } = await compile(id, [{ name, content }],
    (src) => ["rustfmt", "--edition=2024", `${src}/${name}`], { env: { RUSTC_RUSTFMT: "1" } });
  const bytes = kernel.fs.readFile(`${dir}/src/${name}`);
  kernel.fs.remove(dir);
  const formatted = code === 0 && bytes ? new TextDecoder().decode(bytes) : undefined;
  postMessage({ type: "done", id, stage: "format", code, ms: performance.now() - t0, formatted });
  finish(id);
}

async function check({ id, files, main }) {
  await ready;
  const dec = new TextDecoder();
  let output = "";
  const { dir } = await compile(id, files, (src, dir) => [
    "rustc", `${src}/${main}`, "--edition=2024", "--crate-name=main", "--crate-type=bin",
    `--target=${TARGET}`, `--sysroot=${SYSROOT}`, "--emit=metadata", "-o", `${dir}/out.rmeta`,
    `--remap-path-prefix=${dir}/=`, "--color=never", "-Zthreads=1",
  ], { out: (bytes) => { output += dec.decode(bytes, { stream: true }); } });
  kernel.fs.remove(dir);
  killed.delete(id);
  postMessage({ type: "checked", id, output });
}

function finish(id) {
  killed.delete(id);
  status("Ready.");
}

function errorText(err) {
  if (err instanceof OutOfMemoryError || !(err instanceof Error)) return String(err?.message ?? err);
  return `${err.name}: ${err.message}`;
}

onmessage = ({ data: m }) => {
  const fail = (err) => postMessage({ type: "error", id: m.id, text: errorText(err) });
  if (m.type === "run") run(m).catch(fail);
  else if (m.type === "format") format(m).catch(fail);
  else if (m.type === "check") check(m).catch(fail);
  else if (m.type === "stdin") running.get(m.id)?.writeStdin?.(new TextEncoder().encode(m.text));
  else if (m.type === "eof") running.get(m.id)?.closeStdin?.();
  else if (m.type === "kill") {
    killed.add(m.id);
    const proc = running.get(m.id);
    if (proc) kernel.kill(proc);
  }
};

init();
