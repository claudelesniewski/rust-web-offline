// End-to-end test in headless Chromium: first visit, compile and run,
// stdin, compile errors, files that persist, an update, then the same
// offline, and the docs. Run scripts/build.sh first.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve, PREFIX } from "./serve.mjs";
import { createFakeGitHub } from "./fake-github.mjs";

// A copy of the site, so that a new version can be deployed mid-test.
const site = mkdtempSync(join(tmpdir(), "rust-offline-site-"));
cpSync("build/site", site, { recursive: true });
// AI suggestions use a tiny test model instead of the real one: it writes
// stories, not Rust, but tests all the same.
const model = readFileSync("build/cache/toolchain/test/stories260K.gguf");
writeFileSync(join(site, "test-model.gguf"), model);
const lmIndex = JSON.parse(readFileSync(join(site, "lm/index.json"), "utf8"));
lmIndex.model = { url: "test-model.gguf", sha256: createHash("sha256").update(model).digest("hex"), size: model.length };
writeFileSync(join(site, "lm/index.json"), JSON.stringify(lmIndex));
// The Python pack comes from the files fetch-toolchain.sh pinned, not the CDN.
cpSync("build/cache/toolchain/test/pyodide", join(site, "test-pyodide"), { recursive: true });
const packsJson = JSON.parse(readFileSync(join(site, "packs.json"), "utf8"));
packsJson.python.base = "test-pyodide/";
writeFileSync(join(site, "packs.json"), JSON.stringify(packsJson));
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

/** Run Python file `name`, the active one, to its end. */
async function runPython(name) {
  await page.locator("#run:not([disabled])").click();
  await page.waitForFunction((n) => document.querySelector("#output").innerText.startsWith(`Running ${n}`)
    && /Exited with code/.test(document.querySelector("#output").innerText), name, { timeout: 60_000 });
}

