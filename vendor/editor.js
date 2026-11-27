// CodeMirror 6 with Rust highlighting, bundled by scripts/build.sh into editor.js.
import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, tooltips } from "@codemirror/view";
import { indentLess, indentMore } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { acceptCompletion, closeCompletion, ifNotIn, startCompletion } from "@codemirror/autocomplete";
import { rust, rustLanguage } from "@codemirror/lang-rust";
import { oneDark } from "@codemirror/theme-one-dark";
import { rustCompletions } from "./completion.js";
import { acceptGhost, dropGhost, ghostText } from "./ghost.js";
import { Vim, vim } from "@replit/codemirror-vim";

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
 *  called on Vim's :w. Each file gets its own state (and undo history) via
 *  `open(name, text)`. */
export function createEditor(parent, { onChange, keys = [], onSave = () => {} }) {
  const states = new Map();
  let suggest = null;
  let typeMethods = null;
  // Vim key bindings, when on: first, so that they come before the others.
  const vimMode = new Compartment();
  let vimOn = false;
  const vimExtension = () => (vimOn ? vim({ status: true }) : []);
  const extensions = () => [
    vimMode.of(vimExtension()),
    keymap.of([...keys, tab, { key: "Escape", run: dropGhost }]),
    ghostText(() => suggest),
    // Completion lists and their docs may reach beyond the editor's pane.
    tooltips({ parent: document.body }),
    basicSetup,
    indentUnit.of("    "),
    rust(),
    rustLanguage.data.of({
      autocomplete: ifNotIn(["String", "RawString", "Char", "LineComment", "BlockComment"],
        rustCompletions((...args) => typeMethods?.(...args) ?? null)),
    }),
    oneDark,
    EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
  ];
  const view = new EditorView({ parent });
  savers.set(view, onSave);
  return {
    /** Show file `name`, creating its state from `text` the first time. */
    open(name, text) {
      if (!states.has(name)) states.set(name, EditorState.create({ doc: text, extensions: extensions() }));
      view.setState(states.get(name));
      view.focus();
    },
    /** Forget a file's state (deleted or renamed). */
    forget(name) { states.delete(name); },
    text: () => view.state.doc.toString(),
    /** Replace the whole text, as one undoable edit. */
    replace(text) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); },
    /** Put the cursor at `line` and `col` (from 1), in view. */
    goto(line, col) {
      const doc = view.state.doc;
      const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
      const pos = Math.min(l.from + Math.max(col, 1) - 1, l.to);
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    },
    /** Remember the current state of `name` (call before switching away). */
    save(name) { states.set(name, view.state); },
    /** Turn inline suggestions on with `suggest(doc, pos, signal)`, which
     *  returns the rest of the line at `pos`, or off with null. */
    setSuggest(fn) { suggest = fn; },
    /** Turn type-aware completion on with `fn(doc, from, to)`, which returns
     *  the options after a dot (or null), or off with null. */
    setTypeMethods(fn) { typeMethods = fn; },
    /** Turn Vim key bindings on or off, in every file. */
    setVim(on) {
      vimOn = on;
      const effects = vimMode.reconfigure(vimExtension());
      for (const [name, state] of states) states.set(name, state.update({ effects }).state);
      view.dispatch({ effects });
    },
  };
}
