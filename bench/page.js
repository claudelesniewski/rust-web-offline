// The AI suggestions benchmark's side in the page (see bench/ai.mjs): runs
// each case through createSuggester as web/app.js sets it up, with the real
// model and toolchains, in each configuration.
import { LANGUAGES } from "./languages.js";
import { loadModel } from "./lm.js";
import * as packs from "./packs.js";
import { createSuggester, withBlockBody } from "./suggest.js";
import { fixOnLine } from "./diagnostics.js";
import { createTypeCompletion } from "./types.js";

/** A worker's answers to requests: `ask(message)` posts it with an id and
 *  resolves with the message back that `answerOf(m)` finds for it. */
function requests(worker, answerOf) {
  let nextId = 1;
  const waiting = new Map();
  worker.addEventListener("message", ({ data: m }) => {
    const answer = answerOf(m);
    if (answer && waiting.has(m.id)) {
      waiting.get(m.id)(answer.value);
      waiting.delete(m.id);
    }
  });
  return (message) => new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    worker.postMessage({ ...message, id });
  });
}

const rustCompiler = new Worker("compiler-worker.js", { type: "module" });
const rustReady = new Promise((resolve) => rustCompiler.addEventListener("message", ({ data: m }) => m.type === "ready" && resolve()));
const askRust = requests(rustCompiler, (m) => (m.type === "checked" ? { value: m.output } : null));
const python = new Worker("python-worker.js", { type: "module" });
python.postMessage({ type: "init", stdin: new SharedArrayBuffer(8 + 64) });
const askPython = requests(python, (m) => (m.type === "answer" ? { value: m.value } : null));

/** For each language: members after a dot, and the check, of `doc` (file
 *  `main`) with the case's other files `others`. */
function toolchain(language, others) {
  const files = (doc) => [{ name: language.ext === ".rs" ? "main.rs" : "main.py", content: doc }, ...others];
  if (language.id === "rust") {
    const check = (source, json = false) => askRust({ type: "check", files: files(source), main: "main.rs", json });
    const types = createTypeCompletion({ check, fetchText: async (p) => (await fetch(p)).text() });
    return {
      main: "main.rs",
      members: (doc, from, to) => types(doc, from, to, files(doc), "main.rs"),
      check: async (source, line) => fixOnLine(await check(source, true), "main.rs", line, source.split("\n")[line - 1]),
    };
  }
  return {
    main: "main.py",
    members: async (doc, from, to) => {
      const before = doc.slice(0, to);
      const options = await askPython({ type: "complete", files: files(doc), name: "main.py",
        line: before.split("\n").length, col: to - before.lastIndexOf("\n") - 1 });
      return options?.length ? options : null;
    },
    check: async (source, line) => ((await askPython({ type: "lint", source: withBlockBody(source, line) })).includes(line)
      ? { fixed: null } : null),
  };
}

/** The case's code as an editor would have it: Rust's blocks closed. */
const documentOf = (language, code) => {
  if (language.id !== "rust") return `${code}\n`;
  const depth = (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
  return `${code}\n${"}\n".repeat(Math.max(0, depth))}`;
};

/** Each configuration's results on each case of `suites` ({ language id:
 *  cases }), with the model at model.gguf (laid out as `format`, `fim` if it
 *  sees the code after the cursor): { config: { id: [{ text, ok, checked,
 *  ms }] } }. */
export async function run(suites, configs, { format, fim = false }) {
  const all = await packs.available();
  if (suites.python) await packs.install(all.python, "python");
  if (suites.rust) await rustReady;
  const model = await loadModel(await (await fetch("model.gguf")).blob(), format);
  const results = {};
  for (const [name, config] of Object.entries(configs)) {
    results[name] = {};
    for (const [id, cases] of Object.entries(suites)) {
      const language = LANGUAGES.find((l) => l.id === id);
      // A configuration may name the repository in the prompt differently.
      const ai = { ...language.ai, ...config.ai?.[id] };
      const rows = [];
      // Once first, so that no case counts the toolchain's loading.
      const warm = toolchain(language, []);
      await warm.check(documentOf(language, cases[0].code), 1);
      await warm.members("x = [].", 7, 7);
      for (const { code, expect, others = [] } of cases) {
        const tools = toolchain(language, others);
        const suggest = createSuggester({
          complete: model.complete,
          ai,
          members: config.constrain ? tools.members : null,
          check: config.check ? tools.check : null,
          main: () => tools.main,
          others: () => others,
          fixes: config.fixes,
          retries: config.retries,
          fim: config.fim ?? fim,
        });
        const doc = documentOf(language, code);
        const t0 = performance.now();
        const text = await suggest(doc, code.length, null);
        const ms = Math.round(performance.now() - t0);
        const line = code.split("\n").length;
        const checked = !!text.trim() && !(await tools.check(code + text + doc.slice(code.length), line));
        rows.push({ text, ok: new RegExp(expect).test(text.replace(/^\s+/, "")), checked, ms });
      }
      results[name][id] = rows;
    }
  }
  return results;
}
