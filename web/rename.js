// Rename a symbol: every whole-word use of a name in the code, but not in
// strings or comments. Found by scanning the text (no parsing), so a local
// variable is renamed everywhere its name is used, like any other name.

const KEYWORDS = {
  rust: new Set(("as async await break const continue crate dyn else enum extern false fn for gen if impl in let " +
    "loop match mod move mut pub ref return self Self static struct super trait true try type unsafe use where " +
    "while abstract become box do final macro override priv typeof unsized virtual yield _").split(" ")),
  python: new Set(("False None True and as assert async await break class continue def del elif else except " +
    "finally for from global if import in is lambda nonlocal not or pass raise return try while with yield").split(" ")),
  javascript: new Set(("await break case catch class const continue debugger default delete do else enum export " +
    "extends false finally for function if import in instanceof let new null return super switch this throw true " +
    "try typeof var void while with yield").split(" ")),
};
KEYWORDS.typescript = KEYWORDS.javascript;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Why `from` can't be renamed to `to` in `language` (a language's id, as
 *  in web/languages.js), or null if it can. */
export function renameError(from, to, language) {
  if (!IDENT.test(to)) return `${to} is not a name`;
  if (KEYWORDS[language].has(to)) return `${to} is a keyword`;
  if (!IDENT.test(from) || KEYWORDS[language].has(from)) return `${from} can't be renamed`;
  return null;
}

/** `text` (in `language`) with each use of the name `from` outside strings
 *  and comments replaced by `to`: { text, count }. */
export function renameIn(text, from, to, language) {
  const skip = { python: skipPython, javascript: skipJs, typescript: skipJs }[language] ?? skipRust;
  let out = "";
  let count = 0;
  let i = 0;
  while (i < text.length) {
    const end = skip(text, i);
    if (end > i) {
      out += text.slice(i, end);
      i = end;
    } else if (/[A-Za-z0-9_]/.test(text[i])) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
      const word = text.slice(i, j);
      const after = skip(text, j, word);
      if (after > j) {
        // A string's prefix (r, b, f, …).
        out += text.slice(i, after);
        i = after;
        continue;
      }
      if (word === from) count++;
      out += word === from ? to : word;
      i = j;
    } else out += text[i++];
  }
  return { text: out, count };
}

/** The end of the quoted string starting at `i` with `quote` (one or more
 *  characters), backslash escaping the next character. */
function endOfQuoted(text, i, quote) {
  let j = i + quote.length;
  while (j < text.length && !text.startsWith(quote, j)) j += text[j] === "\\" ? 2 : 1;
  return Math.min(j + quote.length, text.length);
}

/** In Rust, the end of the comment, string or char literal (or lifetime)
 *  at `i`, after a word `prefix` if any; or `i` if there is none. */
function skipRust(text, i, prefix = "") {
  if (prefix) {
    if (/^(r|br|cr)$/.test(prefix)) {
      const m = /^(#*)"/.exec(text.slice(i, i + 256));
      if (m) {
        const end = text.indexOf(`"${m[1]}`, i + m[0].length);
        return end < 0 ? text.length : end + m[0].length;
      }
    }
    if (/^(b|c)$/.test(prefix) && text[i] === '"') return endOfQuoted(text, i, '"');
    if (prefix === "b" && text[i] === "'") return endOfQuoted(text, i, "'");
    return i;
  }
  if (text.startsWith("//", i)) {
    const nl = text.indexOf("\n", i);
    return nl < 0 ? text.length : nl;
  }
  if (text.startsWith("/*", i)) {
    // Block comments nest.
    let depth = 0;
    let j = i;
    while (j < text.length) {
      if (text.startsWith("/*", j)) (depth++, j += 2);
      else if (text.startsWith("*/", j)) {
        j += 2;
        if (--depth === 0) break;
      } else j++;
    }
    return j;
  }
  if (text[i] === '"') return endOfQuoted(text, i, '"');
  if (text[i] === "'") {
    // A char ('a', '\n', '\u{1F980}'), else a lifetime or label ('a), name and all.
    const char = /^'(?:\\(?:u\{[0-9A-Fa-f]*\}|x[0-9A-Fa-f]{2}|.)|[^\\'\n])'/u.exec(text.slice(i, i + 16));
    if (char) return i + char[0].length;
    const lifetime = /^'[A-Za-z_]\w*/.exec(text.slice(i));
    return i + (lifetime ? lifetime[0].length : 1);
  }
  return i;
}

/** In Python, the end of the comment or string at `i`, after a word
 *  `prefix` if any; or `i` if there is none. */
function skipPython(text, i, prefix = "") {
  if (prefix && !/^(?:[rRuUbBfFtT]|[rR][bBfFtT]|[bBfFtT][rR])$/.test(prefix)) return i;
  if (!prefix && text[i] === "#") {
    const nl = text.indexOf("\n", i);
    return nl < 0 ? text.length : nl;
  }
  const quote = text[i];
  if (quote !== '"' && quote !== "'") return i;
  return endOfQuoted(text, i, text.startsWith(quote.repeat(3), i) ? quote.repeat(3) : quote);
}

/** In JavaScript or TypeScript, the end of the comment or string at `i`
 *  (a template literal whole, its ${} too), or `i` if there is none. */
function skipJs(text, i, prefix = "") {
  if (prefix) return i;
  if (text.startsWith("//", i)) {
    const nl = text.indexOf("\n", i);
    return nl < 0 ? text.length : nl;
  }
  if (text.startsWith("/*", i)) {
    const end = text.indexOf("*/", i + 2);
    return end < 0 ? text.length : end + 2;
  }
  return /["'`]/.test(text[i] ?? "") ? endOfQuoted(text, i, text[i]) : i;
}
