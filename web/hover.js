// Hover docs: what the word under the pointer is, and its docs' summary.
// In Rust, from the offline docs: a type or trait by its name (Vec, i32),
// and after a dot a member, from type-aware completion (web/types.js). In
// Python, from jedi, in the Python worker.

const decode = (html) => html.replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

/** The summary of a rustdoc page: its description's first paragraph. */
export function topDoc(html) {
  const m = /class="toggle top-doc"[\s\S]*?<div class="docblock"><p>([\s\S]*?)<\/p>/.exec(html);
  return m ? decode(m[1]).replace(/\s+/g, " ").trim() : "";
}

/** Rust's hover: `members(doc, from, to)` is type-aware completion's (the
 *  options after the dot before `from`), `fetchText(path)` reads a file of
 *  the site. Returns `hover(doc, from, to)`, for the word at [from, to):
 *  { title, body, link? }, or null. */
export function createRustHover({ members, fetchText }) {
  let index = null;
  return async function hover(doc, from, to) {
    const word = doc.slice(from, to);
    if (doc[from - 1] === ".") {
      // Asked as completion at the end of the line would be (a call after
      // the word would make the probe a method's, which rustc doesn't name
      // the type for).
      const eol = doc.indexOf("\n", to) === -1 ? doc.length : doc.indexOf("\n", to);
      const member = (await members(doc.slice(0, from) + doc.slice(eol), from, from))?.find((o) => o.label === word);
      return member ? { title: `${word}${member.detail ?? ""}`, body: member.info ?? "" } : null;
    }
    index ??= JSON.parse(await fetchText("docs/types.json"));
    const page = Object.hasOwn(index, word) ? index[word] : null;
    if (!page) return null;
    const [, path, kind, name] = /^(.*)\/(\w+)\.(\w+)\.html$/.exec(page);
    return {
      title: kind === "primitive" ? `primitive ${name}` : `${kind} ${path.replaceAll("/", "::")}::${name}`,
      body: topDoc(await fetchText(`docs/${page}`)),
      link: `docs/${page}`,
    };
  };
}
