// The page: files, editor, terminal, and the service worker that makes it
// all work offline.
import { createEditor } from "./editor.js";
import { parseDiagnostics } from "./diagnostics.js";
import { Terminal } from "./terminal.js";
import { EXAMPLES } from "./examples.js";
import { zip } from "./zip.js";
import * as store from "./store.js";
import * as lm from "./lm.js";
import { createTypeCompletion } from "./types.js";
import { createSuggester } from "./suggest.js";
import { createGitHub } from "./github.js";
import * as sync from "./sync.js";
import { initLayout } from "./layout.js";
import { find, replaceAll } from "./find.js";
import * as packs from "./packs.js";
import { LANGUAGES, findLocations, languageOf, validName, withExtension } from "./languages.js";
import { parseTraceback } from "./traceback.js";
import { formatPython } from "./ruff.js";

const $ = (id) => document.getElementById(id);
const setStatus = (text) => { $("status").textContent = text; };

// ---- Offline support and cross-origin isolation ----------------------------

function showOffline(state, text) {
  $("offline").className = state;
  $("offline").textContent = text;
}

const mb = (bytes) => (bytes / 1e6).toFixed(0);
/** Whether the site is saved for offline use; how many packs are being. */
let siteReady = false;
let packsInstalling = 0;

function showOfflineReady() {
  if (siteReady && !packsInstalling) showOffline("ready", "✓ Ready for offline use");
}

function onServiceWorkerMessage({ data: m }) {
  if (m.type === "offline-progress") {
    showOffline("pending", `Saving for offline: ${mb(m.done)} / ${mb(m.total)} MB`);
    if (!crossOriginIsolated) setStatus("First visit: setting up…");
  } else if (m.type === "offline-ready") {
    siteReady = true;
    showOfflineReady();
  }
}

/** Register the service worker. It caches the site for offline use and adds
 *  the headers that SharedArrayBuffer needs, which take effect once it
 *  controls the page: so on the first visit the page reloads when it does. */
async function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    showOffline("", "Offline: not supported by this browser");
    return;
  }
  const sw = navigator.serviceWorker;
  sw.addEventListener("message", onServiceWorkerMessage);
  // index.html notes when a new service worker takes over, even before now.
  const takeover = () => {
    if (!crossOriginIsolated) reloadForIsolation();
    else if (swTakeover.had) {
      // A new version took over; the page still runs the old one.
      // (Not in #status, which the compiler's messages overwrite.)
      const b = document.createElement("button");
      b.textContent = "Update ready: reload";
      b.onclick = () => location.reload();
      $("update").replaceChildren(b);
    }
  };
  if (swTakeover.happened) takeover();
  else swTakeover.then = takeover;
  await sw.register("sw.js", { type: "module" });
  if (sw.controller) sw.controller.postMessage({ type: "offline-status" });
  if (!crossOriginIsolated && sw.controller) reloadForIsolation();
}

/** Reload so the service worker's headers apply, but not over and over if
 *  they somehow don't (e.g. after a hard reload, which bypasses it). */
function reloadForIsolation() {
  const last = Number(sessionStorage.getItem("isolation-reload") ?? 0);
  if (Date.now() - last < 10_000) {
    setStatus("Could not enable cross-origin isolation. Try reloading normally.");
    return;
  }
  sessionStorage.setItem("isolation-reload", String(Date.now()));
  location.reload();
}

async function requestPersistence() {
  if (!navigator.storage?.persist) return;
  const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  $("offline").title = persisted
    ? "Storage is persistent: the browser will not evict the offline copy or your files."
    : "Storage is not persistent yet: installing the app usually makes it so.";
}

// ---- Projects and files ----------------------------------------------------

/** The open project's id, and its files: name (a path) -> content,
 *  mirrored in IndexedDB. */
let project = null;
const files = new Map();
let active = null;
const saveTimers = new Map();
/** id -> name of every project. */
const projects = new Map();
/** file -> the errors and warnings of the last compile in it. */
let diagnostics = new Map();

const editor = createEditor($("editor"), {
  onChange(text) {
    files.set(active, text);
    diagnostics.delete(active);
    scheduleSave(active);
  },
  keys: [
    { key: "Mod-Enter", run: () => (run(), true) },
    { key: "Mod-s", run: () => (flushSaves(), true) },
    { key: "Shift-Alt-f", run: () => (format(), true) },
  ],
  onSave: () => flushSaves(),
  onDefinition(word, pos) {
    const at = languageOf(active).findDefinition(Object.fromEntries(files), active, word, pos);
    if (at) gotoLocation(at.file, at.line, at.col);
    else setStatus(`No definition of ${word} found`);
  },
});

