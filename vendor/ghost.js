// Inline suggestions ("ghost text"): after a pause in typing at the end of a
// line, ask `suggest(doc, pos, signal)` for the rest of the line and show it
// greyed out after the cursor. Tab or Shift-Tab takes it (see editor.js);
// typing, moving or Escape drops it.
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";

const DELAY = 350;
const setGhost = StateEffect.define();

class GhostWidget extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }
  eq(other) { return other.text === this.text; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ghost";
    span.textContent = this.text;
    return span;
  }
}

const ghostField = StateField.define({
  create: () => null,
  update(ghost, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value;
    return tr.docChanged || tr.selection ? null : ghost;
  },
  provide: (field) => EditorView.decorations.from(field, (g) => (g
    ? Decoration.set([Decoration.widget({ widget: new GhostWidget(g.text), side: 1 }).range(g.pos)])
    : Decoration.none)),
});

/** Insert the suggestion shown, if any. */
export function acceptGhost(view) {
  const ghost = view.state.field(ghostField, false);
  if (!ghost) return false;
  const end = ghost.pos + ghost.text.length;
  view.dispatch({ changes: { from: ghost.pos, insert: ghost.text }, selection: { anchor: end } });
  return true;
}

/** Drop the suggestion shown, if any. */
export function dropGhost(view) {
  if (!view.state.field(ghostField, false)) return false;
  view.dispatch({ effects: setGhost.of(null) });
  return true;
}

/** The extension; `getSuggest()` returns the current `suggest`, or null
 *  when suggestions are off. */
export function ghostText(getSuggest) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.timer = 0;
      this.abort = null;
    }

    update(u) {
      if (!u.docChanged && !u.selectionSet) return;
      this.cancel();
      const suggest = getSuggest();
      const { head, empty } = u.state.selection.main;
      // Only at the end of a line, after typing.
      if (!suggest || !u.docChanged || !empty || u.state.doc.lineAt(head).to !== head) return;
      this.timer = setTimeout(() => this.ask(suggest, head), DELAY);
    }

    async ask(suggest, head) {
      const abort = (this.abort = new AbortController());
      const doc = this.view.state.doc;
      let text;
      try {
        text = await suggest(doc.toString(), head, abort.signal);
      } catch {
        return; // stopped, or the model failed: no suggestion
      }
      if (abort.signal.aborted || this.view.state.doc !== doc || !text.trim()) return;
      this.view.dispatch({ effects: setGhost.of({ pos: head, text }) });
    }

    cancel() {
      clearTimeout(this.timer);
      this.abort?.abort();
      this.abort = null;
    }

    destroy() { this.cancel(); }
  });
  return [ghostField, plugin, EditorView.theme({ ".cm-ghost": { opacity: "0.45", fontStyle: "italic" } })];
}
