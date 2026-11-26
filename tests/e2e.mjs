// End-to-end test in headless Chromium: first visit, compile and run,
// stdin, compile errors, files that persist, an update, then the same
// offline, and the docs. Run scripts/build.sh first.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve, PREFIX } from "./serve.mjs";

// A copy of the site, so that a new version can be deployed mid-test.
const site = mkdtempSync(join(tmpdir(), "rust-offline-site-"));
cpSync("build/site", site, { recursive: true });
const server = await serve(site);
const requests = [];
server.on("request", (req) => requests.push(req.url));
const url = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));

const output = () => page.locator("#output").innerText();

async function step(name, fn) {
  const t0 = Date.now();
  await fn();
  console.log(`ok - ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

/** Open `name` and replace its text with `code`. */
async function setCode(name, code) {
  await page.locator("#file-list li", { hasText: new RegExp(`^${name}$`) }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(code);
}

/** Run the open file; wait for it to end; return the output. */
async function run() {
  await page.locator("#run:not([disabled])").click();
  await page.waitForFunction(() => /Exited with code|Compilation failed|Stopped/.test(
    document.querySelector("#output").innerText), null, { timeout: 120_000 });
  return output();
}

async function waitReady() {
  await page.locator("#run:not([disabled])").waitFor({ timeout: 180_000 });
}

try {
  await step("first visit caches everything and becomes isolated", async () => {
    await page.goto(url);
    await page.locator("#offline.ready").waitFor({ timeout: 300_000 });
    await waitReady();
    assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  });

  await step("hello world", async () => {
    await page.locator("#file-list li", { hasText: /^main\.rs$/ }).click();
    const out = await run();
    assert.match(out, /Hello, world!/);
    assert.match(out, /Exited with code 0/);
  });

  await step("Vec, String and a struct with impl blocks", async () => {
    await page.locator("#file-list li", { hasText: /^shapes\.rs$/ }).click();
    const out = await run();
    assert.match(out, /door \(2 x 4\): area 8\.00/);
    assert.match(out, /total area: 11\.80/);
  });

  await step("compile errors are shown", async () => {
    await setCode("main.rs", 'fn main() {\n    let x: i32 = "nope";\n}\n');
    const out = await run();
    assert.match(out, /error\[E0308\]: mismatched types/);
    assert.match(out, /src\/main\.rs:2/);
    assert.match(out, /Compilation failed/);
  });

  await step("stdin", async () => {
    await setCode("main.rs", [
      "fn main() {",
      "    let mut s = String::new();",
      "    std::io::stdin().read_line(&mut s).unwrap();",
      '    println!("got [{}]", s.trim());',
      "}",
    ].join("\n"));
    await page.locator("#run:not([disabled])").click();
    await page.locator("#stdin:not([disabled])").waitFor({ timeout: 120_000 });
    await page.locator("#stdin").fill("crab");
    await page.locator("#stdin").press("Enter");
    await page.waitForFunction(() => /Exited with code/.test(document.querySelector("#output").innerText));
    assert.match(await output(), /got \[crab\]/);
  });

  await step("modules in other files", async () => {
    page.once("dialog", (d) => d.accept("geometry"));
    await page.locator("#new-file").click();
    await setCode("geometry.rs", "pub fn double(x: i32) -> i32 { x * 2 }\n");
    await setCode("main.rs", 'mod geometry;\nfn main() { println!("{}", geometry::double(21)); }\n');
    assert.match(await run(), /^42$/m);
  });

  await step("format with rustfmt", async () => {
    await setCode("geometry.rs", "pub fn double(x:i32)->i32{x*2}\n");
    await page.locator("#format:not([disabled])").click();
    await page.locator("#output", { hasText: "Formatted." }).waitFor({ timeout: 60_000 });
    assert.match(await page.locator(".cm-content").innerText(), /pub fn double\(x: i32\) -> i32 \{\n\s+x \* 2\n\}/);
  });

  await step("stop a program that never ends", async () => {
    await setCode("main.rs", "fn main() { let mut n = 0u64; loop { n = n.wrapping_add(1); } }\n");
    await page.locator("#run:not([disabled])").click();
    await page.locator("#stop:not([disabled])").waitFor();
    await page.locator("#output", { hasText: "Running…" }).waitFor({ timeout: 120_000 });
    await page.locator("#stop").click();
    await page.locator("#output", { hasText: "Stopped." }).waitFor({ timeout: 10_000 });
    await setCode("main.rs", 'mod geometry;\nfn main() { println!("{}", geometry::double(21)); }\n');
    assert.match(await run(), /^42$/m);
  });

  await step("export all as a zip", async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-all").click()]);
    assert.match(download.suggestedFilename(), /^rust-files-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  await step("a new version installs without downloading the toolchain or docs again", async () => {
    const sw = join(site, "sw.js");
    writeFileSync(sw, readFileSync(sw, "utf8").replace(/^const VERSION = "(.*)";$/m, 'const VERSION = "$1-next";'));
    requests.length = 0;
    await page.reload();
    await page.locator("#status button", { hasText: "Update ready" }).click({ timeout: 60_000 });
    await waitReady();
    // Content-hashed files: the toolchain and the docs' chunks.
    assert.deepEqual(requests.filter((r) => /\/toolchain\/.*\.[0-9a-f]{12}\.|\/docs\/\d+\./.test(r)), []);
    assert.match(await page.locator("#offline").innerText(), /Ready for offline use/);
  });

  await step("works offline after closing and reopening", async () => {
    await page.close();
    await context.setOffline(true);
    const offline = await context.newPage();
    await offline.goto(url);
    await offline.locator("#run:not([disabled])").waitFor({ timeout: 60_000 });
    // The file edited above was saved.
    await offline.locator("#file-list li", { hasText: /^main\.rs$/ }).click();
    await offline.locator("#run").click();
    await offline.waitForFunction(() => /Exited with code 0/.test(document.querySelector("#output").innerText),
      null, { timeout: 120_000 });
    assert.match(await offline.locator("#output").innerText(), /^42$/m);
    assert.match(await offline.locator("#offline").innerText(), /Ready for offline use/);
  });

  await step("the docs work offline, search included", async () => {
    const docs = await context.newPage();
    await docs.goto(`${url}docs/book/ch05-01-defining-structs.html`);
    await docs.locator("h2", { hasText: "Defining and Instantiating Structs" }).waitFor();
    await docs.goto(`${url}docs/std/vec/struct.Vec.html`);
    await docs.locator("h1", { hasText: "Vec" }).waitFor();
    await docs.goto(`${url}docs/std/index.html?search=HashMap`);
    await docs.locator(".search-results a", { hasText: "HashMap" }).first().waitFor({ timeout: 30_000 });
    const missing = await docs.goto(`${url}docs/core/arch/index.html`);
    assert.equal(missing.status(), 404);
    await docs.close();
  });
} finally {
  await browser.close();
  server.close();
  rmSync(site, { recursive: true });
}