/** Open `name` and replace its text with `code`. */
async function setCode(name, code) {
  await page.locator(`#file-list li[data-name="${name}"]`).click();
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

/** Wait for AI suggestions to be on, their model loaded. */
async function aiReady(p) {
  await p.locator('#ai-toggle[data-state="on"]').waitFor({ state: "attached", timeout: 60_000 });
}

/** Type a comment at the end of the file; return the AI's suggestion. (The
 *  test model writes stories, not Rust: only in a comment do they compile.) */
async function suggestion(p) {
  await p.locator(".cm-content").click();
  await p.keyboard.press("ControlOrMeta+End");
  await p.keyboard.type("// Once upon a");
  await p.locator(".cm-ghost").waitFor({ timeout: 30_000 });
  return p.locator(".cm-ghost").innerText();
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
    // Clicking the place goes there.
    await page.locator("#output a.loc", { hasText: /^src\/main\.rs:2:/ }).first().click();
    assert.equal(await page.locator(".cm-activeLine").innerText(), '    let x: i32 = "nope";');
  });

  await step("compile errors are underlined in the editor until it is edited", async () => {
    assert.equal(await page.locator(".cm-line .cm-lintRange-error").innerText(), '"nope"');
    assert.equal(await page.locator(".cm-gutter-lint .cm-lint-marker-error").count(), 1);
    await page.keyboard.type(" ");
    await page.locator(".cm-lintRange-error").waitFor({ state: "detached" });
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

  await step("a panic's place in another file opens it there", async () => {
    await setCode("geometry.rs", "pub fn double(x: i32) -> i32 { x * 2 }\npub fn oops() -> i32 { let v: Vec<i32> = Vec::new(); v[3] }\n");
    await setCode("main.rs", "mod geometry;\nfn main() { geometry::oops(); }\n");
    assert.match(await run(), /panicked at src\/geometry\.rs:2:/);
    await page.locator("#output a.loc", { hasText: /^src\/geometry\.rs:2:/ }).click();
    await page.locator('#file-list li.active[data-name="geometry.rs"]').waitFor();
    assert.match(await page.locator(".cm-activeLine").innerText(), /^pub fn oops\(\)/);
    await setCode("geometry.rs", "pub fn double(x: i32) -> i32 { x * 2 }\n");
    await setCode("main.rs", 'mod geometry;\nfn main() { println!("{}", geometry::double(21)); }\n');
  });

  await step("F12 goes to a definition in another file", async () => {
    await setCode("geometry.rs", "// Geometry.\npub fn double(x: i32) -> i32 { x * 2 }\n");
    await setCode("main.rs", 'mod geometry;\nfn main() { println!("{}", geometry::double(21)); }\n');
    // Into `double`, from the end of `geometry::double(21)); }`.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("End");
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("F12");
    await page.locator('#file-list li.active[data-name="geometry.rs"]').waitFor();
    assert.match(await page.locator(".cm-activeLine").innerText(), /^pub fn double\(/);
    await setCode("geometry.rs", "pub fn double(x: i32) -> i32 { x * 2 }\n");
  });

  await step("find and replace in all files", async () => {
    await page.locator('#file-list li[data-name="main.rs"]').click();
    await page.keyboard.press("ControlOrMeta+Shift+f");
    await page.locator("#find-query").fill("DOUBLE");
    assert.deepEqual(await page.locator("#find-results li").allInnerTexts(), [
      "geometry.rs:1: pub fn double(x: i32) -> i32 { x * 2 }",
      'main.rs:2: fn main() { println!("{}", geometry::double(21)); }',
    ]);
    assert.equal(await page.locator("#find-results mark").first().innerText(), "double");
    await page.locator("#find-case").check();
    assert.equal(await page.locator("#find-results li").count(), 0);
    await page.locator("#find-case").uncheck();
    await page.locator("#find-results li", { hasText: /^geometry\.rs:1:/ }).click();
    await page.locator('#file-list li.active[data-name="geometry.rs"]').waitFor();
    assert.equal(await page.locator("#find-dialog").isVisible(), false);
    // Replace all, in the open file and another, then back.
    const replace = async (from, to) => {
      await page.keyboard.press("ControlOrMeta+Shift+f");
      await page.locator("#find-query").fill(from);
      await page.locator("#find-replacement").fill(to);
      const asked = new Promise((resolve) => page.once("dialog", (d) => { resolve(d.message()); d.accept(); }));
      await page.locator("#find-replace-all").click();
      assert.match(await asked, /^Replace 2 matches/);
      await page.locator("#find-count", { hasText: "0 found" }).waitFor();
      await page.locator("#find-close").click();
    };
    await replace("double", "twice");
    assert.match(await page.locator(".cm-content").innerText(), /pub fn twice\(/);
    await page.locator('#file-list li[data-name="main.rs"]').click();
    assert.match(await page.locator(".cm-content").innerText(), /geometry::twice\(21\)/);
    assert.match(await run(), /^42$/m);
    await replace("twice", "double");
    assert.match(await page.locator(".cm-content").innerText(), /geometry::double\(21\)/);
  });

  await step("tab completion", async () => {
    await setCode("main.rs", "fn main() {\n    let mut v = Vec::new();\n    \n}\n");
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("End");
    const accept = async (typed, label) => {
      await page.keyboard.type(typed);
      await page.locator(".cm-tooltip-autocomplete li[aria-selected] .cm-completionLabel", { hasText: label })
        .waitFor({ timeout: 30_000 });
      // CodeMirror ignores keys for 75 ms after a list appears or changes,
      // so that one typed just as it does is not taken as a choice.
      await page.waitForTimeout(150);
      await page.keyboard.press("Tab");
    };
    await accept("v.pu", "push");
    await page.keyboard.type("(7);");
    await page.keyboard.press("Enter");
    await accept("printl", "println!"); // println!(|)
    await page.keyboard.type('"{:?}", v');
    await page.keyboard.press("End");
    await page.keyboard.type(";");
    const out = await run();
    assert.match(out, /^\[7\]$/m, out);
  });

  await step("type-aware completion", async () => {
    await setCode("main.rs", [
      "struct P { x: i32 }",
      "impl P { fn get(&self) -> i32 { self.x } }",
      "fn main() {",
      "    let v = vec![1];",
      "    let s = String::new();",
      "    let p = P { x: 1 };",
      "}",
    ].join("\n"));
    const optionsAfter = async (expr) => {
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.press("Home");
      await page.keyboard.type(`    ${expr}`);
      await page.locator(".cm-tooltip-autocomplete").waitFor({ timeout: 30_000 });
      const labels = await page.locator(".cm-completionLabel").allInnerTexts();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Shift+Home");
      await page.keyboard.press("Delete");
      return labels;
    };
    const vec = await optionsAfter("v.");
    assert.ok(vec.includes("push") && vec.includes("sort") && !vec.includes("push_str"), vec.join(" "));
    assert.ok((await optionsAfter("s.")).includes("push_str"));
    assert.deepEqual((await optionsAfter("p.")).sort(), ["get", "x"]);
    // After a name that doesn't exist: nothing.
    await page.keyboard.type("    nope.");
    await page.waitForTimeout(3000);
    assert.equal(await page.locator(".cm-tooltip-autocomplete").count(), 0);
    await page.keyboard.press("Shift+Home");
    await page.keyboard.press("Delete");
  });

  await step("AI suggestions", async () => {
    page.once("dialog", (d) => d.accept());
    await page.locator("#options summary").click();
    await page.locator("#ai").check();
    await page.locator("#options summary").click();
    await aiReady(page);
    await setCode("main.rs", "fn main() {}\n");
    const ghost = await suggestion(page);
    await page.keyboard.press("Tab");
    await page.locator(".cm-ghost").waitFor({ state: "detached" });
    assert.ok((await page.locator(".cm-content").innerText()).includes(ghost.trim()));
    // In code, stories don't compile: no suggestion.
    await page.keyboard.press("Enter");
    await page.keyboard.type("const X: i32 = ");
    await page.waitForTimeout(3000);
    assert.equal(await page.locator(".cm-ghost").count(), 0);
  });

  await step("Shift-Tab takes the suggestion when a completion list is open too", async () => {
    // A second editor, whose suggestions come from a fake model.
    await page.evaluate(async () => {
      const { createEditor } = await import("./editor.js");
      const parent = document.createElement("div");
      parent.id = "test-editor";
      parent.style = "position: fixed; inset: 0 auto auto 0; width: 600px; height: 200px; z-index: 100";
      document.body.append(parent);
      const editor = createEditor(parent, { onChange() {} });
      editor.open("test.rs", "fn main() {\n}\n");
      editor.setSuggest(async () => 'ntln!("hi");');
      window.testEditor = editor;
    });
    await page.locator("#test-editor .cm-content").click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("pri");
    await page.locator(".cm-tooltip-autocomplete").waitFor();
    await page.locator("#test-editor .cm-ghost").waitFor();
    await page.keyboard.press("Shift+Tab");
    await page.locator(".cm-tooltip-autocomplete").waitFor({ state: "detached" });
    assert.match(await page.evaluate(() => window.testEditor.text()), /^\s*println!\("hi"\);$/m);
    await page.evaluate(() => document.querySelector("#test-editor").remove());
  });

  await step("format with rustfmt", async () => {
    await setCode("geometry.rs", "pub fn double(x:i32)->i32{x*2}\n");
    await page.locator("#format:not([disabled])").click();
    await page.locator("#output", { hasText: "Formatted." }).waitFor({ timeout: 60_000 });
    assert.match(await page.locator(".cm-content").innerText(), /pub fn double\(x: i32\) -> i32 \{\n\s+x \* 2\n\}/);
  });

  await step("Vim key bindings", async () => {
    await setCode("main.rs", "let a = 1;\nlet b = 2;\nlet c = 3;\n");
    const vimOption = async (on) => {
      await page.locator("#options summary").click();
      await page.locator("#vim").setChecked(on);
      await page.locator("#options summary").click();
    };
    await vimOption(true);
    const text = () => page.evaluate(() => [...document.querySelectorAll(".cm-line")].map((l) => l.textContent).join("\n"));
    await page.locator(".cm-content").click();
    await page.keyboard.press("Escape");
    await page.keyboard.type("ggdd");
    assert.equal(await text(), "let b = 2;\nlet c = 3;\n");
    await page.keyboard.type("u");
    assert.equal(await text(), "let a = 1;\nlet b = 2;\nlet c = 3;\n");
    await page.keyboard.type("Gcclet d = 4;");
    await page.locator(".cm-vim-panel", { hasText: "INSERT" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await text(), "let a = 1;\nlet b = 2;\nlet c = 3;\nlet d = 4;");
    // :w saves at once.
    await page.keyboard.type(":w");
    await page.keyboard.press("Enter");
    const saved = await page.evaluate(() => new Promise((resolve) => {
      indexedDB.open("rust-offline").onsuccess = (e) => {
        e.target.result.transaction("project-files").objectStore("project-files").get(["default", "main.rs"])
          .onsuccess = (g) => resolve(g.target.result.content);
      };
    }));
    assert.equal(saved, "let a = 1;\nlet b = 2;\nlet c = 3;\nlet d = 4;");
    await vimOption(false);
    assert.equal(await page.locator(".cm-vim-panel").count(), 0);
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

  await step("drag the terminal taller; it stays so after a reload; double-click resets it", async () => {
    const height = async () => (await page.locator("#terminal").boundingBox()).height;
    const before = await height();
    const handle = await page.locator("#terminal-handle").boundingBox();
    const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 100, { steps: 5 });
    await page.mouse.up();
    const taller = await height();
    assert.ok(Math.abs(taller - before - 100) < 5, `${before} -> ${taller}`);
    const saved = await page.evaluate(() => import("./store.js").then((s) => s.getSetting("layout")));
    assert.ok(saved.editor > 0 && saved.editor < 0.6, JSON.stringify(saved));
    await page.reload();
    await waitReady();
    assert.ok(Math.abs((await height()) - taller) < 2);
    await page.locator("#terminal-handle").dblclick();
    assert.ok(Math.abs((await height()) - before) < 2);
  });

  await step("export all as a zip", async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-all").click()]);
    assert.match(download.suggestedFilename(), /^My-project-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  await step("projects, each with its own files, in folders", async () => {
    const first = await page.locator("#file-list li").allInnerTexts();
    const newProject = async (name) => {
      await page.locator("#project-menu summary").click();
      page.once("dialog", (d) => d.accept(name));
      await page.locator("#new-project").click();
      await page.waitForFunction((name) => document.querySelector("#project").selectedOptions[0]?.text === name, name);
    };
    await newProject("Second");
    assert.deepEqual(await page.locator("#file-list li").allInnerTexts(), ["main.rs"]);
    page.once("dialog", (d) => d.accept("util/mod.rs"));
    await page.locator("#new-file").click();
    await setCode("util/mod.rs", "pub fn two() -> i32 { 2 }\n");
    await setCode("main.rs", 'mod util;\nfn main() { println!("{}", util::two()); }\n');
    assert.deepEqual(await page.locator("#file-list li").allInnerTexts(), ["main.rs", "util/", "mod.rs"]);
    assert.match(await run(), /^2$/m);
    // The first project's files are as they were.
    await page.locator("#project").selectOption({ label: "My project" });
    await page.locator('#file-list li[data-name="shapes.rs"]').waitFor();
    assert.deepEqual(await page.locator("#file-list li").allInnerTexts(), first);
    // Deleting a project.
    await newProject("Third");
    await page.locator("#project-menu summary").click();
    page.once("dialog", (d) => d.accept());
    await page.locator("#delete-project").click();
    await page.waitForFunction(() => ![...document.querySelector("#project").options].some((o) => o.text === "Third"));
    await page.locator("#project").selectOption({ label: "My project" });
    await page.locator('#file-list li[data-name="shapes.rs"]').waitFor();
  });

  await step("sync a project with GitHub", async () => {
    // GitHub's API, played by a fake, CORS and all.
    const github = createFakeGitHub("me/code");
    github.commitFiles({ "README.md": "# Code\n" });
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
    await context.route("https://api.github.com/**", async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const { status, json } = github.handle(req.method(), req.url(), req.postDataJSON());
      return route.fulfill({ status, headers: cors, json });
    });
    await page.locator("#project-menu summary").click();
    page.once("dialog", (d) => d.accept("Synced"));
    await page.locator("#new-project").click();
    await page.waitForFunction(() => document.querySelector("#project").selectedOptions[0]?.text === "Synced");

    const dialog = async () => {
      await page.locator("#project-menu summary").click();
      await page.locator("#github-project").click();
    };
    await dialog();
    await page.locator("#sync-repo").fill("me/code");
    await page.locator("#sync-token").fill("github_pat_test");
    await page.locator("#sync-push").click();
    await page.locator("#sync-status", { hasText: "Pushed as commit" }).waitFor();
    assert.deepEqual(Object.keys(github.files()).sort(), ["Cargo.toml", "README.md", "src/main.rs"]);
    assert.match(github.files()["Cargo.toml"], /^name = "synced"$/m);

    // Changed on GitHub: pull it, and run it.
    github.commitFiles({ "src/main.rs": 'fn main() { println!("from GitHub"); }\n', "src/extra.rs": "pub fn e() {}\n" });
    await page.locator("#sync-pull").click();
    await page.locator("#sync-status", { hasText: "Pulled 2 files" }).waitFor();
    await page.locator("#sync-close").click();
    assert.deepEqual(await page.locator("#file-list li").allInnerTexts(), ["extra.rs", "main.rs"]);
    assert.match(await run(), /^from GitHub$/m);

    // Changed here: push it, as a second commit; the token was kept.
    await setCode("main.rs", 'fn main() { println!("from here"); }\n');
    await dialog();
    assert.equal(await page.locator("#sync-repo").inputValue(), "me/code");
    await page.locator("#sync-message").fill("Say where from");
    await page.locator("#sync-push").click();
    await page.locator("#sync-status", { hasText: "Pushed as commit" }).waitFor();
    assert.equal(github.files()["src/main.rs"], 'fn main() { println!("from here"); }\n');

    // Changed in both places: pushing is refused.
    github.commitFiles({ "README.md": "# Changed\n" });
    await page.locator("#sync-close").click();
    await setCode("main.rs", "fn main() {}\n");
    await dialog();
    await page.locator("#sync-push").click();
    await page.locator("#sync-status", { hasText: "pull first" }).waitFor();
    await page.locator("#sync-close").click();
    await context.unroute("https://api.github.com/**");
    await page.locator("#project").selectOption({ label: "My project" });
    await page.locator('#file-list li[data-name="shapes.rs"]').waitFor();
  });

  await step("Python: installed when first needed, with input()", async () => {
    await page.locator("#examples").selectOption("hello.py");
    await page.locator('#file-list li.active[data-name="hello.py"]').waitFor();
    page.once("dialog", (d) => d.accept()); // "Python isn't installed yet. Download it?"
    await page.locator("#run:not([disabled])").click();
    await page.locator("#stdin:not([disabled])").waitFor({ timeout: 120_000 });
    await page.locator("#output", { hasText: "What's your name?" }).waitFor({ timeout: 120_000 });
    await page.locator("#stdin").fill("Ada");
    await page.locator("#stdin").press("Enter");
    await page.locator("#output", { hasText: "Exited with code 0" }).waitFor({ timeout: 60_000 });
    assert.match(await output(), /Hello, Ada! Squares: \[1, 4, 9, 16, 25\], sum 55/);
  });

  await step("Python packages are added in the Toolchains dialog", async () => {
    await page.locator("#options summary").click();
    await page.locator("#toolchains-open").click();
    await page.locator("#toolchains-dialog .pack h4", { hasText: "installed" }).waitFor();
    await page.locator("#toolchains-dialog .add input").fill("annotated_types");
    await page.locator("#toolchains-dialog .add button").click();
    await page.locator("#toolchains-dialog .packages span", { hasText: "annotated-types" }).waitFor();
    await page.locator("#toolchains-close").click();
    page.once("dialog", (d) => d.accept("uses_package.py"));
    await page.locator("#new-file").click();
    await setCode("uses_package.py", "import annotated_types\nprint(annotated_types.Gt(3))\n");
    await runPython("uses_package.py");
    assert.match(await output(), /Gt\(gt=3\)/);
    // A package that isn't installed fails to import.
    page.once("dialog", (d) => d.accept("missing.py"));
    await page.locator("#new-file").click();
    await setCode("missing.py", "import numpy\n");
    await runPython("missing.py");
    assert.match(await output(), /ModuleNotFoundError[^]*Exited with code 1/);
  });

  await step("a new version installs without downloading the toolchain or docs again", async () => {
    const sw = join(site, "sw.js");
    writeFileSync(sw, readFileSync(sw, "utf8").replace(/^const VERSION = "(.*)";$/m, 'const VERSION = "$1-next";'));
    requests.length = 0;
    // A slow page (as on a small Chromebook): the new version takes over
    // while the app is still loading, and must still be offered.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
    await page.reload();
    await page.locator("#update button", { hasText: "Update ready" }).waitFor({ timeout: 60_000 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await page.locator("#update button", { hasText: "Update ready" }).click();
    await waitReady();
    // Content-hashed files: the toolchain and the docs' chunks.
    assert.deepEqual(requests.filter((r) => /\/toolchain\/.*\.[0-9a-f]{12}\.|\/docs\/\d+\./.test(r)), []);
    await page.locator("#offline.ready").waitFor();
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
    await offline.locator("#offline.ready").waitFor();
    // AI suggestions stay on, their model loaded from the cache.
    await aiReady(offline);
    assert.ok(await suggestion(offline));
    // So does Python, after an update too.
    await offline.locator('#file-list li[data-name="hello.py"]').click();
    await offline.locator("#run:not([disabled])").click();
    await offline.locator("#stdin:not([disabled])").waitFor({ timeout: 120_000 });
    await offline.locator("#stdin").fill("Offline");
    await offline.locator("#stdin").press("Enter");
    await offline.locator("#output", { hasText: "Hello, Offline!" }).waitFor({ timeout: 60_000 });
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
