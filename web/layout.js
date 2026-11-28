// Resizable panes: a handle between the file list and the editor sets the
// list's width, and one between the editor and the terminal sets how they
// share the height. Dragging works with a mouse or a finger; a double click
// puts a handle back where it was. The sizes are kept in localStorage's
// "layout", as { files: the list's width in px, editor: the editor's share of
// the height }: there, unlike in IndexedDB, they are saved at once, so that a
// reload right after a drag keeps them, and read at once, before the page
// first shows.

const MIN_FILES = 100; // px, for the file list and for the editor beside it
const MIN_PANE = 60; // px, for the editor and for the terminal

/** Where a handle dragged to `pos` along `size` goes: at least `min` from
 *  either end, or in the middle if `size` is too small for that. */
export function split(pos, size, min) {
  if (size < 2 * min) return size / 2;
  return Math.min(Math.max(pos, min), size - min);
}

function apply(main, { files, editor }) {
  if (files) main.style.setProperty("--files-width", `${files}px`);
  else main.style.removeProperty("--files-width");
  if (editor) main.style.setProperty("--rows", `${editor}fr ${1 - editor}fr`);
  else main.style.removeProperty("--rows");
}

/** Make `filesHandle` and `terminalHandle` resize `main`'s panes; restore the
 *  sizes from, and save them to, `storage` (as localStorage). */
export function initLayout(main, filesHandle, terminalHandle, storage = localStorage) {
  let layout = {};
  try {
    layout = JSON.parse(storage.getItem("layout")) ?? {};
  } catch {
    // None saved, or no storage (a private window): the default layout.
  }
  apply(main, layout);
  const save = (change) => {
    layout = { ...layout, ...change };
    apply(main, layout);
    try {
      storage.setItem("layout", JSON.stringify(layout));
    } catch {
      // Not kept, then.
    }
  };
  const drag = (handle, sizeAt) => {
    handle.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      let change;
      handle.onpointermove = (e) => {
        change = sizeAt(e, main.getBoundingClientRect());
        apply(main, { ...layout, ...change });
      };
      handle.onpointerup = handle.onpointercancel = () => {
        handle.onpointermove = handle.onpointerup = handle.onpointercancel = null;
        if (change) save(change);
      };
    };
  };
  drag(filesHandle, (e, r) => ({ files: Math.round(split(e.clientX - r.left, r.width, MIN_FILES)) }));
  drag(terminalHandle, (e, r) => ({ editor: split(e.clientY - r.top, r.height, MIN_PANE) / r.height }));
  filesHandle.ondblclick = () => save({ files: undefined });
  terminalHandle.ondblclick = () => save({ editor: undefined });
}
