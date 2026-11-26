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
  /** `output` is the element text goes into; `input` the stdin line. */
  constructor(output, input, { onInput, onEof }) {
    this.output = output;
    this.input = input;
    this.parsers = new Map();
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

  /** Enable the stdin line while a program runs. */
  setRunning(running) {
    this.input.disabled = !running;
    this.input.placeholder = running ? "stdin: type a line and press Enter (Ctrl-D for EOF)" : "";
    if (running) this.input.focus({ preventScroll: true });
  }
}