/** Open `file` (if it exists) with the cursor at `line` and `col`. */
function gotoLocation(file, line, col) {
  if (!files.has(file)) return;
  if (file !== active) openFile(file);
  editor.goto(line, col);
}

function scheduleSave(name) {
  clearTimeout(saveTimers.get(name));
  saveTimers.set(name, setTimeout(() => save(name), 400));
}

function save(name) {
  clearTimeout(saveTimers.get(name));
  saveTimers.delete(name);
  if (files.has(name)) store.putFile(project, name, files.get(name)).catch((e) => setStatus(`Saving failed: ${e}`));
}

function flushSaves() {
  for (const name of [...saveTimers.keys()]) save(name);
}

/** The files as a tree: each folder once, then its files, indented. */
function renderFiles() {
  const list = $("file-list");
  list.textContent = "";
  const shown = new Set();
  for (const name of [...files.keys()].sort()) {
    const parts = name.split("/");
    for (let depth = 0; depth < parts.length - 1; depth++) {
      const folder = parts.slice(0, depth + 1).join("/");
      if (shown.has(folder)) continue;
      shown.add(folder);
      const li = document.createElement("li");
      li.className = "folder";
      li.textContent = `${parts[depth]}/`;
      li.style.paddingLeft = `${12 + depth * 14}px`;
      list.append(li);
    }
    const li = document.createElement("li");
    li.textContent = parts.at(-1);
    li.dataset.name = name;
    li.title = name;
    li.className = name === active ? "active" : "";
    li.style.paddingLeft = `${(name === active ? 9 : 12) + (parts.length - 1) * 14}px`;
    li.onclick = () => openFile(name);
    list.append(li);
  }
}

function openFile(name) {
  if (active !== null && files.has(active)) editor.save(active);
  active = name;
  editor.open(name, files.get(name));
  editor.setDiagnostics(diagnostics.get(name) ?? []);
  store.setSetting(`active:${project}`, name);
  renderFiles();
}

/** A name like `base` that no file has yet: base.rs, base_2.rs, … (or .py) */
function freeName(base) {
  const first = withExtension(base);
  const { ext } = languageOf(first);
  let name = first;
  for (let i = 2; files.has(name); i++) name = `${first.slice(0, -ext.length)}_${i}${ext}`;
  return name;
}

/** Ask for a file name; returns a valid, unused one, or null. */
function askName(message, initial) {
  let name = prompt(message, initial)?.trim();
  if (!name) return null;
  name = withExtension(name);
  if (!validName(name)) {
    alert(`"${name}" is not a valid name: use letters, digits and _, starting with a letter, ` +
      "with folders before / (as in geometry/shapes.rs), and ending in " +
      `${LANGUAGES.map((l) => `${l.ext} (${l.name})`).join(" or ")}.`);
    return null;
  }
  if (files.has(name)) {
    alert(`${name} already exists.`);
    return null;
  }
  return name;
}

async function addFile(name, content) {
  files.set(name, content);
  editor.forget(name);
  await store.putFile(project, name, content);
  openFile(name);
}

function renderProjects() {
  const select = $("project");
  select.textContent = "";
  for (const [id, name] of [...projects].sort((a, b) => a[1].localeCompare(b[1]))) select.add(new Option(name, id));
  select.value = project;
}

/** Create a project with `seed` files ([name, content]); returns its id. */
async function createProject(name, seed, id = crypto.randomUUID()) {
  await store.putProject({ id, name });
  for (const [file, content] of seed) await store.putFile(id, file, content);
  projects.set(id, name);
  return id;
}

/** Close the open project (saving it) and open project `id`. */
async function openProject(id) {
  flushSaves();
  for (const name of files.keys()) editor.forget(name);
  files.clear();
  active = null;
  project = id;
  store.setSetting("project", id);
  for (const { name, content } of await store.listFiles(id)) files.set(name, content);
  if (files.size === 0) await addFile("main.rs", EXAMPLES["hello.rs"]);
  const last = await store.getSetting(`active:${id}`);
  openFile(files.has(last) ? last : files.has("main.rs") ? "main.rs" : [...files.keys()].sort()[0]);
  renderProjects();
}

async function loadProjects() {
  for (const { id, name } of await store.listProjects()) projects.set(id, name);
  if (projects.size === 0) {
    await createProject("My project", [["main.rs", EXAMPLES["hello.rs"]], ["shapes.rs", EXAMPLES["shapes.rs"]]],
      store.FIRST_PROJECT);
  }
  const last = await store.getSetting("project");
  await openProject(projects.has(last) ? last : [...projects.keys()][0]);
}

// ---- GitHub sync -----------------------------------------------------------

const linkKey = () => `github:${project}`;
const short = (sha) => sha.slice(0, 7);

function syncStatus(text, href) {
  const el = $("sync-status");
  el.textContent = text;
  if (href) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.textContent = "See it on GitHub";
    el.append(" ", a);
  }
}

