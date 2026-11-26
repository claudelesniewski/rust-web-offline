// CodeMirror 6 with Rust highlighting, bundled by scripts/build.sh into editor.js.
import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentLess, indentMore } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { acceptCompletion, closeCompletion, ifNotIn, startCompletion } from "@codemirror/autocomplete";
import { rust, rustLanguage } from "@codemirror/lang-rust";
import { oneDark } from "@codemirror/theme-one-dark";
import { rustCompletions } from "./completion.js";
import { acceptGhost, dropGhost, ghostText } from "./ghost.js";

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
 *  extra bindings, as in CodeMirror's keymap ({ key, run }). Each file gets
 *  its own state (and undo history) via `open(name, text)`. */
export function createEditor(parent, { onChange, keys = [] }) {
  const states = new Map();
  let suggest = null;
  const extensions = [
    keymap.of([...keys, tab, { key: "Escape", run: dropGhost }]),
    ghostText(() => suggest),
    basicSetup,
    indentUnit.of("    "),
    rust(),
    rustLanguage.data.of({
      autocomplete: ifNotIn(["String", "RawString", "Char", "LineComment", "BlockComment"], rustCompletions),
    }),
    oneDark,
    EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
  ];
  const view = new EditorView({ parent });
  return {
    /** Show file `name`, creating its state from `text` the first time. */
    open(name, text) {
      if (!states.has(name)) states.set(name, EditorState.create({ doc: text, extensions }));
      view.setState(states.get(name));
      view.focus();
    },
    /** Forget a file's state (deleted or renamed). */
    forget(name) { states.delete(name); },
    text: () => view.state.doc.toString(),
    /** Replace the whole text, as one undoable edit. */
    replace(text) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); },
    /** Remember the current state of `name` (call before switching away). */
    save(name) { states.set(name, view.state); },
    /** Turn inline suggestions on with `suggest(prefix, signal)`, which
     *  returns the rest of the line, or off with null. */
    setSuggest(fn) { suggest = fn; },
  };
}
