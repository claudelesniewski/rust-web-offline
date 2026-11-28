// AI suggestions, helped by the toolchain:
// - Right after a dot, the model may only write a member (method or field)
//   that is really there: type-aware completion finds them (Rust's compiler,
//   Python's jedi), and a grammar (llama.cpp's GBNF) holds the model to them.
// - The suggestion is checked in place, and not shown if the toolchain finds
//   an error on its line (rustc's, or for Python, a syntax error or a name
//   bound nowhere), unless the fixes rustc suggests mend it (`&mut input`
//   for `input`), or, after a dot, the next member the model picks does.
//   (Sampling others when it fails was tried, for Rust: it found one more
//   right line in 18, and made suggestions 40% slower.)

/** A GBNF grammar for the rest of a line that starts with one of `members`,
 *  of which `typed` is already written. Null if none fits. */
export function memberGrammar(members, typed) {
  const rests = [...new Set(members.filter((m) => m.startsWith(typed)).map((m) => m.slice(typed.length)))];
  if (!rests.length) return null;
  // A member exactly as typed: nothing more of the name to write.
  const names = rests.map((r) => (r ? JSON.stringify(r) : '""'));
  // After the name, not more of a name: `len` must not become `length`.
  return `root ::= (${names.join(" | ")}) ([^a-zA-Z0-9_\\n] [^\\n]*)? "\\n"`;
}

/** `text` without a comment at its end (one outside string literals): a
 *  comment starts with `comment`, and a string with one of `quotes`. */
export function withoutComment(text, { comment = "//", quotes = '"' } = {}) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (quote ? text[i] === quote : quotes.includes(text[i])) quote = quote ? null : text[i];
    else if (!quote && text.startsWith(comment, i)) return text.slice(0, i).trimEnd();
  }
  return text;
}

/** `source` with a body (`pass`) after `line` (from 1) if it opens a block,
 *  as a Python suggestion may: so that Python can check the line alone. */
export function withBlockBody(source, line) {
  const lines = source.split("\n");
  const text = lines[line - 1] ?? "";
  if (/:\s*$/.test(text)) lines.splice(line, 0, `${/^\s*/.exec(text)[0]}    pass`);
  return lines.join("\n");
}

/**
 * `complete(prefix, signal, { grammar, repo, file, others })`: the model's
 * rest of the line, in file `main()`, with the project's other files
 * `others()` ([{ name, content }]) for context, in a repository: `ai` (a
 * language's, from web/languages.js) says how it is laid out.
 * `members(doc, from, to)`: completion options after a dot ([] if nothing
 * is there, null if unknown), or null to not constrain.
 * `check(source, line)`: null if the toolchain finds no error on `line`
 * (from 1) of the program with `source` as file `main()`, else { fixed }:
 * that line with the fixes the toolchain suggests, or null; or `check` is
 * null to not check. A fixed line is checked again, up to `fixes` times.
 * After a dot, a suggestion that fails the check is tried again without
 * its member, up to `retries` times. Returns `suggest(doc, pos, signal)`.
 */
export function createSuggester({ complete, ai, members = null, check = null, main = () => "main.rs", others = () => [],
  fixes = 2, retries = 1 }) {
  const cut = (text) => withoutComment(text, ai);
  return async function suggest(doc, pos, signal) {
    const prefix = doc.slice(0, pos);
    const suffix = doc.slice(pos);
    const dot = members && prefix.match(/\.(\w*)$/);
    let options = null;
    if (dot) {
      options = (await members(doc, pos - dot[1].length, pos))?.map((o) => o.label) ?? null;
      if (options && !options.length) return ""; // nothing there to call
    }
    // In code, a comment at the end is chatter; one alone always compiles,
    // and is no use as a suggestion. (In a comment, all is comment.)
    const line = prefix.slice(prefix.lastIndexOf("\n") + 1);
    const rest = suffix.slice(0, (suffix + "\n").indexOf("\n"));
    const lineNo = prefix.split("\n").length;
    /** `text`, or as the toolchain fixes it; "" if it fails the check. */
    const checked = async (text) => {
      for (let i = 0; ; i++) {
        const problem = await check(prefix + text + suffix, lineNo);
        if (!problem) return text;
        const { fixed } = problem;
        // A fix may only change what the suggestion wrote.
        if (i >= fixes || !fixed?.startsWith(line) || !fixed.endsWith(rest) || fixed.length < line.length + rest.length) return "";
        text = fixed.slice(line.length, fixed.length - rest.length);
      }
    };
    for (let attempt = 0; attempt <= retries; attempt++) {
      const grammar = options && memberGrammar(options, dot[1]);
      if (options && !grammar) return ""; // no member left to try
      const raw = await complete(prefix, signal, {
        grammar,
        repo: ai.repo,
        file: ai.path(main()),
        others: others().map((o) => ({ ...o, name: ai.path(o.name) })),
      });
      const text = cut(line) !== line ? raw : cut(raw);
      if (!text.trim() || signal?.aborted) return "";
      if (!check) return text;
      const good = await checked(text);
      if (good.trim() || !options) return good;
      options = options.filter((o) => o !== dot[1] + /^\w*/.exec(text)[0]);
    }
    return "";
  };
}
