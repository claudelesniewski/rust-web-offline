// The page: files, editor, terminal, and the service worker that makes it
// all work offline.
import { createEditor } from "./editor.js";
import { Terminal } from "./terminal.js";
import { EXAMPLES } from "./examples.js";
import { zip } from "./zip.js";
import * as store from "./store.js";
import * as lm from "./lm.js";

const $ = (id) => document.getElementById(id);
const setStatus = (text) => { $("status").textContent = text; };

// ---- Offline support and cross-origin isolation ----------------------------

function showOffline(state, text) {
  $("offline").className = state;
  $("offline").textContent = text;
}

const mb = (bytes) => (bytes / 1e6).toFixed(0);

function onServiceWorkerMessage({ data: m }) {
  if (m.type === "offline-progress") {
    showOffline("pending", `Saving for offline: ${mb(m.done)} / ${mb(m.total)} MB`);
    if (!crossOriginIsolated) setStatus("First visit: downloading the Rust toolchain…");
  } else if (m.type === "offline-ready") {
    showOffline("ready", "✓ Ready for offline use");
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
  const hadController = !!sw.controller;
  sw.addEventListener("controllerchange", () => {
    if (!crossOriginIsolated) reloadForIsolation();
    else if (hadController) {
      // A new version took over; the page still runs the old one.
      $("status").innerHTML = "";
      const b = document.createElement("button");
      b.textContent = "Update ready: reload";
      b.onclick = () => location.reload();
      $("status").append(b);
    }
  });
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

// ---- Files -----------------------------------------------------------------

/** name -> content, mirrored in IndexedDB. */
const files = new Map();
let active = null;
const saveTimers = new Map();

const editor = createEditor($("editor"), {
  onChange(text) {
    files.set(active, text);
    scheduleSave(active);
  },
  keys: [
    { key: "Mod-Enter", run: () => (run(), true) },
    { key: "Mod-s", run: () => (flushSaves(), true) },
    { key: "Shift-Mod-f", run: () => (format(), true) },
  ],
});

function scheduleSave(name) {
  clearTimeout(saveTimers.get(name));
  saveTimers.set(name, setTimeout(() => save(name), 400));
}

function save(name) {
  clearTimeout(saveTimers.get(name));
  saveTimers.delete(name);
  if (files.has(name)) store.putFile(name, files.get(name)).catch((e) => setStatus(`Saving failed: ${e}`));
}

function flushSaves() {
  for (const name of [...saveTimers.keys()]) save(name);
}

function renderFiles() {
  const list = $("file-list");
  list.textContent = "";
  for (const name of [...files.keys()].sort()) {
    const li = document.createElement("li");
    li.textContent = name;
    li.className = name === active ? "active" : "";
    li.onclick = () => openFile(name);
    list.append(li);
  }
}

function openFile(name) {
  if (active !== null && files.has(active)) editor.save(active);
  active = name;
  editor.open(name, files.get(name));
  store.setSetting("active", name);
  renderFiles();
}

/** A name like `base` that no file has yet: base.rs, base_2.rs, … */
function freeName(base) {
  const stem = base.replace(/\.rs$/, "");
  let name = `${stem}.rs`;
  for (let i = 2; files.has(name); i++) name = `${stem}_${i}.rs`;
  return name;
}

/** Ask for a file name; returns a valid, unused one, or null. */
function askName(message, initial) {
  let name = prompt(message, initial)?.trim();
  if (!name) return null;
  if (!name.endsWith(".rs")) name += ".rs";
  if (!store.validName(name)) {
    alert(`"${name}" is not a valid name: use letters, digits and _, starting with a letter, ending in .rs.`);
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
  await store.putFile(name, content);
  openFile(name);
}

async function loadFiles() {
  for (const { name, content } of await store.listFiles()) files.set(name, content);
  if (files.size === 0) {
    for (const [name, content] of [["main.rs", EXAMPLES["hello.rs"]], ["shapes.rs", EXAMPLES["shapes.rs"]]]) {
      files.set(name, content);
      await store.putFile(name, content);
    }
  }
  const last = await store.getSetting("active");
  openFile(files.has(last) ? last : files.has("main.rs") ? "main.rs" : [...files.keys()].sort()[0]);
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
    await store.renameFile(from, to, content);
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
    await store.deleteFile(name);
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
      if (!name.endsWith(".rs")) name += ".rs";
      if (!store.validName(name)) name = freeName("imported");
      if (files.has(name) && !confirm(`Replace the existing ${name}?`)) name = freeName(name);
      await addFile(name, await file.text());
    }
    e.target.value = "";
  };
  $("export").onclick = () => {
    flushSaves();
    download(active, new Blob([files.get(active)], { type: "text/plain" }));
  };
  $("export-all").onclick = () => {
    flushSaves();
    const list = [...files].sort().map(([name, content]) => ({ name, content }));
    download(`rust-files-${new Date().toISOString().slice(0, 10)}.zip`, zip(list));
  };
  $("docs").onchange = (e) => {
    if (e.target.value) open(e.target.value, "_blank");
    e.target.value = "";
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

// ---- Compiling and running -------------------------------------------------

const terminal = new Terminal($("output"), $("stdin"), {
  onInput: (text) => compiler?.postMessage({ type: "stdin", id: current, text }),
  onEof: () => {
    terminal.write("info", "^D\n");
    compiler?.postMessage({ type: "eof", id: current });
  },
});
let compiler = null;
let ready = false;
/** The id of the request in progress, or null. */
let current = null;
let nextId = 1;

function setBusy(busy) {
  $("run").disabled = busy || !ready;
  $("format").disabled = busy || !ready;
  $("stop").disabled = !busy;
}

function startCompiler() {
  compiler = new Worker("compiler-worker.js", { type: "module" });
  compiler.onmessage = ({ data: m }) => {
    if (m.type === "status") setStatus(m.text);
    else if (m.type === "ready") {
      ready = true;
      setBusy(false);
    } else if (m.id !== undefined && m.id !== current) {
      // From a request that was stopped.
    } else if (m.type === "output") terminal.write(m.stream, m.text);
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
  if (m.stage === "compile") {
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

function finishRequest() {
  current = null;
  terminal.setRunning(false);
  setBusy(false);
}

function run() {
  if (!ready || current !== null) return;
  flushSaves();
  current = nextId++;
  setBusy(true);
  terminal.clear();
  terminal.write("info", `Compiling ${active}…\n`);
  const list = [...files].map(([name, content]) => ({ name, content }));
  compiler.postMessage({ type: "run", id: current, files: list, main: active });
}

function format() {
  if (!ready || current !== null) return;
  current = nextId++;
  setBusy(true);
  terminal.clear();
  compiler.postMessage({ type: "format", id: current, name: active, content: editor.text() });
}

function stop() {
  if (current === null) return;
  compiler.postMessage({ type: "kill", id: current });
}

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
    editor.setSuggest(model.complete);
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
loadFiles().catch((e) => setStatus(`Could not load your files: ${e}`));
setupServiceWorker().catch((e) => showOffline("", `Offline: unavailable (${e.message})`));
requestPersistence();
store.getSetting("ai").then((on) => { if (on) setAI(true, { ask: false }); });
if (crossOriginIsolated) startCompiler();
else setStatus("Setting up…");
