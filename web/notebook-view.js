// The notebook view: an .ipynb file's cells (web/notebook.js), each code
// cell with an editor of its own and its outputs, run in the Python
// worker's kernel; Markdown cells rendered, edited on double-click.
import { createCellEditor } from "./editor.js";
import { addOutput, newCell, parseNotebook, renderMarkdown, serializeNotebook } from "./notebook.js";

const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text ?? "" });
const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, ""); // Jupyter's tracebacks have colours

/** A notebook view in `root`. `onChange(text)` follows every change, with
 *  the notebook's .ipynb text. `runCell(code, count, onOutput)` runs a code
 *  cell in the kernel, `onOutput(m)` getting its "output" and "image"
 *  messages, and resolves with its "done" ({ result, error }), or null if
 *  it didn't run; `restart()` starts a new kernel. */
export function createNotebookView(root, { onChange, runCell, restart }) {
  let nb = null;
  let selected = 0;
  let count = 0; // the kernel's last execution count
  let running = false;
  const editing = new Set(); // the Markdown cells being edited

  const toolbar = root.appendChild(el("div", "nb-toolbar"));
  const list = root.appendChild(el("div", "nb-cells"));
  const changed = () => onChange(serializeNotebook(nb));

  const insert = (type) => {
    nb.cells.splice(selected + 1, 0, newCell(type));
    select(selected + 1);
    render();
    changed();
    focus(selected);
  };
  const move = (by) => {
    const to = selected + by;
    if (to < 0 || to >= nb.cells.length) return;
    nb.cells.splice(to, 0, ...nb.cells.splice(selected, 1));
    selected = to;
    render();
    changed();
  };
  for (const [label, title, fn] of [
    ["+ Code", "Add a code cell below", () => insert("code")],
    ["+ Markdown", "Add a Markdown cell below", () => insert("markdown")],
    ["Delete cell", "Delete the selected cell", () => {
      nb.cells.splice(selected, 1);
      if (!nb.cells.length) nb.cells.push(newCell("code"));
      selected = Math.min(selected, nb.cells.length - 1);
      render();
      changed();
    }],
    ["↑", "Move the selected cell up", () => move(-1)],
    ["↓", "Move the selected cell down", () => move(1)],
    ["Run all", "Run every code cell, in order, until one fails", () => runAll()],
    ["Restart kernel", "Start Python afresh: forget all names defined", () => {
      restart();
      count = 0;
    }],
    ["Clear outputs", "Clear every cell's outputs", () => {
      for (const c of nb.cells) if (c.cell_type === "code") Object.assign(c, { outputs: [], execution_count: null });
      render();
      changed();
    }],
  ]) {
    const b = toolbar.appendChild(el("button", "", label));
    b.title = title;
    b.onclick = fn;
  }

  function select(i) {
    selected = i;
    list.querySelectorAll(".cell").forEach((c, j) => c.classList.toggle("selected", j === i));
  }

  function focus(i) {
    const cell = list.children[i];
    if (!cell) return;
    cell.scrollIntoView({ block: "nearest" });
    cell.querySelector(".cm-content")?.focus();
  }

  /** Run cell `i` (Markdown: render it); whether it ran without an error. */
  async function run(i) {
    const cell = nb.cells[i];
    if (cell.cell_type !== "code") {
      editing.delete(cell);
      renderCell(cell);
      return true;
    }
    if (running) return false;
    running = true;
    const outputs = [];
    const dom = list.children[i];
    dom.querySelector(".count").textContent = "[*]";
    const shown = dom.querySelector(".cell-outputs");
    shown.textContent = "";
    const done = await runCell(cell.source, count + 1, (m) => {
      addOutput(outputs, m.type === "image"
        ? { output_type: "display_data", data: { [m.mime]: m.data }, metadata: {} }
        : { output_type: "stream", name: m.stream, text: m.text });
      renderOutputs(shown, outputs);
    });
    running = false;
    if (!done) {
      renderCell(cell);
      return false;
    }
    count++;
    if (done.result !== null) {
      outputs.push({ output_type: "execute_result", execution_count: count, data: { "text/plain": done.result }, metadata: {} });
    }
    if (done.error) outputs.push({ output_type: "error", ...done.error });
    Object.assign(cell, { outputs, execution_count: count });
    // Unless it was deleted meanwhile, or another notebook opened.
    if (renderCell(cell)) changed();
    return !done.error;
  }

  /** Run cell `i`, then select the next one (adding one at the end). */
  async function runAndAdvance(i) {
    const ok = run(i);
    if (i === nb.cells.length - 1) {
      nb.cells.push(newCell("code"));
      list.append(cellDom(i + 1));
    }
    select(i + 1);
    await ok;
    focus(i + 1);
  }

  async function runAll() {
    for (let i = 0; i < nb.cells.length; i++) {
      if (nb.cells[i].cell_type === "code" && !(await run(i))) return;
    }
  }

  function renderOutputs(dom, outputs) {
    dom.textContent = "";
    for (const o of outputs) {
      const image = o.data?.["image/png"];
      if (image) {
        dom.appendChild(el("img")).src = `data:image/png;base64,${image}`;
      } else if (o.output_type === "stream") {
        dom.append(el("pre", `out-${o.name}`, o.text));
      } else if (o.output_type === "error") {
        dom.append(el("pre", "out-error", plain(o.traceback.join("\n"))));
      } else if (o.data?.["text/plain"] !== undefined) {
        dom.append(el("pre", "out-result", o.data["text/plain"]));
      }
    }
  }

  function cellDom(i) {
    const cell = nb.cells[i];
    const dom = el("div", `cell ${cell.cell_type}${i === selected ? " selected" : ""}`);
    dom.onmousedown = () => select([...list.children].indexOf(dom));
    const at = () => [...list.children].indexOf(dom);
    const keys = [
      { key: "Shift-Enter", run: () => (runAndAdvance(at()), true) },
      { key: "Mod-Enter", run: () => (run(at()), true) },
    ];
    const edit = (parent, isPython) => {
      const view = createCellEditor(parent, cell.source, {
        isPython, keys,
        onChange(text) {
          cell.source = text;
          changed();
        },
      });
      dom.view = view;
      return view;
    };
    if (cell.cell_type === "code") {
      const head = dom.appendChild(el("div", "cell-head"));
      head.append(el("span", "count", `[${cell.execution_count ?? " "}]`));
      const button = head.appendChild(el("button", "cell-run", "▶"));
      button.title = "Run this cell (Shift-Enter: run it and go to the next)";
      button.onclick = () => run(at());
      edit(dom.appendChild(el("div", "cell-input")), true);
      renderOutputs(dom.appendChild(el("div", "cell-outputs")), cell.outputs);
    } else if (editing.has(cell) || !cell.source.trim()) {
      const view = edit(dom.appendChild(el("div", "cell-input")), false);
      if (editing.has(cell)) setTimeout(() => view.focus());
    } else {
      const shown = dom.appendChild(el("div", "markdown-body"));
      shown.innerHTML = renderMarkdown(cell.source); // escaped: see renderMarkdown
      shown.title = "Double-click to edit";
      shown.ondblclick = () => {
        editing.add(cell);
        renderCell(cell);
      };
    }
    return dom;
  }

  /** Render `cell` afresh; whether it's (still) in the notebook. */
  function renderCell(cell) {
    const i = nb?.cells.indexOf(cell) ?? -1;
    if (i < 0) return false;
    list.children[i].view?.destroy();
    list.children[i].replaceWith(cellDom(i));
    return true;
  }

  function render() {
    for (const dom of list.children) dom.view?.destroy();
    list.replaceChildren(...nb.cells.map((_, i) => cellDom(i)));
  }

  return {
    /** Show the notebook in `text` (an .ipynb file's). */
    open(text) {
      try {
        nb = parseNotebook(text);
      } catch (e) {
        nb = null;
        list.replaceChildren(el("p", "nb-error", `This file can't be shown as a notebook: ${e.message}.`));
        toolbar.hidden = true;
        return;
      }
      toolbar.hidden = false;
      selected = 0;
      editing.clear();
      render();
    },
    runAll,
    /** The kernel stopped (and starts afresh at the next run). */
    stopped() { count = 0; },
  };
}
