// Type-aware completion after `.`: the compiler says what type the
// expression before the dot has, and the offline docs say what methods that
// type has (your own types' methods come from your `impl` blocks).
//
// To learn the type, the code is type-checked with the word after the dot
// replaced by a field that cannot exist; rustc's error names the type:
//   error[E0609]: no field `__rwo_probe` on type `Vec<i32>`
// and, for structs, lists their fields.

const PROBE = "__rwo_probe";

/** The source with the word at [from, to) replaced by the probe, ending
 *  the statement if nothing follows on its line, so that it parses: closing
 *  the brackets left open on the line (as in `println!("{}", x.`), then with
 *  ` {}` after `if`, `while`, `for` or `match`, else with `;`. */
export function probeSource(doc, from, to) {
  const eol = doc.indexOf("\n", to) === -1 ? doc.length : doc.indexOf("\n", to);
  const rest = doc.slice(to, eol);
  const line = doc.slice(doc.lastIndexOf("\n", from - 1) + 1, from);
  const end = /^\s*(?:\}\s*else\s+)?(?:if|while|for|match)\b/.test(line) ? " {}" : ";";
  return doc.slice(0, from) + PROBE + (rest.trim() ? rest : closers(line) + end) + doc.slice(eol);
}

/** The brackets that close those `line` leaves open, outside strings. */
function closers(line) {
  const open = [];
  const pairs = { "(": ")", "[": "]", "{": "}" };
  for (let i = 0, quoted = false; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") i++;
    else if (c === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (pairs[c]) open.push(pairs[c]);
    else if (c === open.at(-1)) open.pop();
  }
  return open.reverse().join("");
}

/** From rustc's output for a probe: { type, fields }, or null. */
export function parseProbe(output) {
  const m = output.match(new RegExp(`no field \`${PROBE}\` on type \`(.+?)\``))
    ?? output.match(/`(.+?)` is a primitive type and therefore doesn't have fields/);
  if (!m) return null;
  const list = output.match(/available fields? (?:are|is): ((?:`\w+`(?:, |,? and )?)+)/);
  const fields = list ? [...list[1].matchAll(/`(\w+)`/g)].map((f) => f[1]) : [];
  return { type: m[1], fields };
}

/** The name to look a type up by: `&mut Vec<i32>` → `Vec`,
 *  `std::slice::Iter<'_, i32>` → `std::slice::Iter`, `[i32; 3]` → `array`. */
export function typeName(type) {
  let t = type.trim();
  for (let m; (m = t.match(/^(?:&(?:'\w+ )?(?:mut )?|\*(?:const|mut) )/)); ) t = t.slice(m[0].length);
  if (t.startsWith("[")) return t.includes(";") ? "array" : "slice";
  if (t.startsWith("(")) return t === "()" ? "unit" : "tuple";
  if (t === "{integer}") return "i32";
  if (t === "{float}") return "f64";
  return t.match(/^(?:impl |dyn )?([\w:]+)/)?.[1] ?? null;
}

const decode = (html) => html.replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

/** Methods every type has, or operators' methods: noise in a list. */
const NOISE = /^(?:(?:add|sub|mul|div|rem|shl|shr|bitand|bitor|bitxor)(?:_assign)?|neg|not|borrow|borrow_mut|clone_into|clone_to_uninit|type_id|into|try_into|eq|ne|lt|le|gt|ge|index|index_mut|deref|deref_mut|drop|fmt|hash)$/;
/** A method, called with a dot: it takes `self`. */
const TAKES_SELF = /\(\s*(?:&(?:'\w+\s+)?(?:mut\s+)?)?(?:mut\s+)?self\b/;

/** The stable functions on a rustdoc page, without the noise: [{ name, sig,
 *  doc, takesSelf }], in page order; those that take `self` are methods,
 *  called with a dot, and the others associated functions, with `::`. */
export function methodsFromHtml(html) {
  const re = /<section id="(?:ty)?method\.(\w+)(?:-\d+)?"[^>]*>[\s\S]*?<h4 class="code-header">([\s\S]*?)<\/h4><\/section>(?:<\/summary>)?(<span class="item-info"><div class="stab unstable">)?(?:[\s\S]{0,400}?<div class=["']docblock["']>(?:<p>)?([\s\S]*?)(?:<\/p>|<\/div>))?/g;
  const methods = new Map();
  for (const [, name, sig, unstable, doc] of html.matchAll(re)) {
    const plain = decode(sig).replace(/\s+/g, " ").replace(/^pub(?:\([^)]*\))? /, "");
    if (unstable || methods.has(name) || NOISE.test(name)) continue;
    methods.set(name, { name, sig: plain, doc: doc ? decode(doc).replace(/ Read more$/, "") : "", takesSelf: TAKES_SELF.test(plain) });
  }
  return [...methods.values()];
}

/** Functions defined for type `name` in `impl` blocks of `sources`:
 *  [{ name, sig, takesSelf }]. Reads braces, not Rust: good enough for
 *  completion. */
export function userMethods(sources, name) {
  const methods = new Map();
  for (const src of sources) {
    const header = /\bimpl\b(?:<[^{]*?>)?\s+(?:[\w:<>, ]+?\s+for\s+)?(\w+)\b[^{;]*\{/g;
    for (let m; (m = header.exec(src)); ) {
      if (m[1] !== name) continue;
      let depth = 1;
      let i = header.lastIndex;
      while (i < src.length && depth) depth += src[i] === "{" ? 1 : src[i] === "}" ? -1 : 0, i++;
      for (const f of src.slice(header.lastIndex, i).matchAll(/\bfn\s+(\w+)\s*(?:<[^>]*>)?\s*(\([^)]*\)(?:\s*->\s*[^{;]+)?)/g)) {
        if (!methods.has(f[1])) methods.set(f[1], { name: f[1], sig: `fn ${f[1]}${f[2].trim()}`, takesSelf: TAKES_SELF.test(f[2]) });
      }
    }
  }
  return [...methods.values()];
}

/** The variants of enum `name` in `sources`. */
export function variants(sources, name) {
  for (const src of sources) {
    const m = new RegExp(`\\benum\\s+${name}\\b[^{;]*\\{`).exec(src);
    if (!m) continue;
    const found = [];
    let depth = 1;
    for (let i = m.index + m[0].length; i < src.length && depth; i++) {
      if ("{([".includes(src[i])) depth++;
      else if ("})]".includes(src[i])) depth--;
      else if (depth === 1 && /[A-Za-z_]/.test(src[i]) && !/[\w]/.test(src[i - 1])) {
        const word = /^\w+/.exec(src.slice(i))[0];
        // A variant starts its item: after `{` or `,`, maybe past attributes.
        if (/(^|[{,])\s*(#\[[^\]]*\]\s*)*$/.test(src.slice(m.index + m[0].length - 1, i))) found.push(word);
        i += word.length - 1;
      }
    }
    return found;
  }
  return [];
}

/** The items a project's module `file` makes public: [{ label, type }]. */
export function publicItems(file) {
  const kinds = { fn: "function", struct: "type", enum: "type", trait: "type", type: "type", const: "constant", static: "constant", mod: "namespace" };
  return [...file.matchAll(/\bpub(?:\([^)]*\))?\s+(?:(?:async|unsafe)\s+)*(fn|struct|enum|trait|type|const|static|mod)\s+(\w+)/g)]
    .map(([, kind, label]) => ({ label, type: kinds[kind] }));
}

/** Whether rustc's output has an error (not a warning) on line `line`
 *  (from 1) of `file`. */
export function errorOnLine(output, file, line, { coded = false } = {}) {
  const at = `src/${file}:${line}:`;
  const re = coded ? /^error\[E\d+\].*\n\s*--> (\S+)/gm : /^error\b.*\n\s*--> (\S+)/gm;
  return [...output.matchAll(re)].some((m) => m[1].startsWith(at));
}

/** Completion options for the word at [from, to) after a dot or `::` in
 *  file `main`: [] if what is before the dot has no type (it doesn't exist,
 *  say), or null if the type cannot be found for another reason (or after
 *  `::`, if what the path names isn't known). `check(source)` type-checks
 *  the program with that source for the open file and returns rustc's
 *  output; `fetchText` reads a file of the site (the docs). `files` are the
 *  project's ([{ name, content }]). */
export function createTypeCompletion({ check, fetchText }) {
  let index = null;
  const pages = new Map();
  let last = { key: null, result: null };

  /** The functions of type `name`, in the project or the docs; null if
   *  neither has it. */
  async function functionsOf(name, sources) {
    const short = name.split("::").pop();
    if (sources.some((s) => new RegExp(`\\b(?:struct|enum|trait|union)\\s+${short}\\b`).test(s))) {
      return userMethods(sources, short);
    }
    index ??= JSON.parse(await fetchText("docs/types.json"));
    const page = Object.hasOwn(index, name) ? index[name] : Object.hasOwn(index, short) ? index[short] : null;
    if (!page) return null;
    if (!pages.has(page)) pages.set(page, methodsFromHtml(await fetchText(`docs/${page}`)));
    return pages.get(page);
  }

  /** What follows `path::` (as `geometry`, `std::vec::Vec`): a project
   *  module's public items; a type's associated functions, and an enum's
   *  variants; null if not known (as a std module). */
  async function pathItems(path, files) {
    const sources = files.map((f) => f.content);
    const name = path.split("::").pop();
    const module = files.find((f) => f.name === `${name}.rs` || f.name.endsWith(`/${name}.rs`) || f.name.endsWith(`${name}/mod.rs`));
    if (module) return publicItems(module.content);
    const functions = /^[A-Z]/.test(name) ? await functionsOf(path, sources) : null;
    if (!functions) return null;
    return [
      ...variants(sources, name).map((v) => ({ label: v, type: "enum", detail: name })),
      ...functions.filter((f) => !f.takesSelf).map((f) => ({
        label: f.name, type: "function", info: f.doc || undefined, detail: f.sig.slice(f.sig.indexOf("(")),
      })),
    ];
  }

  return function complete(doc, from, to, files, main) {
    const sources = files.map((f) => f.content);
    const path = /((?:\w+::)*\w+)::$/.exec(doc.slice(Math.max(0, from - 200), from));
    if (path) return pathItems(path[1], files).catch(() => null);
    const source = probeSource(doc, from, to);
    // Typing more of the word asks again, with the same probe.
    if (last.key !== source) {
      last = {
        key: source,
        result: (async () => {
          const output = await check(source);
          const found = parseProbe(output);
          // Nothing there: rustc can't find the name (a coded error, as
          // E0425), not that the line didn't parse.
          if (!found) return errorOnLine(output, main, doc.slice(0, from).split("\n").length, { coded: true }) ? [] : null;
          const name = typeName(found.type);
          const methods = name ? ((await functionsOf(name, sources)) ?? []).filter((m) => m.takesSelf) : [];
          return [
            ...found.fields.map((f) => ({ label: f, type: "property", detail: found.type })),
            ...methods.map((m) => ({
              label: m.name, type: "method", info: m.doc || undefined,
              // Just the parameters and result: fn push(&mut self, …) → (&mut self, …)
              detail: m.sig.slice(m.sig.indexOf("(")),
            })),
          ];
        })().catch(() => null),
      };
    }
    return last.result;
  };
}
