// Find and replace a plain string in all of a project's files.

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = (query, caseSensitive) => new RegExp(escape(query), caseSensitive ? "g" : "gi");

/** Every place `query` is in `files` (name -> content), by file name then
 *  place: { file, line, col (both from 1), text (the line), length }. */
export function find(files, query, { caseSensitive = false } = {}) {
  if (!query) return [];
  const re = pattern(query, caseSensitive);
  const matches = [];
  for (const file of [...files.keys()].sort()) {
    files.get(file).split("\n").forEach((text, i) => {
      for (const m of text.matchAll(re)) matches.push({ file, line: i + 1, col: m.index + 1, text, length: m[0].length });
    });
  }
  return matches;
}

/** The files that `query` is in, with each place replaced by `replacement`:
 *  a Map name -> new content. */
export function replaceAll(files, query, replacement, { caseSensitive = false } = {}) {
  const changed = new Map();
  if (!query) return changed;
  const re = pattern(query, caseSensitive);
  for (const [file, content] of files) {
    const next = content.replace(re, () => replacement);
    if (next !== content) changed.set(file, next);
  }
  return changed;
}
