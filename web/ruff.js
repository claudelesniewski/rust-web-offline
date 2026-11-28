// Formatting Python with Ruff (MIT), as Black would, from the Ruff pack
// (web/packs.js), which serves it offline under packs/ruff/.

let workspace = null;

/** `text` (Python) formatted; throws if it doesn't parse. */
export async function formatPython(text) {
  if (!workspace) {
    const at = (name) => new URL(`packs/ruff/${name}`, location.href).href;
    const ruff = await import(at("ruff_wasm.js"));
    await ruff.default({ module_or_path: at("ruff_wasm_bg.wasm") });
    workspace = new ruff.Workspace(ruff.Workspace.defaultSettings(), ruff.PositionEncoding.Utf16);
  }
  return workspace.format(text);
}
