// CodeMirror 6 with Rust highlighting, bundled by scripts/build.sh into editor.js.
import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap, tooltips } from "@codemirror/view";
import { indentLess, indentMore, isolateHistory } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { acceptCompletion, closeCompletion, ifNotIn, startCompletion } from "@codemirror/autocomplete";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { rust, rustLanguage } from "@codemirror/lang-rust";
import { python, pythonLanguage } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { pythonCompletions, rustCompletions } from "./completion.js";
import { acceptGhost, dropGhost, ghostText } from "./ghost.js";
import { Vim, vim } from "@replit/codemirror-vim";
import { MergeView } from "@codemirror/merge";

/** The language of file `name`, by its extension: Rust, or Python for .py. */
const languageFor = (name) => (name.endsWith(".py") ? python() : rust());

/** A read-only side-by-side diff of file `name`, from text `before` to
 *  `after`, in `parent`; returns it, to destroy() it. */
export function createDiffView(parent, before, after, name) {
  const extensions = [basicSetup, languageFor(name), oneDark, EditorState.readOnly.of(true), EditorView.editable.of(false)];
  return new MergeView({ a: { doc: before, extensions }, b: { doc: after, extensions }, parent, collapseUnchanged: {} });
}

/** A hover's card: its title (a signature), its body, and a link to its docs. */
function hoverCard({ title, body, link }) {
  const dom = document.createElement("div");
  dom.className = "cm-hover-doc";
  const head = dom.appendChild(document.createElement("code"));
  head.textContent = title;
  if (body) dom.appendChild(document.createElement("p")).textContent = body;
  if (link) {
    const a = dom.appendChild(document.createElement("a"));
    Object.assign(a, { href: link, target: "_blank", textContent: "Open the docs" });
  }
  return dom;
}

/** Each editor's view -> what Vim's :w does in it. */
const savers = new WeakMap();
Vim.defineEx("write", "w", (cm) => savers.get(cm.cm6)?.());

/** Tab accepts a completion from the list, or else the AI's suggestion, or
 *  asks for a completion after a word, `.` or `::`; otherwise it indents.
 *  Shift-Tab accepts the AI's suggestion even when a list is open too
 *  (closing it); otherwise it outdents. */
const tab = {
  key: "Tab",
  run: (view) => {
    if (acceptCompletion(view) || acceptGhost(view)) return true;
    const { head, empty } = view.state.selection.main;
    if (empty && /[\w.:]$/.test(view.state.sliceDoc(head - 1, head))) return startCompletion(view);
    return indentMore(view);
  },
  shift: (view) => {
    if (!acceptGhost(view)) return indentLess(view);
    closeCompletion(view);
    return true;
  },
};

/** An editor in `parent`. `onChange(text)` follows every edit; `keys` are
 *  extra bindings, as in CodeMirror's keymap ({ key, run }); `onSave` is
 *  called on Vim's :w; `onDefinition(word, pos)` on F12 or Ctrl/Cmd-click on
 *  a word; `onRename(word, pos)` on F2 on a word. Each file gets its own
 *  state (and undo history) via `open(name, text)`. */
