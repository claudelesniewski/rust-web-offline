# TODO

- Try some creative prompting, constraints, etc. (possibly in conjunction
  with the toolchain) to improve AI suggestions.

## Python

What Rust has and Python doesn't yet:

- Completion: keywords and names, and members after `.` (Rust's is
  type-aware, with the compiler and the docs).
- AI suggestions (their prompt and check are Rust's).
- Go to definition (F12) and Format.

## IDE features

- Hover docs for std items, from the offline docs' index.
- A command palette (Ctrl-Shift-P).
- Rename a symbol, across files.
- Run tests (`#[test]`), with a results panel.
- A layout size may be lost if the page reloads right after a drag.