async function openSync() {
  $("project-menu").open = false;
  const link = (await store.getSetting(linkKey())) ?? {};
  $("sync-repo").value = link.repo ?? "";
  $("sync-branch").value = link.branch ?? "main";
  $("sync-dir").value = link.dir ?? "";
  $("sync-token").value = "";
  $("sync-token").placeholder = (await store.getSetting("github-token")) ? "(saved: leave empty to keep it)" : "github_pat_…";
  syncStatus(link.head
    ? `Last synced with ${link.repo} at commit ${short(link.head)}; ` +
      (sync.changedSince(files, link.snapshot) ? "changed here since." : "no changes here since.")
    : "Not synced yet.");
  $("sync-dialog").showModal();
}

/** Run `fn(gh, link)` with the dialog's settings, saving them; reports errors. */
async function withGitHub(fn) {
  flushSaves();
  const repo = $("sync-repo").value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$|\/$/g, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return syncStatus("The repository is owner/name, as in octocat/hello.");
  const token = $("sync-token").value.trim() || (await store.getSetting("github-token"));
  if (!token) return syncStatus("A token is needed: see below.");
  await store.setSetting("github-token", token);
  const old = (await store.getSetting(linkKey())) ?? {};
  const link = { repo, branch: $("sync-branch").value.trim() || "main", dir: $("sync-dir").value.trim() };
  // The same place as before: keep what was synced.
  if (old.repo === link.repo && old.branch === link.branch && old.dir === link.dir) Object.assign(link, old);
  await store.setSetting(linkKey(), link);
  const buttons = [$("sync-pull"), $("sync-push")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    await fn(createGitHub({ token, repo }), link);
  } catch (e) {
    syncStatus(e.message);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

/** Make the project's files `next` ({ name: content }). */
async function replaceFiles(next) {
  for (const timer of saveTimers.values()) clearTimeout(timer);
  saveTimers.clear();
  for (const name of files.keys()) {
    editor.forget(name);
    if (!(name in next)) await store.deleteFile(project, name);
  }
  files.clear();
  active = null;
  for (const [name, content] of Object.entries(next)) {
    files.set(name, content);
    await store.putFile(project, name, content);
  }
  openFile(files.has("main.rs") ? "main.rs" : [...files.keys()].sort()[0]);
}

function setupSync() {
  $("github-project").onclick = openSync;
  $("sync-close").onclick = () => $("sync-dialog").close();
  $("sync-forget").onclick = async () => {
    await store.setSetting("github-token", "");
    $("sync-token").placeholder = "github_pat_…";
    syncStatus("The token is forgotten.");
  };
  $("sync-pull").onclick = () => withGitHub(async (gh, link) => {
    const changed = link.head ? sync.changedSince(files, link.snapshot) : true;
    if (changed && !confirm(`Pulling replaces this project's files with those in ${link.repo}` +
      (link.head ? ", and you have changes here not pushed." : ".") + " Pull?")) return;
    syncStatus("Pulling…");
    const { head, files: remote } = await sync.pull(gh, link);
    const count = Object.keys(remote).length;
    if (!count) return syncStatus(`There are no ${LANGUAGES.map((l) => l.ext).join(" or ")} files in ${link.dir || "/"} there.`);
    await replaceFiles(remote);
    await store.setSetting(linkKey(), { ...link, head, snapshot: remote });
    syncStatus(`Pulled ${count} file${count === 1 ? "" : "s"} from commit ${short(head)}.`);
  });
  $("sync-push").onclick = () => withGitHub(async (gh, link) => {
    syncStatus("Pushing…");
    const message = $("sync-message").value.trim() || "Update from Rust Offline";
    const head = await sync.push(gh, link, files, { message, project: projects.get(project) });
    await store.setSetting(linkKey(), { ...link, head, snapshot: Object.fromEntries(files) });
    syncStatus(head === link.head ? "Nothing to push: GitHub has the same files."
      : `Pushed as commit ${short(head)}.`, `https://github.com/${link.repo}/commit/${head}`);
  });
}

function setupProjectActions() {
  $("project").onchange = (e) => openProject(e.target.value);
  const menu = $("project-menu");
  const ask = (message, initial) => {
    menu.open = false;
    return prompt(message, initial)?.trim() || null;
  };
  $("new-project").onclick = async () => {
    const name = ask("New project name:", "New project");
    if (name) await openProject(await createProject(name, [["main.rs", EXAMPLES["hello.rs"]]]));
  };
  $("rename-project").onclick = async () => {
    const name = ask("Rename the project to:", projects.get(project));
    if (!name) return;
    await store.putProject({ id: project, name });
    projects.set(project, name);
    renderProjects();
  };
  $("delete-project").onclick = async () => {
    menu.open = false;
    const count = files.size === 1 ? "its file" : `its ${files.size} files`;
    if (!confirm(`Delete the project "${projects.get(project)}" and ${count}? This cannot be undone.`)) return;
    for (const timer of saveTimers.values()) clearTimeout(timer);
    saveTimers.clear();
    const gone = project;
    await store.deleteProject(gone);
    projects.delete(gone);
    if (projects.size === 0) await createProject("My project", [["main.rs", EXAMPLES["hello.rs"]]]);
    await openProject([...projects.keys()][0]);
  };
}

function download(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function setupFileActions() {
  $("new-file").onclick = () => {
    const name = askName("New file name:", freeName("untitled"));
    if (name) addFile(name, "fn main() {\n    \n}\n");
  };
  $("rename-file").onclick = async () => {
    const from = active;
    const to = askName(`Rename ${from} to:`, from);
    if (!to) return;
    save(from);
    const content = files.get(from);
    await store.renameFile(project, from, to, content);
    files.delete(from);
    editor.forget(from);
    active = null;
    files.set(to, content);
    openFile(to);
  };
  $("delete-file").onclick = async () => {
    if (!confirm(`Delete ${active}? This cannot be undone.`)) return;
    const name = active;
    clearTimeout(saveTimers.get(name));
    saveTimers.delete(name);
    await store.deleteFile(project, name);
    files.delete(name);
    editor.forget(name);
    active = null;
    if (files.size === 0) await addFile("main.rs", EXAMPLES["hello.rs"]);
    else openFile([...files.keys()].sort()[0]);
  };
  $("import").onclick = () => $("import-input").click();
  $("import-input").onchange = async (e) => {
    for (const file of e.target.files) {
      let name = file.name.replace(/[^A-Za-z0-9_.]/g, "_").replace(/^(?=[0-9])/, "_");
      name = withExtension(name);
      if (!validName(name)) name = freeName("imported");
      if (files.has(name) && !confirm(`Replace the existing ${name}?`)) name = freeName(name);
      await addFile(name, await file.text());
    }
    e.target.value = "";
  };
  $("export").onclick = () => {
    flushSaves();
    download(active.split("/").pop(), new Blob([files.get(active)], { type: "text/plain" }));
  };
  $("export-all").onclick = () => {
    flushSaves();
    const list = [...files].sort().map(([name, content]) => ({ name, content }));
    const name = projects.get(project).replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "") || "rust-files";
    download(`${name}-${new Date().toISOString().slice(0, 10)}.zip`, zip(list));
  };
  $("docs").onchange = async (e) => {
    const option = e.target.selectedOptions[0];
    e.target.value = "";
    if (!option.value) return;
    open(option.value, "_blank");
    // Online they come from the site; offline, only once installed.
    const id = option.parentElement.dataset.pack;
    const pack = (await packs.available())[id];
    if (!(await packs.isInstalled(pack))) {
      setStatus(`${option.parentElement.label} docs aren't saved for offline use: install ${pack.title} in Options → Toolchains.`);
    }
  };
  const examples = $("examples");
  for (const name of Object.keys(EXAMPLES)) examples.add(new Option(name, name));
  examples.onchange = () => {
    const name = examples.value;
    examples.value = "";
    if (name) addFile(freeName(name), EXAMPLES[name]);
  };
  $("toggle-files").onclick = () => {
    const narrow = matchMedia("(max-width: 700px)").matches;
    $("main").classList.toggle(narrow ? "show-files" : "hide-files");
  };
  addEventListener("pagehide", flushSaves);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushSaves(); });
}

