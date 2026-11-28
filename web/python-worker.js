// Runs Python programs with Pyodide, from the Python pack (web/packs.js).
//
// Messages from the page:
//   { type: "init", stdin }        stdin: a SharedArrayBuffer, see below
//   { type: "run", id, files, main }
//   { type: "test", id, files, modules }   run the tests of `modules` (as
//                                          "pkg.mod"), each answered by a "test"
//   { type: "complete", id, files, name, line, col }  (line from 1, col from 0)
//   { type: "lint", id, source }
//   { type: "hover", id, files, name, line, col }
//   { type: "cell", id, files, code, count }   run a notebook's cell in the
//                                          kernel: a namespace kept between
//                                          cells, until the worker ends
// Messages to the page:
//   { type: "status", text }
//   { type: "output", id, stream: "stdout" | "stderr", text }
//   { type: "stdin", id }          the program waits for a line of input
//   { type: "done", id, code, ms }    to "cell" also: result (the repr of
//                                  its last expression, or null), error
//                                  ({ ename, evalue, traceback }, or null)
//   { type: "image", id, mime, data }  a figure a cell drew (data: base64)
//   { type: "test", id, name, ok, output, ms }  a test's result
//   { type: "answer", id, value }  to "complete": [{ label, type, detail }], or
//                                  null; to "lint": the lines with problems;
//                                  to "hover": { title, body }, or null
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
    _forget_project()
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

_kernel = {"__name__": "__main__"}

def _cell(code, count):
    """Run notebook cell \`code\` in the kernel's namespace; as Jupyter does,
    its last expression's repr is the result. Its figures, if it drew with
    matplotlib, are PNGs (base64)."""
    import ast, linecache
    name = f"<cell {count}>"
    linecache.cache[name] = (len(code), None, code.splitlines(True), name)
    result = error = None
    try:
        tree = ast.parse(code, name)
        last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
        exec(compile(tree, name, "exec"), _kernel)
        if last:
            value = eval(compile(ast.Expression(last.value), name, "eval"), _kernel)
            if value is not None:
                result = repr(value)
    except BaseException as e:
        # From the cell's code on, or the project's.
        tb = e.__traceback__
        while tb and tb.tb_frame.f_code.co_filename != name and not tb.tb_frame.f_code.co_filename.startswith("${SRC}/"):
            tb = tb.tb_next
        error = {"ename": type(e).__name__, "evalue": str(e),
                 "traceback": "".join(traceback.format_exception(type(e), e, tb)).splitlines()}
    sys.stdout.flush()
    sys.stderr.flush()
    return {"result": result, "error": error, "images": _figures()}

def _figures():
    plt = sys.modules.get("matplotlib.pyplot")
    if not plt:
        return []
    import base64, io
    images = []
    for num in plt.get_fignums():
        buf = io.BytesIO()
        plt.figure(num).savefig(buf, format="png")
        images.append(base64.b64encode(buf.getvalue()).decode())
    plt.close("all")
    return images

# jedi's kinds of names, as CodeMirror's completion types.
_KINDS = {"module": "namespace", "class": "class", "function": "function", "keyword": "keyword",
          "property": "property", "param": "variable", "statement": "variable", "instance": "variable"}

def _complete(code, path, line, col):
    import jedi
    script = jedi.Script(code, path=path, project=jedi.Project("${SRC}"))
    return [{"label": c.name, "type": _KINDS.get(c.type, "variable"), "detail": c.description}
            for c in script.complete(line, col)[:200]]

def _forget_project():
    # Modules of the project, imported before: import them afresh.
    for name, module in list(sys.modules.items()):
        if (getattr(module, "__file__", None) or "").startswith("${SRC}/"):
            del sys.modules[name]

def _cases(suite):
    import unittest
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            yield from _cases(test)
        else:
            yield test

def _test(modules, report):
    """Run the tests of \`modules\`: their unittest.TestCase classes, and their
    functions named test_*; \`report(name, ok, output, ms)\` each. The number
    that failed."""
    import contextlib, importlib, io, time, traceback, unittest
    _forget_project()
    failed = 0
    for module_name in modules:
        t0 = time.perf_counter()
        try:
            module = importlib.import_module(module_name)
        except BaseException:
            report(module_name, False, traceback.format_exc(), (time.perf_counter() - t0) * 1000)
            failed += 1
            continue
        suite = unittest.TestLoader().loadTestsFromModule(module)
        for name, f in vars(module).items():
            if name.startswith("test") and callable(f) and not isinstance(f, type) and getattr(f, "__module__", None) == module_name:
                suite.addTest(unittest.FunctionTestCase(f, description=f"{module_name}.{name}"))
        for case in _cases(suite):
            out = io.StringIO()
            result = unittest.TestResult()
            t0 = time.perf_counter()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
                case.run(result)
            problems = result.failures + result.errors
            failed += bool(problems)
            name = case.shortDescription() if isinstance(case, unittest.FunctionTestCase) else case.id()
            report(name, not problems, out.getvalue() + "".join(tb for _, tb in problems), (time.perf_counter() - t0) * 1000)
    return failed
def _hover(code, path, line, col):
    import jedi
    script = jedi.Script(code, path=path, project=jedi.Project("${SRC}"))
    for name in script.help(line, col):
        signatures = name.get_signatures()
        title = signatures[0].to_string() if signatures else f"{name.type} {name.full_name or name.name}"
        return {"title": title, "body": name.docstring(raw=True).strip()[:2000], "link": _docs_link(name)}
    return None