export function createEditor(parent, { onChange, keys = [], onSave = () => {}, onDefinition = () => {}, onRename = () => {} }) {
  const states = new Map();
  let shown = null;
  let suggest = null;
  let members = null;
  let hover = null;
  // Vim key bindings, when on: first, so that they come before the others.
  const vimMode = new Compartment();
  let vimOn = false;
  const vimExtension = () => (vimOn ? vim({ status: true }) : []);
  /** Ask for the definition of the word at `pos`, if there is one. */
  const definition = (state, pos) => {
    const word = state.wordAt(pos);
    if (word) onDefinition(state.sliceDoc(word.from, word.to), word.from);
    return word !== null;
  };
  const rename = (state) => {
    const word = state.wordAt(state.selection.main.head);
    if (word) onRename(state.sliceDoc(word.from, word.to), word.from);
    return word !== null;
  };
  const extensions = (name) => [
    vimMode.of(vimExtension()),
    keymap.of([...keys, tab, { key: "Escape", run: dropGhost },
      { key: "F12", run: (v) => definition(v.state, v.state.selection.main.head) },
      { key: "F2", run: (v) => rename(v.state) }]),
    EditorView.domEventHandlers({
      mousedown(e, v) {
        if (!(e.ctrlKey || e.metaKey)) return false;
        const pos = v.posAtCoords(e);
        if (pos === null || !definition(v.state, pos)) return false;
        e.preventDefault();
        return true;
      },
    }),
    ghostText(() => suggest),
    hoverTooltip(async (view, pos) => {
      const word = hover && view.state.wordAt(pos);
      const info = word && (await hover(view.state.doc.toString(), word.from, word.to));
      return info ? { pos: word.from, end: word.to, above: true, create: () => ({ dom: hoverCard(info) }) } : null;
    }, { hoverTime: 400 }),
    // Completion lists and their docs may reach beyond the editor's pane.
    tooltips({ parent: document.body }),
    basicSetup,
    indentUnit.of("    "),
    languageFor(name),
    rustLanguage.data.of({
      autocomplete: ifNotIn(["String", "RawString", "Char", "LineComment", "BlockComment"],
        rustCompletions((...args) => members?.(...args) ?? null)),
    }),
    pythonLanguage.data.of({
      autocomplete: ifNotIn(["String", "FormatString", "Comment"], pythonCompletions((...args) => members?.(...args) ?? null)),
    }),
    oneDark,
    lintGutter(),
    // Diagnostics are of the text that was compiled: an edit clears them.
    EditorState.transactionExtender.of((tr) => (tr.docChanged ? setDiagnostics(tr.startState, []) : null)),
    EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
  ];
  const view = new EditorView({ parent });
  savers.set(view, onSave);
  return {
    /** Show file `name`, creating its state from `text` the first time. */
    open(name, text) {
      if (!states.has(name)) states.set(name, EditorState.create({ doc: text, extensions: extensions(name) }));
      view.setState(states.get(name));
      shown = name;
      view.focus();
    },
    /** Forget a file's state (deleted or renamed). */
    forget(name) { states.delete(name); },
    text: () => view.state.doc.toString(),
    /** Replace the whole text of file `name` (the open one by default), as
     *  one undoable edit of the part that differs. */
    replace(text, name = shown) {
      const state = name === shown ? view.state : states.get(name);
      if (!state) return;
      const old = state.doc.toString();
      let from = 0;
      while (from < Math.min(old.length, text.length) && old[from] === text[from]) from++;
      let end = 0;
      while (end < Math.min(old.length, text.length) - from && old.at(-1 - end) === text.at(-1 - end)) end++;
      const changes = { from, to: old.length - end, insert: text.slice(from, text.length - end) };
      const tr = state.update({ changes, annotations: isolateHistory.of("full") });
      if (name === shown) view.dispatch(tr);
      else states.set(name, tr.state);
    },
    /** Put the cursor at `line` and `col` (from 1), in view. */
    goto(line, col) {
      const doc = view.state.doc;
      const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
      const pos = Math.min(l.from + Math.max(col, 1) - 1, l.to);
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    },
    /** Go to the definition of the word at the cursor, if there is one. */
    goToDefinition() { definition(view.state, view.state.selection.main.head); },
    /** Remember the current state of `name` (call before switching away). */
    save(name) { states.set(name, view.state); },
    /** Show `list` of { line, col, width, severity, message } (from 1) in
     *  the open file, in place of any before. */
    setDiagnostics(list) {
      const doc = view.state.doc;
      view.dispatch(setDiagnostics(view.state, list.map((d) => {
        const l = doc.line(Math.min(Math.max(d.line, 1), doc.lines));
        const from = Math.min(l.from + Math.max(d.col, 1) - 1, l.to);
        return { from, to: Math.min(from + d.width, l.to), severity: d.severity, message: d.message };
      })));
    },
    /** Turn inline suggestions on with `suggest(doc, pos, signal)`, which
     *  returns the rest of the line at `pos`, or off with null. */
    setSuggest(fn) { suggest = fn; },
    /** Turn type-aware completion on with `fn(doc, from, to)`, which returns
     *  the options after a dot, or in Python's imports (or null), or off
     *  with null. */
    setMembers(fn) { members = fn; },
    /** Show docs on hover with `fn(doc, from, to)`, which returns { title,
     *  body, link? } for the word at [from, to), or null; or none, with null. */
    setHover(fn) { hover = fn; },
    /** Turn Vim key bindings on or off, in every file. */
    setVim(on) {
      vimOn = on;
      const effects = vimMode.reconfigure(vimExtension());
      for (const [name, state] of states) states.set(name, state.update({ effects }).state);
      view.dispatch({ effects });
    },
  };
}
