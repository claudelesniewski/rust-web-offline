import assert from "node:assert/strict";
import { test } from "node:test";
import { addOutput, newCell, parseNotebook, renderMarkdown, serializeNotebook } from "../../web/notebook.js";

/** A notebook as Jupyter writes it. */
const IPYNB = `${JSON.stringify({
  cells: [
    { cell_type: "markdown", id: "a1", metadata: {}, source: ["# Title\n", "Some *text*."] },
    {
      cell_type: "code", execution_count: 2, id: "b2", metadata: {}, source: ["x = 2\n", "x * 21"],
      outputs: [
        { name: "stdout", output_type: "stream", text: ["one\n", "two\n"] },
        { data: { "text/plain": ["42"] }, execution_count: 2, metadata: {}, output_type: "execute_result" },
        { data: { "image/png": "iVBORw0KGgo=", "text/plain": ["<Figure>"] }, metadata: {}, output_type: "display_data" },
        { ename: "ValueError", evalue: "bad", output_type: "error", traceback: ["Traceback:", "ValueError: bad"] },
      ],
    },
  ],
  metadata: { kernelspec: { name: "python3" } },
  nbformat: 4,
  nbformat_minor: 5,
}, null, 1)}\n`;

test("a notebook's sources and texts are strings, written back as Jupyter's lists of lines", () => {
  const nb = parseNotebook(IPYNB);
  assert.equal(nb.cells[0].source, "# Title\nSome *text*.");
  assert.equal(nb.cells[1].source, "x = 2\nx * 21");
  assert.equal(nb.cells[1].outputs[0].text, "one\ntwo\n");
  assert.equal(nb.cells[1].outputs[1].data["text/plain"], "42");
  assert.equal(serializeNotebook(nb), IPYNB);
  assert.deepEqual(parseNotebook(serializeNotebook(nb)), nb);
});

test("older notebooks get cells' ids; an empty file is a new notebook; others are refused", () => {
  const nb = parseNotebook(JSON.stringify({ cells: [{ cell_type: "code", source: "1", outputs: [] }], nbformat: 4, nbformat_minor: 2 }));
  assert.equal(nb.nbformat_minor, 5);
  assert.match(nb.cells[0].id, /^\w+$/);
  assert.equal(nb.cells[0].execution_count, null);
  assert.deepEqual(parseNotebook("").cells.map((c) => c.cell_type), ["code"]);
  assert.throws(() => parseNotebook('{"nbformat": 3, "worksheets": []}'), /nbformat 4/);
  assert.throws(() => parseNotebook("not json"));
});

test("a stream's output joins the one before it, of the same stream", () => {
  const outputs = newCell("code").outputs;
  for (const [name, text] of [["stdout", "a"], ["stdout", "b"], ["stderr", "c"], ["stdout", "d"]]) {
    addOutput(outputs, { output_type: "stream", name, text });
  }
  assert.deepEqual(outputs.map((o) => o.text), ["ab", "c", "d"]);
});

test("Markdown: headings, paragraphs, lists, code and emphasis", () => {
  assert.equal(renderMarkdown("# Hi\n\nOne *two* **three** `x * y` snake_case_name.\nMore."),
    "<h1>Hi</h1>\n<p>One <em>two</em> <strong>three</strong> <code>x * y</code> snake_case_name.\nMore.</p>");
  assert.equal(renderMarkdown("- a\n- b _c_\n\n1. one\n2. two"),
    "<ul><li>a</li><li>b <em>c</em></li></ul>\n<ol><li>one</li><li>two</li></ol>");
  assert.equal(renderMarkdown("```python\nif a < b:\n    pass\n```"), "<pre><code>if a &lt; b:\n    pass</code></pre>");
  assert.equal(renderMarkdown("[docs](https://docs.python.org/?a=1&b=2)"),
    '<p><a href="https://docs.python.org/?a=1&amp;b=2" target="_blank" rel="noopener">docs</a></p>');
});

test("Markdown's HTML is escaped, not kept", () => {
  assert.equal(renderMarkdown('<script>alert("x")</script>'), "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>");
  assert.equal(renderMarkdown("# <img src=x onerror=alert(1)>"), "<h1>&lt;img src=x onerror=alert(1)&gt;</h1>");
  assert.equal(renderMarkdown("`<b>`"), "<p><code>&lt;b&gt;</code></p>");
  // Only http(s) links.
  assert.equal(renderMarkdown("[x](javascript:alert(1))"), "<p>[x](javascript:alert(1))</p>");
  assert.equal(renderMarkdown('[x](https://a.b/"onclick=")'), '<p><a href="https://a.b/&quot;onclick=&quot;" target="_blank" rel="noopener">x</a></p>');
});