// ---- Find in project -------------------------------------------------------

const findOptions = () => ({ caseSensitive: $("find-case").checked });

/** List the places the query is in, as file:line: text; a click goes there. */
function renderFind() {
  const matches = find(files, $("find-query").value, findOptions());
  const list = $("find-results");
  list.textContent = "";
  for (const { file, line, col, text, length } of matches) {
    const li = document.createElement("li");
    const mark = document.createElement("mark");
    mark.textContent = text.slice(col - 1, col - 1 + length);
    li.append(`${file}:${line}: ${text.slice(0, col - 1)}`, mark, text.slice(col - 1 + length));
    li.onclick = () => {
      $("find-dialog").close();
      if (file !== active) openFile(file);
      editor.goto(line, col);
    };
    list.append(li);
  }
  $("find-count").textContent = $("find-query").value ? `${matches.length} found` : "";
}

function setupFind() {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      if (!$("find-dialog").open) $("find-dialog").showModal();
      $("find-query").select();
      renderFind();
    }
  }, true);
  $("find-query").oninput = renderFind;
  $("find-case").onchange = renderFind;
  $("find-close").onclick = () => $("find-dialog").close();
  $("find-replace-all").onclick = () => {
    const query = $("find-query").value;
    const count = find(files, query, findOptions()).length;
    if (!count || !confirm(`Replace ${count} ${count === 1 ? "match" : "matches"} of "${query}" in all files?`)) return;
    for (const [name, content] of replaceAll(files, query, $("find-replacement").value, findOptions())) {
      files.set(name, content);
      if (name === active) editor.replace(content);
      else editor.forget(name);
      save(name);
    }
    renderFind();
  };
}