def _docs_link(name):
    """Where the Python docs (python-docs/) describe \`name\`, if it's the
    standard library's: Sphinx's anchors are full names (json.loads)."""
    full = name.full_name or ""
    top = full.split(".")[0]
    if top == "builtins":
        rest = full[len("builtins."):]
        page = "stdtypes" if "." in rest else "functions" if name.type == "function" else "stdtypes"
        return f"python-docs/library/{page}.html#{rest}"
    if not top or top not in sys.stdlib_module_names or top.startswith("_"):
        return None
    # The page of its module: the longest dotted prefix that is one (os.path).
    parts = full.split(".")
    end = len(parts) if name.type == "module" else len(parts) - 1
    page = next((".".join(parts[:i]) for i in range(end, 0, -1) if ".".join(parts[:i]) in sys.modules), top)
    return f"python-docs/library/{page}.html" + ("" if name.type == "module" else f"#{full}")

def _problems(code):
    """The lines (from 1) of \`code\` with a syntax error, or a name that is
    bound nowhere in it (nor a builtin): a quick check, not a linter's."""
    import ast, builtins
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return [e.lineno or 0]
    bound = set(dir(builtins)) | {"__file__", "__builtins__"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and not isinstance(node.ctx, ast.Load):
            bound.add(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                if alias.name == "*":
                    return []  # anything may be bound
                bound.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            bound.update(node.names)
        elif isinstance(node, (ast.ExceptHandler, ast.MatchAs, ast.MatchStar)) and node.name:
            bound.add(node.name)
        elif isinstance(node, ast.MatchMapping) and node.rest:
            bound.add(node.rest)
    return sorted({n.lineno for n in ast.walk(tree)
                   if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and n.id not in bound})
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

/** Write the project's files, import the installed packages they import,
 *  and make SRC the place to run from and import from. */
async function prepare(files) {
  writeFiles(files);
  const code = files.filter((f) => f.name.endsWith(".py")).map((f) => f.content).join("\n");
  // The packages the program imports, if installed (else its import fails).
  await pyodide.loadPackagesFromImports(code, { messageCallback: () => {}, errorCallback: () => {} });
  pyodide.runPython(`import os, sys; os.chdir("${SRC}"); sys.path[0:0] = [] if "${SRC}" in sys.path else ["${SRC}"]`);
}

async function test({ id, files, modules }) {
  current = id;
  if (!pyodide) await load();
  const t0 = performance.now();
  await prepare(files);
  const report = (name, ok, output, ms) => post({ type: "test", id, name, ok, output, ms });
  const failed = pyodide.globals.get("_test")(pyodide.toPy(modules), report);
  post({ type: "done", id, code: failed ? 1 : 0, ms: performance.now() - t0 });
}

async function run({ id, files, main }) {
  current = id;
  if (!pyodide) await load();
  const t0 = performance.now();
  await prepare(files);
  const exit = pyodide.globals.get("_run")(`${SRC}/${main}`);
  post({ type: "done", id, code: exit, ms: performance.now() - t0 });
}

async function cell({ id, files, code, count }) {
  current = id;
  if (!pyodide) await load();
  const t0 = performance.now();
  await prepare(files);
  await pyodide.loadPackagesFromImports(code, { messageCallback: () => {}, errorCallback: () => {} });
  const value = pyodide.globals.get("_cell")(code, count);
  const { result, error, images } = value.toJs({ dict_converter: Object.fromEntries });
  value.destroy();
  for (const data of images) post({ type: "image", id, mime: "image/png", data });
  post({ type: "done", id, code: error ? 1 : 0, ms: performance.now() - t0, result: result ?? null, error: error ?? null });
}

/** `fn` (_complete or _hover) at a place in a file of the project, by jedi
 *  (a package of the Python pack); null if it isn't installed. */
async function withJedi(fn, { files, name, line, col }) {
  try {
    await pyodide.loadPackage("jedi", { messageCallback: () => {}, errorCallback: () => {} });
    writeFiles(files);
    const code = files.find((f) => f.name === name)?.content ?? "";
    const value = pyodide.globals.get(fn)(code, `${SRC}/${name}`, line, col);
    return value?.toJs ? value.toJs({ dict_converter: Object.fromEntries }) : value ?? null;
  } catch {
    return null; // not installed (offline), or jedi failed
  }
}

/** Answer request `m` with `fn(m)`'s value. */
async function answer(m, fn) {
  if (!pyodide) await load();
  post({ type: "answer", id: m.id, value: await fn(m) });
}

// One request at a time: each writes the project's files.
let queue = Promise.resolve();
onmessage = ({ data: m }) => {
  if (m.type === "init") {
    ctrl = new Int32Array(m.stdin, 0, 2);
    bytes = new Uint8Array(m.stdin, 8);
  } else if (m.type === "run") {
    queue = queue.then(() => run(m)).catch((e) => post({ type: "error", id: m.id, text: String(e?.message ?? e) }));
  } else if (m.type === "test") {
    queue = queue.then(() => test(m)).catch((e) => post({ type: "error", id: m.id, text: String(e?.message ?? e) }));
  } else if (m.type === "cell") {
    queue = queue.then(() => cell(m)).catch((e) => post({ type: "error", id: m.id, text: String(e?.message ?? e) }));
  } else if (m.type === "complete") {
    queue = queue.then(() => answer(m, (r) => withJedi("_complete", r)));
  } else if (m.type === "hover") {
    queue = queue.then(() => answer(m, (r) => withJedi("_hover", r)));
  } else if (m.type === "lint") {
    queue = queue.then(() => answer(m, ({ source }) => pyodide.globals.get("_problems")(source).toJs()));
  }
};
