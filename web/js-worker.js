// Runs JavaScript and TypeScript programs: the open file and the project's
// files it imports, as ES modules (web/js-modules.js), TypeScript's first
// stripped of their types by the TypeScript pack's compiler. One worker per
// run, so that each starts afresh; Stop terminates it.
//
// Messages from the page:
//   { type: "init", stdin }        stdin: a SharedArrayBuffer, as python-worker.js's
//   { type: "run", id, files, main }
// Messages to the page:
//   { type: "output", id, stream: "stdout" | "stderr", text }
//   { type: "stdin", id }          the program waits for a line of input
//   { type: "done", id, code, ms } once the main module, and the timers it
//                                  set, have run; or at an uncaught error
//   { type: "error", id, text }
import { decodeMappings, inspect, mapStack, moduleOrder, originalPosition, resolveImport, rewriteImports } from "./js-modules.js";

let ctrl, bytes;
let id = null;
let t0 = 0;
let finished = false;
/** Each module's Blob URL -> { file, map }: its decoded source map, if any. */
const modules = new Map();

const post = (m) => postMessage({ ...m, id });
const write = (stream, args) => post({ type: "output", stream, text: `${args.map((a) => show(a)).join(" ")}\n` });
const show = (value) => (value instanceof Error ? stackOf(value) : inspect(value));

function stackOf(error) {
  return mapStack(error.stack ?? String(error), (url, line, col) => {
    const m = modules.get(url);
    if (!m) return null;
    const at = m.map ? originalPosition(m.map, line, col) : { line, col };
    return at && { file: m.file, ...at };
  });
}

function done(code) {
  if (finished) return;
  finished = true;
  post({ type: "done", code, ms: performance.now() - t0 });
}

/** A line of input from the page (without its newline), or null at its end. */
function readLine() {
  post({ type: "stdin" });
  Atomics.wait(ctrl, 0, 0);
  const n = ctrl[1];
  const line = n < 0 ? null : new TextDecoder().decode(bytes.slice(0, n)).replace(/\r?\n$/, "");
  Atomics.store(ctrl, 0, 0);
  return line;
}

// The program's console and input(), as a terminal's.
console.log = console.info = console.debug = (...args) => write("stdout", args);
console.error = console.warn = (...args) => write("stderr", args);
globalThis.input = globalThis.prompt = (question = "") => {
  if (question !== "") post({ type: "output", stream: "stdout", text: String(question) });
  return readLine();
};

// Timers it set: the program ends once they have all run (or been cleared).
const timers = new Set();
const { setTimeout: set, clearTimeout: clear, setInterval: every, clearInterval: clearEvery } = globalThis;
/** Whether the main module has run. */
let main = false;
const settle = () => queueMicrotask(() => { if (main && !timers.size) done(0); });
globalThis.setTimeout = (fn, ms, ...args) => {
  const t = set(() => {
    timers.delete(t);
    if (typeof fn === "function") fn(...args);
    settle();
  }, ms);
  timers.add(t);
  return t;
};
globalThis.clearTimeout = (t) => (clear(t), timers.delete(t), settle());
globalThis.setInterval = (...args) => {
  const t = every(...args);
  timers.add(t);
  return t;
};
globalThis.clearInterval = (t) => (clearEvery(t), timers.delete(t), settle());

const fail = (error) => {
  post({ type: "output", stream: "stderr", text: `Uncaught ${show(error)}\n` });
  done(1);
};
addEventListener("error", (e) => (e.preventDefault(), fail(e.error ?? e.message)));
addEventListener("unhandledrejection", (e) => (e.preventDefault(), fail(e.reason)));

/** TypeScript's compiler, from the pack (its file defines a global `ts`). */
async function typescript() {
  const res = await fetch(new URL("packs/typescript/typescript.js", self.location));
  if (!res.ok) throw new Error("TypeScript isn't installed");
  return new Function(`${await res.text()}\nreturn ts;`)();
}

/** The modules' code, by name: TypeScript's transpiled, with source maps;
 *  or null (and the errors written) if one doesn't parse. */
async function compile(files, order) {
  const ts = order.some((n) => n.endsWith(".ts")) ? await typescript() : null;
  const out = new Map();
  let ok = true;
  for (const name of order) {
    if (!name.endsWith(".ts")) {
      out.set(name, { code: files.get(name), map: null });
      continue;
    }
    const result = ts.transpileModule(files.get(name), {
      fileName: name,
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024, sourceMap: true },
    });
    for (const d of result.diagnostics) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      post({ type: "output", stream: "stderr", text: `${name}:${line + 1}:${character + 1} - error TS${d.code}: ${message}\n` });
      ok = false;
    }
    const code = result.outputText.replace(/\n\/\/# sourceMappingURL=.*\s*$/, "\n");
    out.set(name, { code, map: decodeMappings(JSON.parse(result.sourceMapText).mappings) });
  }
  return ok ? out : null;
}

async function run({ files: list, main: name }) {
  t0 = performance.now();
  const files = new Map(list.filter((f) => /\.[jt]s$/.test(f.name)).map((f) => [f.name, f.content]));
  const order = moduleOrder(files, name);
  const compiled = await compile(files, order);
  if (!compiled) return done(1);
  const names = new Set(files.keys());
  const urls = new Map();
  for (const file of order) {
    const { code, map } = compiled.get(file);
    const linked = rewriteImports(code, (spec) => urls.get(resolveImport(file, spec, names)) ?? null);
    const url = URL.createObjectURL(new Blob([linked], { type: "text/javascript" }));
    urls.set(file, url);
    modules.set(url, { file, map });
  }
  try {
    await import(urls.get(name));
  } catch (e) {
    return fail(e);
  }
  main = true;
  settle();
}

onmessage = ({ data: m }) => {
  if (m.type === "init") {
    ctrl = new Int32Array(m.stdin, 0, 2);
    bytes = new Uint8Array(m.stdin, 8);
  } else if (m.type === "run") {
    id = m.id;
    run(m).catch((e) => post({ type: "error", text: String(e?.message ?? e) }));
  }
};