// ---- Compiling and running -------------------------------------------------

const terminal = new Terminal($("output"), $("stdin"), {
  onInput: (text) => {
    if (runningPython) pythonInput(text);
    else compiler?.postMessage({ type: "stdin", id: current, text });
  },
  onEof: () => {
    terminal.write("info", "^D\n");
    if (runningPython) pythonInput(null);
    else compiler?.postMessage({ type: "eof", id: current });
  },
  // A place in the code, in an error or a panic: go there.
  onLocation: gotoLocation,
});
let compiler = null;
let ready = false;
/** Whether Rust is loading, or it isn't known yet if it's installed. */
let loading = true;
/** The id of the request in progress, or null. */
let current = null;
let nextId = 1;
/** What the compiler wrote in the run in progress. */
let compilerOutput = "";

function setBusy(busy) {
  $("run").disabled = busy || loading;
  $("format").disabled = busy || loading;
  $("stop").disabled = !busy;
}

function startCompiler() {
  loading = true;
  setBusy(current !== null);
  compiler = new Worker("compiler-worker.js", { type: "module" });
  compiler.onmessage = ({ data: m }) => {
    if (m.type === "status") setStatus(m.text);
    else if (m.type === "ready") {
      ready = true;
      loading = false;
      setBusy(false);
    } else if (checks.has(m.id)) {
      // A type check for completion: its diagnostics, or nothing if it failed.
      checks.get(m.id)(m.type === "checked" ? m.output : "");
      checks.delete(m.id);
    } else if (m.id !== undefined && m.id !== current) {
      // From a request that was stopped.
    } else if (m.type === "output") {
      terminal.write(m.stream, m.text);
      if (m.stream === "compiler") compilerOutput += m.text;
    }
    else if (m.type === "done") onDone(m);
    else if (m.type === "error") {
      terminal.write("stderr", `${m.text}\n`);
      if (m.id !== undefined) finishRequest();
      else setStatus("Error");
    }
  };
}

const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

function onDone(m) {
  terminal.linkify(findLocations, (file) => files.has(file));
  if (m.stage === "compile") {
    showDiagnostics(parseDiagnostics(compilerOutput));
    if (m.code === 0) {
      terminal.write("info", `Compiled in ${secs(m.ms)}. Running…\n`);
      terminal.setRunning(true);
    } else {
      terminal.write("info", m.code === 137 ? "Stopped.\n" : "Compilation failed.\n");
      finishRequest();
    }
  } else if (m.stage === "run") {
    terminal.write("info", m.code === 137 ? "\nStopped.\n" : `\nExited with code ${m.code} after ${secs(m.ms)}.\n`);
    finishRequest();
  } else if (m.stage === "format") {
    if (m.formatted !== undefined && m.formatted !== editor.text()) editor.replace(m.formatted);
    terminal.write("info", m.code === 0 ? "Formatted.\n" : "Formatting failed.\n");
    finishRequest();
  }
}

/** Show `list` in the editor, file by file, in place of any before. */
function showDiagnostics(list) {
  diagnostics = Map.groupBy(list.filter((d) => files.has(d.file)), (d) => d.file);
  editor.setDiagnostics(diagnostics.get(active) ?? []);
}

function finishRequest() {
  current = null;
  runningPython = false;
  terminal.setRunning(false);
  setBusy(false);
}

/** Rust's compiler, installing Rust first if need be (asking); whether it's
 *  ready now. */
function rustReady() {
  if (!ready && !compiler) ensurePack("rust");
  return ready;
}

function run() {
  if (active.endsWith(".py")) return runPython();
  if (current !== null || !rustReady()) return;
  flushSaves();
  current = nextId++;
  setBusy(true);
  terminal.clear();
  terminal.write("info", `Compiling ${active}…\n`);
  compilerOutput = "";
  showDiagnostics([]);
  const list = [...files].map(([name, content]) => ({ name, content }));
  compiler.postMessage({ type: "run", id: current, files: list, main: active });
}

function format() {
  if (active.endsWith(".py")) return formatPythonFile();
  if (current !== null || !rustReady()) return;
  current = nextId++;
  setBusy(true);
  terminal.clear();
  compiler.postMessage({ type: "format", id: current, name: active, content: editor.text() });
}

