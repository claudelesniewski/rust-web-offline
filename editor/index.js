// CodeMirror 6 with Rust highlighting, bundled by scripts/build.sh into editor.js.
import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { rust } from "@codemirror/lang-rust";
import { oneDark } from "@codemirror/theme-one-dark";

/** An editor in `parent`. `onChange(text)` follows every edit; `keys` are
 *  extra bindings, as in CodeMirror's keymap ({ key, run }). Each file gets
 *  its own state (and undo history) via `open(name, text)`. */
export function createEditor(parent, { onChange, keys = [] }) {
  const states = new Map();
  const extensions = [
    keymap.of([...keys, indentWithTab]),
    basicSetup,
    indentUnit.of("    "),
    rust(),
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
  };
}
