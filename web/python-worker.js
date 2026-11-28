// Runs Python programs with Pyodide, from the Python pack (web/packs.js).
//
// Messages from the page:
//   { type: "init", stdin }        stdin: a SharedArrayBuffer, see below
//   { type: "run", id, files, main }
// Messages to the page:
//   { type: "status", text }
//   { type: "output", id, stream: "stdout" | "stderr", text }
//   { type: "stdin", id }          the program waits for a line of input
//   { type: "done", id, code, ms }
//   { type: "error", id?, text }
// Stdin: the page writes a line's bytes at offset 8 and their length (or
// -1 for end of input) at [1] of an Int32Array over the buffer, then sets
// [0] to 1 and notifies; this worker waits on [0], then sets it back to 0.

/** Where the project's files go, as Cargo would have them. */
const SRC = "/src";

let pyodide = null;
let ctrl, bytes;
let current = null;

const post = (m) => postMessage(m);

async function load() {
  post({ type: "status", text: "Loading Python…" });
  const { loadPyodide } = await import(new URL("packs/python/pyodide.mjs", self.location).href);
  pyodide = await loadPyodide({ indexURL: new URL("packs/python/", self.location).href });
  const dec = new TextDecoder();
  const out = (stream) => ({
    write: (buf) => {
      post({ type: "output", id: current, stream, text: dec.decode(buf, { stream: true }) });
      return buf.length;
    },
  });
  pyodide.setStdout(out("stdout"));
  pyodide.setStderr(out("stderr"));
  pyodide.setStdin({ stdin: readLine });
  await pyodide.runPythonAsync(`
import runpy, sys, traceback

def _run(path):
    # Modules of the project, imported by the last run: import them afresh.
    for name, module in list(sys.modules.items()):
        if (getattr(module, "__file__", None) or "").startswith("${SRC}/"):
            del sys.modules[name]
    try:
        runpy.run_path(path, run_name="__main__")
        return 0
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    except BaseException as e:
        # From the project's code on: not this function's frames, or runpy's.
        tb = e.__traceback__
        while tb and not tb.tb_frame.f_code.co_filename.startswith("${SRC}/"):
            tb = tb.tb_next
        traceback.print_exception(type(e), e, tb)
        return 1
`);
  post({ type: "status", text: "Ready." });
}

/** A line of input from the page, or null at its end. */
function readLine() {
  post({ type: "stdin", id: current });
  Atomics.wait(ctrl, 0, 0);
  const n = ctrl[1];
  const line = n < 0 ? null : new TextDecoder().decode(bytes.slice(0, n));
  Atomics.store(ctrl, 0, 0);
  return line;
}

/** Write the project's files under SRC, removing earlier ones. */
function writeFiles(files) {
  const fs = pyodide.FS;
  const clear = (dir) => {
    for (const name of fs.readdir(dir)) {
      if (name === "." || name === "..") continue;
      const path = `${dir}/${name}`;
      if (fs.isDir(fs.stat(path).mode)) {
        clear(path);
        fs.rmdir(path);
      } else fs.unlink(path);
    }
  };
  if (fs.analyzePath(SRC).exists) clear(SRC);
  else fs.mkdir(SRC);
  for (const { name, content } of files) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = `${SRC}/${parts.slice(0, i).join("/")}`;
      if (!fs.analyzePath(dir).exists) fs.mkdir(dir);
    }
    fs.writeFile(`${SRC}/${name}`, content);
  }
}

async function run({ id, files, main }) {
  current = id;
  if (!pyodide) await load();
  const t0 = performance.now();
  writeFiles(files);
  const code = files.filter((f) => f.name.endsWith(".py")).map((f) => f.content).join("\n");
  // The packages the program imports, if installed (else its import fails).
  await pyodide.loadPackagesFromImports(code, { messageCallback: () => {}, errorCallback: () => {} });
  pyodide.runPython(`import os, sys; os.chdir("${SRC}"); sys.path[0:0] = [] if "${SRC}" in sys.path else ["${SRC}"]`);
  const exit = pyodide.globals.get("_run")(`${SRC}/${main}`);
  post({ type: "done", id, code: exit, ms: performance.now() - t0 });
}

onmessage = ({ data: m }) => {
  if (m.type === "init") {
    ctrl = new Int32Array(m.stdin, 0, 2);
    bytes = new Uint8Array(m.stdin, 8);
  } else if (m.type === "run") {
    run(m).catch((e) => post({ type: "error", id: m.id, text: String(e?.message ?? e) }));
  }
};
