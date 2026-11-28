// Running a project's JavaScript and TypeScript files as ES modules, in
// web/js-worker.js: each file becomes a Blob URL, its imports of other
// files of the project rewritten to theirs; and its errors' stack traces
// name the files again (through a source map, for TypeScript's).

/** The project's file that `spec`, imported from file `from`, names, given
 *  the project's file names (`names`, a Set); or null if it isn't one, as
 *  a package's name. As in TypeScript, `./util.js` may name `util.ts`. */
export function resolveImport(from, spec, names) {
  if (!/^\.\.?\//.test(spec)) return null;
  const parts = from.split("/").slice(0, -1);
  for (const part of spec.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part !== ".") parts.push(part);
  }
  const path = parts.join("/");
  const stem = path.replace(/\.[jt]s$/, "");
  return [path, `${stem}.js`, `${stem}.ts`].find((n) => names.has(n)) ?? null;
}

// The specifier of an import or export from (import x from "./a.js",
// export * from "./a.js", import "./a.js", import("./a.js")).
const SPECIFIER = /(\bimport\s*\(\s*|\bfrom\s*|\bimport\s*)(["'])([^"'\n]+)\2/g;

/** `code` with each import's specifier `spec` replaced by `replace(spec)`,
 *  unless that is null; matched by text, so one in a string or comment that
 *  looks like an import is too (harmlessly: it only changes a string). */
export function rewriteImports(code, replace) {
  return code.replace(SPECIFIER, (all, before, quote, spec) => {
    const to = replace(spec);
    return to === null ? all : `${before}${quote}${to}${quote}`;
  });
}

/** The specifiers `code` imports. */
export const importsOf = (code) => [...code.matchAll(SPECIFIER)].map((m) => m[3]);

/** The project's modules that `main` imports, and they import, those first:
 *  file names, `main` last. `files` maps name -> code. Throws on a cycle,
 *  which Blob URLs can't express. */
export function moduleOrder(files, main) {
  const names = new Set(files.keys());
  const order = [];
  const state = new Map(); // name -> "visiting" | "done"
  const visit = (name, path) => {
    if (state.get(name) === "done") return;
    if (state.get(name) === "visiting") {
      throw new Error(`Circular import: ${[...path.slice(path.indexOf(name)), name].join(" → ")}`);
    }
    state.set(name, "visiting");
    for (const spec of importsOf(files.get(name))) {
      const dep = resolveImport(name, spec, names);
      if (dep) visit(dep, [...path, name]);
    }
    state.set(name, "done");
    order.push(name);
  };
  visit(main, []);
  return order;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** A source map's `mappings` decoded: per generated line, its segments
 *  [column, original line, original column] (from 0), by column. */
export function decodeMappings(mappings) {
  const lines = [];
  let line = 0;
  let col = 0;
  const state = [0, 0, 0, 0]; // source, original line, original column, name
  for (const text of mappings.split(";")) {
    const segments = [];
    col = 0;
    for (const segment of text.split(",")) {
      if (!segment) continue;
      const values = [];
      let value = 0;
      let shift = 0;
      for (const ch of segment) {
        const digit = BASE64.indexOf(ch);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          values.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = shift = 0;
        }
      }
      col += values[0];
      for (let i = 1; i < values.length; i++) state[i - 1] += values[i];
      if (values.length >= 4) segments.push([col, state[1], state[2]]);
    }
    lines[line++] = segments;
  }
  return lines;
}

/** Where `line` and `col` (from 1) of the generated code were in the
 *  source, by `decoded` mappings: { line, col } (from 1), or null. */
export function originalPosition(decoded, line, col) {
  const segments = decoded[line - 1] ?? [];
  let found = null;
  for (const s of segments) if (s[0] <= col - 1) found = s;
  found ??= segments[0];
  return found ? { line: found[1] + 1, col: found[2] + 1 } : null;
}

const BLOB = /blob:\S+?\/[0-9a-f-]{36}:(\d+):(\d+)/g;

/** A stack trace (`stack`, of an error thrown by the modules) with each
 *  module's place (blob:…/<uuid>:line:col) as the project's (main.js:3:5),
 *  by `where(url, line, col)` ({ file, line, col }, or null). The worker's
 *  own frames, between the program's, are left out. */
export function mapStack(stack, where) {
  return stack.split("\n").map((text) => text.replace(BLOB, (all, line, col) => {
    const at = where(all.slice(0, all.length - line.length - col.length - 2), Number(line), Number(col));
    return at ? `${at.file}:${at.line}:${at.col}` : all;
  })).filter((text) => !/^\s+at\s/.test(text) || !/\bjs-worker\.js\b/.test(text)).join("\n");
}

/** The places in the project that `text` names, as stack traces do
 *  (at f (main.js:3:5)), or TypeScript's errors (main.ts:3:5):
 *  [{ index, length, file, line, col }]. */
export function findLocations(text) {
  return [...text.matchAll(/(?<![\w/.])((?:\w+\/)*\w+\.[jt]s):(\d+):(\d+)/g)].map((m) => ({
    index: m.index, length: m[0].length, file: m[1], line: Number(m[2]), col: Number(m[3]),
  }));
}

/** `value` as console.log shows it: a string as it is, unless `nested`
 *  (in an array or object), when it's quoted; others much as Node does. */
export function inspect(value, nested = false, seen = new Set()) {
  if (typeof value === "string") return nested ? JSON.stringify(value) : value;
  if (typeof value === "function") return `[Function: ${value.name || "(anonymous)"}]`;
  if (typeof value === "bigint") return `${value}n`;
  if (value === null || typeof value !== "object") return String(value);
  if (value instanceof Error) return value.stack ?? String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const show = (v) => inspect(v, true, seen);
  try {
    if (Array.isArray(value)) return `[${value.map(show).join(", ")}]`;
    if (value instanceof Map) return `Map(${value.size}) {${[...value].map(([k, v]) => ` ${show(k)} => ${show(v)}`).join(",")} }`;
    if (value instanceof Set) return `Set(${value.size}) {${[...value].map((v) => ` ${show(v)}`).join(",")} }`;
    if (value instanceof Date) return value.toISOString();
    const entries = Object.entries(value).map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${show(v)}`);
    const name = value.constructor && value.constructor !== Object ? `${value.constructor.name} ` : "";
    return entries.length ? `${name}{ ${entries.join(", ")} }` : `${name}{}`;
  } finally {
    seen.delete(value);
  }
}
