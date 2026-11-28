// Python's tracebacks: the places in the project they name, as links in the
// terminal, and as errors to show in the editor. The project's files are
// under /src (web/python-worker.js), and frames outside it are left out.
import { AnsiParser } from "./terminal.js";

const FRAME = /File "\/src\/((?:\w+\/)*\w+\.py)", line (\d+)/g;

/** The places in the project that `text` names, as tracebacks do
 *  (File "/src/main.py", line 3): [{ index, length, file, line, col }]. */
export function findLocations(text) {
  return [...text.matchAll(FRAME)].map((m) => ({
    index: m.index, length: m[0].length, file: m[1], line: Number(m[2]), col: 1,
  }));
}

/** The error in a traceback in `output`, at each of its frames in the
 *  project (`files`: name -> content): [{ file, line, col, width, severity,
 *  message }]. Where it was raised is an "error"; the calls that led there,
 *  "info". Each spans its frame's carets (~~^^), or else its line's code. */
export function parseTraceback(output, files) {
  const lines = new AnsiParser().push(output).map((s) => s.text).join("").split("\n");
  const frames = [];
  let message = null;
  for (let i = 0; i < lines.length; i++) {
    // Of chained exceptions, the last.
    if (lines[i].startsWith("Traceback (most recent call last):")) frames.length = 0;
    const frame = /^\s*File "\/src\/((?:\w+\/)*\w+\.py)", line (\d+)/.exec(lines[i]);
    if (frame) {
      if (!files.has(frame[1])) continue;
      const source = files.get(frame[1]).split("\n")[Number(frame[2]) - 1] ?? "";
      const indent = source.length - source.trimStart().length;
      const f = { file: frame[1], line: Number(frame[2]), col: indent + 1, width: source.trim().length };
      // The code, as the traceback shows it (stripped), then maybe carets.
      const code = lines[i + 1] ?? "";
      const carets = /^(\s*)([~^]+)\s*$/.exec(lines[i + 2] ?? "");
      if (code.trim() && carets) {
        f.col = indent + 1 + carets[1].length - (code.length - code.trimStart().length);
        f.width = carets[2].length;
      }
      frames.push(f);
      message = null;
    } else if (frames.length && /^[A-Za-z_][\w.]*(:|$)/.test(lines[i]) && message === null) {
      message = lines[i].trim(); // the exception, as "NameError: name 'x' is not defined"
    }
  }
  if (!frames.length || !message) return [];
  return frames.map((f, i) => (i === frames.length - 1
    ? { ...f, severity: "error", message }
    : { ...f, severity: "info", message: `${message}\n(in a call from here)` }));
}
