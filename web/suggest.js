// AI suggestions, helped by the toolchain:
// - Right after a dot, the model may only write a member (method or field)
//   the type there really has: type-aware completion finds them, and a
//   grammar (llama.cpp's GBNF) holds the model to them.
// - The suggestion is type-checked in place, and not shown if rustc finds
//   an error on its line. (Sampling others when it does was tried: it found
//   one more right line in 18, and made suggestions 40% slower.)

import { errorOnLine } from "./types.js";

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

/** `text` without a comment at its end (one outside string literals). */
export function withoutComment(text) {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') quoted = !quoted;
    else if (!quoted && text.startsWith("//", i)) return text.slice(0, i).trimEnd();
  }
  return text;
}

/**
 * `complete(prefix, signal, { grammar, file, others })`: the model's rest
 * of the line, in file `main()`, with the project's other files `others()`
 * ([{ name, content }]) for context.
 * `members(doc, from, to)`: completion options after a dot ([] if nothing
 * is there, null if unknown), or null to not constrain.
 * `check(source)`: rustc's output for the program with `source` as file
 * `main()`, or null to not check. Returns `suggest(doc, pos, signal)`.
 */
export function createSuggester({ complete, members = null, check = null, main = () => "main.rs", others = () => [] }) {
  return async function suggest(doc, pos, signal) {
    const prefix = doc.slice(0, pos);
    const suffix = doc.slice(pos);
    let grammar = null;
    const dot = members && prefix.match(/\.(\w*)$/);
    if (dot) {
      const options = await members(doc, pos - dot[1].length, pos);
      if (options && !options.length) return ""; // nothing there to call
      if (options) grammar = memberGrammar(options.map((o) => o.label), dot[1]);
    }
    // In code, a comment at the end is chatter; one alone always compiles,
    // and is no use as a suggestion. (In a comment, all is comment.)
    const line = prefix.slice(prefix.lastIndexOf("\n") + 1);
    const raw = await complete(prefix, signal, { grammar, file: main(), others: others() });
    const text = withoutComment(line) !== line ? raw : withoutComment(raw);
    if (!text.trim() || signal?.aborted) return "";
    if (check && errorOnLine(await check(prefix + text + suffix), main(), prefix.split("\n").length)) return "";
    return text;
  };
}