/** Format the open Python file with Ruff, installing it first (asking). */
async function formatPythonFile() {
  if (current !== null || !(await ensurePack("ruff"))) return;
  const [name, text] = [active, editor.text()];
  terminal.clear();
  try {
    const formatted = await formatPython(text);
    // Unless the file changed meanwhile, as Ruff loaded.
    if (active === name && editor.text() === text && formatted !== text) editor.replace(formatted);
    terminal.write("info", "Formatted.\n");
  } catch (e) {
    terminal.write("stderr", `${e.message ?? e}\n`);
    terminal.write("info", "Formatting failed.\n");
  }
}

function stop() {
  if (current === null) return;
  if (runningPython) {
    // Python can't be stopped from outside: start it afresh next time.
    python.terminate();
    python = null;
    terminal.write("info", "\nStopped.\n");
    return finishRequest();
  }
  compiler.postMessage({ type: "kill", id: current });
}

// ---- Python ----------------------------------------------------------------

let python = null; // its worker, started on the first run
let runningPython = false;
/** What the program in progress wrote to stderr, for its traceback. */
let pythonErrors = "";
/** The program's stdin, shared with the worker (see python-worker.js). */
let pythonStdin = null;
/** Lines typed before the program asked for them; whether it is asking. */
const pythonQueue = [];
let pythonWaiting = false;

/** Give the waiting program `line`, or the end of its input (null). */
function sendStdin(line) {
  const { ctrl, bytes } = pythonStdin;
  const encoded = line === null ? null : new TextEncoder().encode(line).subarray(0, bytes.length);
  if (encoded) bytes.set(encoded);
  ctrl[1] = encoded ? encoded.length : -1;
  Atomics.store(ctrl, 0, 1);
  Atomics.notify(ctrl, 0);
  pythonWaiting = false;
}

function pythonInput(line) {
  if (pythonWaiting) sendStdin(line);
  else pythonQueue.push(line);
}

/** Completion requests to the Python worker in progress: id -> resolve. */
const pythonCompletions = new Map();

/** jedi's completions at `to` in the open Python file (`doc`), or null. */
async function pythonMembers(doc, from, to) {
  if (runningPython || !(await packs.isInstalled((await packs.available()).python))) return null;
  if (!python) startPython();
  const id = nextId++;
  const before = doc.slice(0, to);
  const list = [...files].map(([name, content]) => ({ name, content: name === active ? doc : content }));
  return new Promise((resolve) => {
    pythonCompletions.set(id, resolve);
    python.postMessage({ type: "complete", id, files: list, name: active,
      line: before.split("\n").length, col: to - before.lastIndexOf("\n") - 1 });
    // Python loads once, which takes a while; if stopped, never.
    setTimeout(() => {
      pythonCompletions.delete(id);
      resolve(null);
    }, 20_000);
  });
}

function startPython() {
  python = new Worker("python-worker.js", { type: "module" });
  const shared = new SharedArrayBuffer(8 + 65536);
  pythonStdin = { ctrl: new Int32Array(shared, 0, 2), bytes: new Uint8Array(shared, 8) };
  python.postMessage({ type: "init", stdin: shared });
  python.onmessage = ({ data: m }) => {
    if (m.type === "status") setStatus(m.text);
    else if (m.type === "completions") {
      pythonCompletions.get(m.id)?.(m.options);
      pythonCompletions.delete(m.id);
    } else if (m.id !== current) {
      // From a run that was stopped.
    } else if (m.type === "output") {
      terminal.write(m.stream, m.text);
      if (m.stream === "stderr") pythonErrors += m.text;
    } else if (m.type === "stdin") {
      if (pythonQueue.length) sendStdin(pythonQueue.shift());
      else pythonWaiting = true;
    } else if (m.type === "done") {
      terminal.linkify(findLocations, (file) => files.has(file));
      if (m.code !== 0) showDiagnostics(parseTraceback(pythonErrors, files));
      terminal.write("info", `\nExited with code ${m.code} after ${secs(m.ms)}.\n`);
      finishRequest();
    } else if (m.type === "error") {
      terminal.write("stderr", `${m.text}\n`);
      finishRequest();
    }
  };
}

async function runPython() {
  if (current !== null || !(await ensurePack("python"))) return;
  flushSaves();
  current = nextId++;
  runningPython = true;
  pythonQueue.length = 0;
  pythonWaiting = false;
  pythonErrors = "";
  showDiagnostics([]);
  setBusy(true);
  terminal.clear();
  terminal.write("info", `Running ${active}…\n`);
  terminal.setRunning(true);
  if (!python) startPython();
  const list = [...files].map(([name, content]) => ({ name, content }));
  python.postMessage({ type: "run", id: current, files: list, main: active });
}

// ---- Toolchains (packs) ------------------------------------------------------

