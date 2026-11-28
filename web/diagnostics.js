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

/** Whether rustc's JSON diagnostics (`output`, from --error-format=json)
 *  have an error on `line` (from 1) of `file`: null if not, else { fixed },
 *  `text` (that line) with the fixes rustc suggests for its errors there
 *  applied, or null if it suggests none. Fixes that overlap one taken are
 *  left out (rustc offers alternatives so), and so are those with
 *  placeholders. */
export function fixOnLine(output, file, line, text) {
  const path = `src/${file}`;
  const at = (s) => s.file_name === path && s.line_start === line && s.line_end === line;
  let error = false;
  const edits = [];
  for (const json of output.split("\n")) {
    if (!json.startsWith("{")) continue;
    const d = JSON.parse(json);
    if (d.level !== "error" || !d.spans.some((s) => s.is_primary && at(s))) continue;
    error = true;
    for (const s of d.children.flatMap((c) => c.spans)) {
      if (at(s) && s.suggested_replacement !== null && /^(MachineApplicable|MaybeIncorrect)$/.test(s.suggestion_applicability)) {
        edits.push({ from: s.column_start - 1, to: s.column_end - 1, insert: s.suggested_replacement });
      }
    }
  }
  if (!error) return null;
  const taken = [];
  for (const e of edits) if (!taken.some((t) => e.from < t.to && t.from < e.to || e.from === t.from)) taken.push(e);
  if (!taken.length) return { fixed: null };
  let fixed = text;
  for (const e of taken.sort((a, b) => b.from - a.from)) fixed = fixed.slice(0, e.from) + e.insert + fixed.slice(e.to);
  return { fixed };
}
