// Jupyter notebooks (.ipynb): nbformat 4's JSON as the notebook view
// (web/notebook-view.js) edits it, and Markdown cells' rendering.
//
// A notebook here: { cells, metadata, nbformat, nbformat_minor }, each cell
// { cell_type, id, metadata, source, outputs?, execution_count? } with its
// source a string, and its outputs' texts strings too (nbformat allows a
// string or a list of lines: lists are joined, and written back as lists).

/** nbformat's text: a string, or a list of lines. */
const joined = (text) => (Array.isArray(text) ? text.join("") : text ?? "");

/** `text` as nbformat writes it: a list of lines, each with its "\n". */
const lines = (text) => text.split(/(?<=\n)/).filter(Boolean);

/** Each output's texts, by `fn` (joined or lines). */
function mapTexts(output, fn) {
  const o = { ...output };
  if (o.output_type === "stream") o.text = fn(o.text);
  if (o.data) {
    o.data = Object.fromEntries(Object.entries(o.data).map(([mime, value]) =>
      [mime, mime === "image/png" ? joined(value).replace(/\s/g, "") : typeof value === "object" && !Array.isArray(value) ? value : fn(value)]));
  }
  return o;
}

const newId = () => Math.random().toString(36).slice(2, 10);

/** A new cell: "code" or "markdown". */
export function newCell(type, source = "") {
  const cell = { cell_type: type, id: newId(), metadata: {}, source };
  return type === "code" ? { ...cell, execution_count: null, outputs: [] } : cell;
}

/** A notebook from an .ipynb file's text: an empty one (with a code cell)
 *  if it's empty. Throws if it isn't nbformat 4. */
export function parseNotebook(text) {
  if (!text.trim()) return { cells: [newCell("code")], metadata: {}, nbformat: 4, nbformat_minor: 5 };
  const nb = JSON.parse(text);
  if (nb?.nbformat !== 4 || !Array.isArray(nb.cells)) throw new Error("not a Jupyter notebook (nbformat 4)");
  const cells = nb.cells.map((c) => {
    const cell = { ...c, id: c.id ?? newId(), metadata: c.metadata ?? {}, source: joined(c.source) };
    if (c.cell_type === "code") {
      cell.execution_count = c.execution_count ?? null;
      cell.outputs = (c.outputs ?? []).map((o) => mapTexts(o, joined));
    }
    return cell;
  });
  // Cells' ids came in 4.5.
  return { ...nb, cells, metadata: nb.metadata ?? {}, nbformat_minor: Math.max(nb.nbformat_minor ?? 0, 5) };
}

/** A notebook as an .ipynb file's text, as Jupyter writes it. */
export function serializeNotebook(nb) {
  const cells = nb.cells.map((c) => {
    const cell = { ...c, source: lines(c.source) };
    if (c.cell_type === "code") cell.outputs = c.outputs.map((o) => mapTexts(o, lines));
    return cell;
  });
  return `${JSON.stringify({ ...nb, cells }, null, 1)}\n`;
}

/** Add output `o` to `outputs`, as Jupyter does: a stream's text joins the
 *  stream's last output, if it's last. */
export function addOutput(outputs, o) {
  const last = outputs.at(-1);
  if (o.output_type === "stream" && last?.output_type === "stream" && last.name === o.name) last.text += o.text;
  else outputs.push(o);
}

// ---- Markdown ---------------------------------------------------------------

const escape = (s) => s.replace(/[&<>"']/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`);

/** A line's inline Markdown: `code`, **bold**, *italic* or _italic_, and
 *  [links](https://…); all else escaped. */
function inline(text) {
  return text.split(/(`[^`]+`)/).map((part, i) => (i % 2
    ? `<code>${escape(part.slice(1, -1))}</code>`
    : escape(part)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\w*])\*([^*]+)\*(?![\w*])/g, "$1<em>$2</em>")
      .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>'))).join("");
}

/** A Markdown cell's source as HTML, of a small subset of Markdown:
 *  headings, paragraphs, fenced code, lists, and inline code, emphasis and
 *  links. Any HTML in it is escaped, not kept. */
export function renderMarkdown(source) {
  const out = [];
  const src = source.split("\n");
  let paragraph = [];
  let list = null; // { tag, items }
  const flush = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join("\n")}</p>`);
    paragraph = [];
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    let m;
    if (/^\s*```/.test(line)) {
      flush();
      const code = [];
      while (++i < src.length && !/^\s*```/.test(src[i])) code.push(src[i]);
      out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
    } else if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      flush();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if ((m = /^\s*(?:([-*+])|\d+[.)])\s+(.*)$/.exec(line))) {
      const tag = m[1] ? "ul" : "ol";
      if (paragraph.length || list?.tag !== tag) flush();
      list ??= { tag, items: [] };
      list.items.push(m[2]);
    } else if (!line.trim()) {
      flush();
    } else if (list) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else paragraph.push(line);
  }
  flush();
  return out.join("\n");
}