/** The packs to keep installed, and up to date: ids. */
async function wantedPacks(all) {
  return (await store.getSetting("packs")) ?? Object.keys(all).filter((id) => all[id].default);
}

async function setWanted(id, on) {
  const wanted = new Set(await wantedPacks(await packs.available()));
  if (on) wanted.add(id);
  else wanted.delete(id);
  await store.setSetting("packs", [...wanted]);
}

/** Install or update pack `id`, which is then wanted; `onProgress(text)`
 *  follows it, as the offline indicator does. */
async function installPack(id, pack, onProgress = setStatus) {
  packsInstalling++;
  if (id === "rust") {
    loading = true;
    setBusy(current !== null);
  }
  try {
    await packs.install(pack, id, (done, total) => {
      const text = `Saving ${pack.title} for offline: ${mb(done)} / ${mb(total)} MB`;
      showOffline("pending", text);
      onProgress(text);
    });
    await setWanted(id, true);
    onProgress(`${pack.title} is installed.`);
  } catch (e) {
    if (id === "rust") {
      loading = false;
      setBusy(current !== null);
    }
    throw e;
  } finally {
    packsInstalling--;
    showOfflineReady();
  }
  if (id === "rust" && !compiler) startCompiler();
}

/** Remove pack `id`, stopping what uses it. */
async function removePack(id) {
  await setWanted(id, false);
  if (id === "python") {
    if (runningPython) stop();
    python?.terminate();
    python = null;
  } else if (id === "rust") {
    compiler?.terminate();
    compiler = null;
    ready = loading = false;
    for (const resolve of checks.values()) resolve("");
    checks.clear();
    if (current !== null && !runningPython) finishRequest();
    setBusy(current !== null);
  }
  await packs.remove(id);
}

/** Install pack `id` if it isn't, asking first; whether it is. */
async function ensurePack(id) {
  const pack = (await packs.available())[id];
  if (await packs.isInstalled(pack)) return true;
  if (!confirm(`${pack.title} isn't installed. Download it (${mb(packs.size(pack))} MB)? It then works offline.`)) return false;
  try {
    await installPack(id, pack);
    return true;
  } catch (e) {
    setStatus(`${pack.title} could not be installed: ${e.message}`);
    return false;
  }
}

/** At startup: install or update the wanted packs, then load Rust. */
async function startPacks() {
  const all = await packs.available();
  for (const id of await wantedPacks(all)) {
    if (!all[id] || (await packs.isInstalled(all[id]))) continue;
    try {
      await installPack(id, all[id]);
    } catch (e) {
      showOffline("", `Offline: ${all[id].title} could not be saved (${e.message})`);
    }
  }
  if (await packs.isInstalled(all.rust)) {
    if (!compiler) startCompiler();
  } else {
    loading = false;
    setBusy(false);
    setStatus("Ready.");
  }
}

/** Fill the Toolchains dialog: each pack, and its packages once installed. */
async function renderToolchains() {
  const list = $("toolchains-list");
  const status = (text) => { $("toolchains-status").textContent = text; };
  const make = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  const busy = async (text, fn) => {
    status(text);
    list.querySelectorAll("button, input").forEach((b) => (b.disabled = true));
    try {
      await fn();
      status("");
    } catch (e) {
      status(e.message);
    }
    await renderToolchains();
  };
  const sections = [];
  for (const [id, pack] of Object.entries(await packs.available())) {
    const installed = await packs.isInstalled(pack);
    const action = installed
      ? make("button", { textContent: "Remove", onclick: () => busy(`Removing ${pack.title}…`, () => removePack(id)) })
      : make("button", { textContent: `Install (${mb(packs.size(pack))} MB)`, className: "primary",
        onclick: () => busy(`Downloading ${pack.title}…`, () => installPack(id, pack, status)) });
    const section = make("div", { className: "pack" }, [
      make("h4", {}, [`${pack.title}${installed ? " · installed" : ""}`, action]),
      make("p", { className: "hint", textContent: pack.about }),
    ]);
    if (installed && pack.lock) {
      const all = await packs.packages(pack);
      const have = await packs.installedPackages(id);
      section.append(make("div", { className: "packages" }, have.length
        ? have.map((name) => make("span", {}, [name, " ", make("button", {
          className: "link", textContent: "✕", title: `Remove ${name}`,
          onclick: () => busy(`Removing ${name}…`, () => packs.removePackage(pack, name)),
        })]))
        : [make("span", { className: "hint", textContent: "No packages yet." })]));
      const input = make("input", { placeholder: "Add a package, as numpy", spellcheck: false });
      input.setAttribute("list", `${id}-package-names`);
      const add = () => input.value.trim() && busy(`Adding ${input.value}…`,
        () => packs.installPackages(id, pack, [input.value.trim()], status));
      input.onkeydown = (e) => { if (e.key === "Enter") add(); };
      section.append(make("div", { className: "add" }, [
        input,
        make("button", { textContent: "Add", onclick: add }),
        make("datalist", { id: `${id}-package-names` }, Object.keys(all).sort().map((n) => make("option", { value: n }))),
      ]));
    }
    sections.push(section);
  }
  list.replaceChildren(...sections);
}

