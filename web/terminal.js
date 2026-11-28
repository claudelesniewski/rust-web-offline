// The output panel: shows compiler messages and program output, with the
// colours of ANSI escape codes, and an input line for the program's stdin.

/** Parses text with ANSI SGR escape codes into styled segments. Other
 *  escape sequences are dropped. Keeps state across chunks, so a sequence
 *  split between two chunks is still understood. */
export class AnsiParser {
  constructor() {
    this.fg = null; // colour index 0-15, or null
    this.bold = false;
    this.pending = "";
  }

  /** Segments of `text`: [{ text, fg, bold }]. */
  push(text) {
    text = this.pending + text;
    this.pending = "";
    const out = [];
    const re = /\x1b(?:\[([0-9;]*)([@-~])|$|\[[0-9;]*$)/g;
    let last = 0;
    for (let m; (m = re.exec(text)); ) {
      if (m.index > last) out.push({ text: text.slice(last, m.index), fg: this.fg, bold: this.bold });
      last = re.lastIndex;
      if (m[2] === undefined) {
        // Incomplete at the end of the chunk: wait for the rest.
        this.pending = text.slice(m.index);
        last = text.length;
        break;
      }
      if (m[2] === "m") this.sgr(m[1]);
    }
    if (last < text.length) out.push({ text: text.slice(last), fg: this.fg, bold: this.bold });
    return out;
  }

  sgr(params) {
    const codes = params === "" ? [0] : params.split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) { this.fg = null; this.bold = false; }
      else if (c === 1) this.bold = true;
      else if (c === 22) this.bold = false;
      else if (c >= 30 && c <= 37) this.fg = c - 30;
      else if (c >= 90 && c <= 97) this.fg = c - 90 + 8;
      else if (c === 39) this.fg = null;
      else if (c === 38 && codes[i + 1] === 5) {
        const n = codes[i + 2];
        this.fg = n < 16 ? n : null;
        i += 2;
      }
    }
  }
}

export class Terminal {
  /** `output` is the element text goes into; `input` the stdin line.
   *  `onLocation(file, line, col)` follows a click on a place in the code. */
  constructor(output, input, { onInput, onEof, onLocation }) {
    this.output = output;
    this.input = input;
    this.parsers = new Map();
    output.addEventListener("click", (e) => {
      const link = e.target.closest("a.loc");
      if (link) onLocation(link.dataset.file, Number(link.dataset.line), Number(link.dataset.col));
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const line = input.value + "\n";
        input.value = "";
        this.write("stdin", line);
        onInput(line);
      } else if (e.key === "d" && e.ctrlKey) {
        e.preventDefault();
        onEof();
      }
    });
  }

  clear() {
    this.output.textContent = "";
    this.parsers.clear();
  }

  /** Append `text` from `stream` ("compiler", "stdout", "stderr", "stdin", "info"). */
  write(stream, text) {
    if (!this.parsers.has(stream)) this.parsers.set(stream, new AnsiParser());
    const atBottom = this.output.scrollTop + this.output.clientHeight >= this.output.scrollHeight - 4;
    for (const seg of this.parsers.get(stream).push(text)) {
      const span = document.createElement("span");
      span.className = `t-${stream}${seg.fg !== null ? ` c${seg.fg}` : ""}${seg.bold ? " b" : ""}`;
      span.textContent = seg.text;
      this.output.append(span);
    }
    if (atBottom) this.output.scrollTop = this.output.scrollHeight;
  }

  /** Make the places in the output that `find(text)` finds ([{ index,
   *  length, file, line, col }]), in a file for which `known(file)` holds,
   *  into links. Done when output ends, not as it comes, as a place may come
   *  in two chunks. */
  linkify(find, known) {
    const walker = document.createTreeWalker(this.output, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement.closest("a.loc")) nodes.push(n);
    for (const node of nodes) {
      const text = node.textContent;
      const found = find(text).filter((l) => known(l.file));
      if (!found.length) continue;
      const parts = [];
      let at = 0;
      for (const l of found) {
        parts.push(text.slice(at, l.index));
        const a = document.createElement("a");
        a.className = "loc";
        a.textContent = text.slice(l.index, l.index + l.length);
        a.title = `Go to ${a.textContent}`;
        Object.assign(a.dataset, { file: l.file, line: l.line, col: l.col });
        parts.push(a);
        at = l.index + l.length;
      }
      parts.push(text.slice(at));
      node.replaceWith(...parts);
    }
  }

  /** Enable the stdin line while a program runs. */
  setRunning(running) {
    this.input.disabled = !running;
    this.input.placeholder = running ? "stdin: type a line and press Enter (Ctrl-D for EOF)" : "";
    if (running) this.input.focus({ preventScroll: true });
  }
}
