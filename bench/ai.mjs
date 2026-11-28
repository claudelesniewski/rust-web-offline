// Benchmark of AI suggestions: how often the model, with the toolchain's
// help, suggests the right rest of a line, in Rust and in Python.
//
//   scripts/build.sh && node bench/ai.mjs [rust|python] [configs.json]
//
// Each language's cases (bench/<language>.json) are lines of small programs
// cut where a programmer would want a suggestion: { group, code, expect,
// others? }, where `expect` is a regular expression for a right suggestion
// and `others` the project's other files. The groups: "tune", for trying
// prompts and constraints on; "held-out", unlike those, to tell whether a
// change only fits them; "multi-file", where the right line needs another
// file. Configurations ({ name: { constrain, check, fixes, retries, fim, ai } })
// turn on holding the model to the members there after a dot, and checking
// the suggestion with the toolchain; `fixes`, `retries` and `fim` override
// createSuggester's (web/suggest.js; `fim` is the model's, by default), and
// `ai` ({ language: { repo } }) tries another name for the repository in the
// prompt. MODEL picks the model (below); set V=1 to see each suggestion.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { PREFIX, serve } from "../tests/serve.mjs";

const languages = process.argv[2] ? [process.argv[2]] : ["rust", "python"];
const configs = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : {
  "toolchain (as the app)": { constrain: true, check: true },
  "check only": { check: true },
  "constrain only": { constrain: true },
  "model only": {},
};

const site = mkdtempSync(join(tmpdir(), "ai-bench-"));
cpSync("build/site", site, { recursive: true });
cpSync("bench/page.js", join(site, "bench.js"));
// The model: MODEL, one of the app's (a pack's id, SmolLM2-135M's by
// default), downloaded once into build/cache/ai-bench; or a GGUF file, laid
// out as FORMAT (web/lm.js: starcoder2 or qwen).
const pinned = JSON.parse(readFileSync(join(site, "packs.json"), "utf8"));
const choice = process.env.MODEL ?? "model-smollm2-135m";
let model;
let modelOf = { format: process.env.FORMAT ?? "starcoder2" };
if (pinned[choice]?.model) {
  const { base, files: [file], model: m } = pinned[choice];
  const cached = `build/cache/ai-bench/${file.name}`;
  if (!existsSync(cached)) {
    mkdirSync("build/cache/ai-bench", { recursive: true });
    console.log(`downloading ${base}${file.name}`);
    writeFileSync(cached, Buffer.from(await (await fetch(base + file.name)).arrayBuffer()));
  }
  model = readFileSync(cached);
  if (createHash("sha256").update(model).digest("hex") !== file.sha256) throw new Error(`${cached}: checksum mismatch`);
  modelOf = m;
} else {
  model = readFileSync(choice);
}
writeFileSync(join(site, "model.gguf"), model);
// Python from the files fetch-toolchain.sh pinned, as tests/e2e.mjs has it.
cpSync("build/cache/toolchain/test/pyodide", join(site, "test-pyodide"), { recursive: true });
pinned.python.base = "test-pyodide/";
writeFileSync(join(site, "packs.json"), JSON.stringify(pinned));

const server = await serve(site);
// A profile on disk: an in-memory one has too little room for a larger model.
const profile = mkdtempSync(join(tmpdir(), "ai-bench-profile-"));
const browser = await chromium.launchPersistentContext(profile);
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("page error:", e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}${PREFIX}`);
  await page.locator("#offline.ready").waitFor({ timeout: 300_000 });
  await page.waitForFunction(() => crossOriginIsolated, null, { timeout: 60_000 });
  const suites = Object.fromEntries(languages.map((l) => [l, JSON.parse(readFileSync(`bench/${l}.json`, "utf8"))]));
  const results = await page.evaluate(async ([s, c, m]) => (await import("./bench.js")).run(s, c, m), [suites, configs, modelOf]);
  for (const [name, byLanguage] of Object.entries(results)) {
    for (const [language, rows] of Object.entries(byLanguage)) {
      const good = (r) => r.ok && r.checked;
      const of = (group) => {
        const inGroup = rows.filter((_, i) => suites[language][i].group === group);
        return `${inGroup.filter(good).length}/${inGroup.length} ${group}`;
      };
      const ms = rows.map((r) => r.ms);
      console.log(`${language}, ${name}: ${rows.filter(good).length}/${rows.length} right and checked`
        + ` (${of("tune")}, ${of("held-out")}, ${of("multi-file")}); ${rows.filter((r) => r.ok).length} right,`
        + ` ${rows.filter((r) => r.text.trim()).length} shown, ${rows.filter((r) => r.checked).length} pass the check;`
        + ` ${Math.round(ms.reduce((a, b) => a + b, 0) / ms.length)} ms on average, ${Math.max(...ms)} at most`);
      if (process.env.V) {
        rows.forEach((r, i) => console.log(`  ${r.ok ? "+" : r.checked ? "c" : "-"} ${String(i).padStart(2)} ${String(r.ms).padStart(5)} ms ${JSON.stringify(r.text)}`));
      }
    }
  }
} finally {
  await browser.close();
  server.close();
  rmSync(site, { recursive: true });
  rmSync(profile, { recursive: true });
}
