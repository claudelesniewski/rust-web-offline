// Go to definition in Python, as web/definitions.js does for Rust: found by
// matching text, so a good guess rather than an interpreter's answer.

/** Where `word` is defined, given the project's `files` ({ name: content })
 *  and the cursor at offset `pos` in file `current`: { file, line, col }
 *  (from 1), or null. A def or class in the current file comes first, then
 *  the nearest binding above the cursor (an assignment, a for or with
 *  target, an import), then a def or class in another file. An imported
 *  name leads to where its module defines it, or to the module's file. */
export function findDefinition(files, current, word, pos) {
  if (!/^[A-Za-z_]\w*$/.test(word)) return null;
  const at = (file, offset) => {
    const lines = files[file].slice(0, offset).split("\n");
    return { file, line: lines.length, col: lines.at(-1).length + 1 };
  };
  /** A def or class of `name` in `file`. */
  const defined = (file, name) => {
    const m = new RegExp(String.raw`^[ \t]*(?:async[ \t]+)?(?:def|class)[ \t]+${name}\b`, "m").exec(files[file] ?? "");
    return m ? at(file, m.index + m[0].length - name.length) : null;
  };
  /** The file of module `name` (as in `import a.b`, or `.b` beside `file`). */
  const moduleFile = (name, file) => {
    const dots = /^\.*/.exec(name)[0].length;
    let dir = "";
    if (dots) dir = file.split("/").slice(0, -dots).join("/");
    const path = [dir, ...name.slice(dots).split(".").filter(Boolean)].filter(Boolean).join("/");
    return [`${path}.py`, `${path}/__init__.py`].find((f) => f in files);
  };
  /** Where `name`, imported from `module` in `file`, is defined. */
  const imported = (module, name, file) => {
    const from = moduleFile(module, file);
    const sub = moduleFile(`${module}${module.endsWith(".") ? "" : "."}${name}`, file);
    return (from && (defined(from, name) ?? assigned(from, name, Infinity))) ?? (sub ? { file: sub, line: 1, col: 1 } : null);
  };
  /** The nearest binding of `name` in `file` before offset `end`. */
  function assigned(file, name, end) {
    const text = (files[file] ?? "").slice(0, end);
    const binds = [
      String.raw`^[ \t]*(${name})[ \t]*(?::[^=\n]*)?=(?!=)`, // name = …, name: T = …
      String.raw`\bfor[ \t]+(?:[\w, \t]*,[ \t]*)?(${name})\b[\w, \t]*[ \t]in\b`,
      String.raw`\b(?:with|except)\b[^\n]*\bas[ \t]+(${name})\b`,
    ];
    const offsets = binds.flatMap((re) => [...text.matchAll(new RegExp(re, "gmd"))].map((m) => m.indices[1][0]));
    return offsets.length ? at(file, Math.max(...offsets)) : null;
  }
  /** Where an import in `file` before `end` that binds `name` leads. */
  const viaImport = (file, end) => {
    const text = (files[file] ?? "").slice(0, end);
    let found = null;
    for (const m of text.matchAll(/^[ \t]*import[ \t]+(.+)$/gm)) {
      for (const part of m[1].split(",")) {
        const [, module, alias] = /^\s*([\w.]+)(?:\s+as\s+(\w+))?/.exec(part) ?? [];
        if (module && (alias ?? module.split(".")[0]) === word) {
          const f = moduleFile(alias ? module : word, file);
          if (f) found = { file: f, line: 1, col: 1 };
        }
      }
    }
    for (const m of text.matchAll(/^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+\(?([^)\n]+)/gm)) {
      for (const part of m[2].split(",")) {
        const [, name, alias] = /^\s*(\w+)(?:\s+as\s+(\w+))?/.exec(part) ?? [];
        if (name && (alias ?? name) === word) found = imported(m[1], name, file) ?? found;
      }
    }
    return found;
  };
  const others = Object.keys(files).filter((f) => f !== current && f.endsWith(".py")).sort();
  return defined(current, word) ?? assigned(current, word, pos) ?? viaImport(current, pos)
    ?? others.reduce((found, f) => found ?? defined(f, word), null);
}
