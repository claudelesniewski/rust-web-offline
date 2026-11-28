// Formatting and linting Python with Ruff (MIT), as Black and Flake8 would,
// from the Ruff pack (web/packs.js), which serves it offline under
// packs/ruff/.

let workspace = null;

async function ruff() {
  if (!workspace) {
    const at = (name) => new URL(`packs/ruff/${name}`, location.href).href;
    const ruff = await import(at("ruff_wasm.js"));
    await ruff.default({ module_or_path: at("ruff_wasm_bg.wasm") });
    workspace = new ruff.Workspace(ruff.Workspace.defaultSettings(), ruff.PositionEncoding.Utf16);
  }
  return workspace;
}

/** `text` (Python) formatted; throws if it doesn't parse. */
export async function formatPython(text) {
  return (await ruff()).format(text);
}

/** Ruff's findings in `text` (Python), as the editor's diagnostics. */
export async function lintPython(text) {
  return toDiagnostics((await ruff()).check(text));
}

/** Ruff's diagnostics (rows and UTF-16 columns from 1) as the editor's: a
 *  rule's (a code like F821) a warning, else (invalid-syntax) an error.
 *  One that spans lines underlines the rest of its first. */
export function toDiagnostics(list) {
  return list.map(({ code, message, start_location: start, end_location: end }) => {
    const rule = /^[A-Z]+\d+$/.test(code ?? "");
    return {
      line: start.row,
      col: start.column,
      width: end.row === start.row ? end.column - start.column : Infinity,
      severity: rule ? "warning" : "error",
      message: rule ? `${code} ${message}` : message,
    };
  });
}
