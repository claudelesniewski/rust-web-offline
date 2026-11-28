# TODO

In order:

1. A layout size may be lost if the page reloads right after a drag.
2. Hover docs: Rust's std items from the offline docs' index; Python's from
   its docs.
3. Run tests (`#[test]`; in Python, `unittest`), with a results panel.
4. AI suggestions: after `::`, hold the model to the items of the module or
   type there, as after a dot.
5. AI suggestions: show the model the signature of the member it picks.
6. Lint Python as you type, with Ruff (its pack formats already).
7. Turning AI suggestions on the first time: Qwen2.5-Coder-0.5B, rather
   than the smallest model, as it is right about twice as often in Rust.
8. Rename a symbol, across files.
9. A command palette (Ctrl-Shift-P).

`bench/ai.mjs` measures AI suggestions, in Rust and Python.
