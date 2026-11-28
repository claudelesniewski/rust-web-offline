// Go to definition in JavaScript and TypeScript, as web/definitions.js does
// for Rust: found by matching text, so a good guess rather than an answer.
import { resolveImport } from "./js-modules.js";

/** Where `word` is defined, given the project's `files` ({ name: content })
 *  and the cursor at offset `pos` in file `current`: { file, line, col }
 *  (from 1), or null. The nearest declaration above the cursor comes first
 *  (function, class, const, let, var, or in TypeScript, an interface, type
 *  or enum), then any in the file; a name it imports leads to where the
 *  imported file declares it; then any other file's declaration. */
export function findDefinition(files, current, word, pos) {
  if (!/^[A-Za-z_$][\w$]*$/.test(word)) return null;
  const name = word.replace(/\$/g, "\\$");
  const declaration = new RegExp(String.raw`\b(?:function\*?|class|const|let|var|interface|type|enum)\s+(${name})(?![\w$])`, "gd");
  const at = (file, offset) => {
    const lines = files[file].slice(0, offset).split("\n");
    return { file, line: lines.length, col: lines.at(-1).length + 1 };
  };
  /** The declarations of `word` in `file`: offsets. */
  const declared = (file) => [...(files[file] ?? "").matchAll(declaration)].map((m) => m.indices[1][0]);
  /** Where the file `current` imports `word` from declares it. */
  const imported = () => {
    const names = new Set(Object.keys(files));
    for (const m of (files[current] ?? "").matchAll(/\bimport\s+([^;]*?)\s+from\s*["']([^"']+)["']/g)) {
      const found = new RegExp(String.raw`(?:^|[{,\s])${name}(?![\w$])`).test(m[1]);
      const file = found && resolveImport(current, m[2], names);
      if (!file) continue;
      const offset = declared(file)[0];
      return offset === undefined ? { file, line: 1, col: 1 } : at(file, offset);
    }
    return null;
  };
  const here = declared(current);
  const before = here.filter((o) => o < pos).at(-1) ?? here[0];
  if (before !== undefined) return at(current, before);
  const others = Object.keys(files).filter((f) => f !== current && /\.[jt]s$/.test(f)).sort();
  return imported() ?? others.reduce((found, f) => found ?? (declared(f).length ? at(f, declared(f)[0]) : null), null);
}