$("toolchains-open").onclick = () => {
  $("options").open = false;
  $("toolchains-dialog").showModal();
  renderToolchains();
};
$("toolchains-close").onclick = () => $("toolchains-dialog").close();

// ---- Type-aware completion -------------------------------------------------

/** Type checks in progress: id -> resolve. */
const checks = new Map();

/** Type-check the program with `source` as the open file; rustc's output. */
function check(source) {
  if (!ready) return Promise.resolve("");
  const id = nextId++;
  const list = [...files].map(([name, content]) => ({ name, content: name === active ? source : content }));
  compiler.postMessage({ type: "check", id, files: list, main: active });
  return new Promise((resolve) => checks.set(id, resolve));
}

const typeCompletion = createTypeCompletion({ check, fetchText: async (path) => (await fetch(path)).text() });

/** The members after a dot (and in Python, names in imports): in Rust, of
 *  the type the compiler finds; in Python, as jedi finds them. */
const members = (doc, from, to) => (active.endsWith(".rs") ? typeCompletion(doc, from, to, [...files.values()], active)
  : active.endsWith(".py") ? pythonMembers(doc, from, to) : null);

function setTypes(on) {
  $("types").checked = on;
  store.setSetting("types", on);
  editor.setMembers(on ? members : null);
}

$("types").onchange = (e) => setTypes(e.target.checked);

function setVim(on) {
  $("vim").checked = on;
  store.setSetting("vim", on);
  editor.setVim(on);
}

$("vim").onchange = (e) => setVim(e.target.checked);

// ---- AI suggestions --------------------------------------------------------

let model = null;

/** Turn AI suggestions on or off; the toggle's data-state follows: off,
 *  loading, on or failed. */
async function setAI(on, { ask = true } = {}) {
  const state = (s, text = "") => {
    $("ai-toggle").dataset.state = s;
    $("ai-status").textContent = text;
  };
  $("ai").checked = on;
  store.setSetting("ai", on);
  if (!on) {
    editor.setSuggest(null);
    model?.unload();
    model = null;
    state("off");
    return;
  }
  if (ask && !(await lm.isDownloaded()) && !confirm(
    "AI suggestions download a 145 MB language model (SmolLM2-135M) that then runs on this device, offline. " +
    "It is small, so its suggestions are often wrong. Download it?")) {
    return setAI(false);
  }
  try {
    state("loading", "loading…");
    model = await lm.loadModel((done, total) => state("loading", `${mb(done)} / ${mb(total)} MB`));
    if (!$("ai").checked) return model.unload(); // turned off meanwhile
    const suggest = createSuggester({
      complete: model.complete,
      // Right after a dot, only the members there; with type-aware completion on.
      members: (doc, from, to) => ($("types").checked ? typeMembers(doc, from, to) : null),
      check,
      main: () => active,
      others: () => [...files].filter(([name]) => name !== active).map(([name, content]) => ({ name, content })),
    });
    // Rust only, for now: the model's prompt and the check are Rust's.
    editor.setSuggest((doc, pos, signal) => (active.endsWith(".rs") ? suggest(doc, pos, signal) : ""));
    state("on");
  } catch (e) {
    $("ai").checked = false;
    store.setSetting("ai", false);
    state("failed", "failed");
    $("ai-toggle").title = `AI suggestions failed to load: ${e.message}`;
  }
}

$("ai").onchange = (e) => setAI(e.target.checked);

// ---- Start -----------------------------------------------------------------

$("run").onclick = run;
$("stop").onclick = stop;
$("format").onclick = format;
setupFileActions();
setupProjectActions();
setupSync();
setupFind();
loadProjects().catch((e) => setStatus(`Could not load your files: ${e}`));
setupServiceWorker().catch((e) => showOffline("", `Offline: unavailable (${e.message})`));
requestPersistence();
store.getSetting("ai").then((on) => { if (on) setAI(true, { ask: false }); });
store.getSetting("types").then((on) => setTypes(on ?? true));
store.getSetting("vim").then((on) => { if (on) setVim(true); });
initLayout($("main"), $("files-handle"), $("terminal-handle"), store);
if (crossOriginIsolated) {
  startPacks().catch((e) => {
    setStatus(`Could not load the toolchains: ${e.message}`);
    loading = false;
    setBusy(false);
  });
} else setStatus("Setting up…");
