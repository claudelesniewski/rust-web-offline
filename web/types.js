// Type-aware completion after `.`: the compiler says what type the
// expression before the dot has, and the offline docs say what methods that
// type has (your own types' methods come from your `impl` blocks).
//
// To learn the type, the code is type-checked with the word after the dot
// replaced by a field that cannot exist; rustc's error names the type:
//   error[E0609]: no field `__rwo_probe` on type `Vec<i32>`
// and, for structs, lists their fields.

const PROBE = "__rwo_probe";

/** The source with the word at [from, to) replaced by the probe, and a `;`
 *  after it if nothing follows on its line, so the statement parses. */
export function probeSource(doc, from, to) {
  const eol = doc.indexOf("\n", to) === -1 ? doc.length : doc.indexOf("\n", to);
  const rest = doc.slice(to, eol);
  return doc.slice(0, from) + PROBE + (rest.trim() ? rest : ";") + doc.slice(eol);
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

/** The stable methods on a rustdoc page, without the noise: [{ name, sig,
 *  doc }], in page order. */
export function methodsFromHtml(html) {
  const re = /<section id="(?:ty)?method\.(\w+)(?:-\d+)?"[^>]*>[\s\S]*?<h4 class="code-header">([\s\S]*?)<\/h4><\/section>(?:<\/summary>)?(<span class="item-info"><div class="stab unstable">)?(?:[\s\S]{0,400}?<div class=["']docblock["']>(?:<p>)?([\s\S]*?)(?:<\/p>|<\/div>))?/g;
  const methods = new Map();
  for (const [, name, sig, unstable, doc] of html.matchAll(re)) {
    const plain = decode(sig).replace(/\s+/g, " ").replace(/^pub(?:\([^)]*\))? /, "");
    if (unstable || methods.has(name) || NOISE.test(name) || !TAKES_SELF.test(plain)) continue;
    methods.set(name, { name, sig: plain, doc: doc ? decode(doc).replace(/ Read more$/, "") : "" });
  }
  return [...methods.values()];
}

/** Methods defined for type `name` in `impl` blocks of `sources`:
 *  [{ name, sig }]. Reads braces, not Rust: good enough for completion. */
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
        if (!methods.has(f[1])) methods.set(f[1], { name: f[1], sig: `fn ${f[1]}${f[2].trim()}` });
      }
    }
  }
  return [...methods.values()];
}

/** Completion options for the word at [from, to) after a dot, or null
 *  if the type cannot be found. `check(source)` type-checks the program with
 *  that source for the open file and returns rustc's output; `fetchText`
 *  reads a file of the site (the docs). `sources` are all the files' texts. */
export function createTypeCompletion({ check, fetchText }) {
  let index = null;
  const pages = new Map();
  let last = { key: null, result: null };

  async function methodsOf(name, sources) {
    const short = name.split("::").pop();
    if (sources.some((s) => new RegExp(`\\b(?:struct|enum|trait|union)\\s+${short}\\b`).test(s))) {
      return userMethods(sources, short);
    }
    index ??= JSON.parse(await fetchText("docs/types.json"));
    const page = index[name] ?? index[short];
    if (!page) return [];
    if (!pages.has(page)) pages.set(page, methodsFromHtml(await fetchText(`docs/${page}`)));
    return pages.get(page);
  }

  return function complete(doc, from, to, sources) {
    const source = probeSource(doc, from, to);
    // Typing more of the word asks again, with the same probe.
    if (last.key !== source) {
      last = {
        key: source,
        result: (async () => {
          const found = parseProbe(await check(source));
          if (!found) return null;
          const name = typeName(found.type);
          const methods = name ? await methodsOf(name, sources) : [];
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
