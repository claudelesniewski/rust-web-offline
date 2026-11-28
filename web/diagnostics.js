// Errors and warnings in rustc's output, and places in the code it and
// panics name: to show in the editor, and as links in the terminal.
import { AnsiParser } from "./terminal.js";

/** The places in the project that `text` names, as rustc and panics do
 *  (src/main.rs:3:7): [{ index, length, file, line, col }], where `file` is
 *  relative to src/. Not paths of the standard library's sources, which
 *  merely contain "src/". */
export function findLocations(text) {
  return [...text.matchAll(/(?<![\w/.-])src\/((?:\w+\/)*\w+\.rs):(\d+):(\d+)/g)].map((m) => ({
    index: m.index, length: m[0].length, file: m[1], line: Number(m[2]), col: Number(m[3]),
  }));
}

/** The errors and warnings in rustc's human-readable `output` (with or
 *  without colours), each at its primary place in the project:
 *  [{ file, line, col, width, severity, message }], where `file` is relative
 *  to src/, `width` is that of the place's carets, and `severity` is "error"
 *  or "warning". */
export function parseDiagnostics(output) {
  const text = new AnsiParser().push(output).map((s) => s.text).join("");
  const found = [];
  let header = null; // the message whose place comes next
  let last = null; // the one whose carets come next
  for (const line of text.split("\n")) {
    const head = /^(\w+)(?:\[\w+\])?: (.*)$/.exec(line);
    const at = /^\s*--> src\/(\S+\.rs):(\d+):(\d+)$/.exec(line);
    const carets = /^\s*\d*\s*\|.*?(\^+)[\^-]*(.*)$/.exec(line);
    if (head) {
      header = head[1] === "error" || head[1] === "warning" ? { severity: head[1], message: head[2] } : null;
      last = null;
    } else if (at && header) {
      last = { file: at[1], line: Number(at[2]), col: Number(at[3]), width: 1, ...header };
      found.push(last);
      header = null;
    } else if (carets && last) {
      last.width = carets[1].length;
      if (carets[2].trim()) last.message += `\n${carets[2].trim()}`;
      last = null;
    }
  }
  return found;
}
