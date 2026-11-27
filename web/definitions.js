// Go to definition: where a name is defined, found by matching text (no
// parsing), so it is a good guess rather than the compiler's answer.

const ITEM = String.raw`\b(?:fn|struct|enum|union|trait|type|const|static|mod|macro_rules!)\s+`;

/** Where `word` is defined, given the project's `files` ({ name: content })
 *  and the cursor at offset `pos` in file `current`: { file, line, col }
 *  (from 1), or null. An item (fn, struct, …) in the current file comes
 *  first, then the nearest `let` above the cursor, then an item in another
 *  file. `mod name;` leads to the module's file, name.rs or name/mod.rs. */
export function findDefinition(files, current, word, pos) {
  if (!/^[A-Za-z_]\w*$/.test(word)) return null;
  const item = new RegExp(`${ITEM}(${word})\\b(\\s*;)?`, "g");
  const inFile = (file) => {
    const m = item.exec(files[file]);
    item.lastIndex = 0;
    if (!m) return null;
    if (m[2]) {
      const dir = moduleDir(file);
      const target = [`${dir}${word}.rs`, `${dir}${word}/mod.rs`].find((f) => f in files);
      if (target) return { file: target, line: 1, col: 1 };
    }
    return at(file, m.index + m[0].length - (m[2]?.length ?? 0) - word.length);
  };
  const local = () => {
    const before = (files[current] ?? "").slice(0, pos);
    const lets = [...before.matchAll(new RegExp(`\\blet\\s+(?:mut\\s+)?(${word})\\b`, "g"))];
    const m = lets.at(-1);
    return m ? at(current, m.index + m[0].length - word.length) : null;
  };
  const others = Object.keys(files).filter((f) => f !== current && f.endsWith(".rs")).sort();
  return (current in files ? inFile(current) : null) ?? local() ?? others.reduce((found, f) => found ?? inFile(f), null);

  function at(file, offset) {
    const lines = files[file].slice(0, offset).split("\n");
    return { file, line: lines.length, col: lines.at(-1).length + 1 };
  }
}

/** The folder where the modules that `file` declares live: next to main.rs,
 *  lib.rs and mod.rs, else in a folder named after the file. */
function moduleDir(file) {
  const slash = file.lastIndexOf("/") + 1;
  const base = file.slice(slash);
  return ["main.rs", "lib.rs", "mod.rs"].includes(base) ? file.slice(0, slash) : `${file.slice(0, -3)}/`;
}
