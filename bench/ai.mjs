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
// file. Configurations ({ name: { constrain, check, fixes, retries, ai } })
// turn on holding the model to the members there after a dot, and checking
// the suggestion with the toolchain; `fixes` and `retries` override
// createSuggester's (web/suggest.js), and `ai` ({ language: { repo } })
// tries another name for the repository in the prompt. The real model is downloaded once (145 MB) into
// build/cache/ai-bench; set V=1 to see each suggestion.
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
// The real model, as the app has it, from the cache.
const index = JSON.parse(readFileSync(join(site, "lm/index.json"), "utf8"));
const cached = "build/cache/ai-bench/model.gguf";
if (!existsSync(cached)) {
  mkdirSync("build/cache/ai-bench", { recursive: true });
  console.log(`downloading ${index.model.url}`);
  writeFileSync(cached, Buffer.from(await (await fetch(index.model.url)).arrayBuffer()));
}
const model = readFileSync(cached);
if (createHash("sha256").update(model).digest("hex") !== index.model.sha256) throw new Error(`${cached}: checksum mismatch`);
writeFileSync(join(site, "model.gguf"), model);
writeFileSync(join(site, "lm/index.json"), JSON.stringify({ ...index, model: { ...index.model, url: "model.gguf" } }));
// Python from the files fetch-toolchain.sh pinned, as tests/e2e.mjs has it.
cpSync("build/cache/toolchain/test/pyodide", join(site, "test-pyodide"), { recursive: true });
const pinned = JSON.parse(readFileSync(join(site, "packs.json"), "utf8"));
pinned.python.base = "test-pyodide/";
writeFileSync(join(site, "packs.json"), JSON.stringify(pinned));

const server = await serve(site);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("page error:", e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}${PREFIX}`);
  await page.locator("#offline.ready").waitFor({ timeout: 300_000 });
  await page.waitForFunction(() => crossOriginIsolated, null, { timeout: 60_000 });
  const suites = Object.fromEntries(languages.map((l) => [l, JSON.parse(readFileSync(`bench/${l}.json`, "utf8"))]));
  const results = await page.evaluate(async ([s, c]) => (await import("./bench.js")).run(s, c), [suites, configs]);
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
}
