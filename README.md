# Rust Offline

An installable web app (PWA) for writing, compiling and running small Rust
programs entirely in the browser. Open it once online; after that it works
with no network at all. The compiler (`rustc`), the linker and the standard
library run as WebAssembly on your machine; nothing is sent to a server.

- Editor with Rust highlighting and Tab completion (CodeMirror 6), **Run** (Ctrl-Enter),
  **Test** (Rust's `#[test]`s; Python's `unittest` tests and `test_`
  functions), **Format** (rustfmt), and a terminal panel with stdin. Places in compiler
  errors and panics (`src/main.rs:3:7`) are links to the code. F12 (or
  Ctrl-click) goes to where a name is defined, in Rust or Python: a good
  guess, from the code's text. F2 renames a name in all the project's files
  of its language (not in strings or comments), each file's change undoable
  with Ctrl-Z. Hovering over a name shows its docs: in
  Rust, a std type's (from the offline docs) or a method's after a dot; in
  Python, jedi's signature and docstring.
- Projects, each with its own files, saved automatically in the browser
  (IndexedDB). Other files are modules, in folders too: `mod foo;` uses
  `foo.rs` or `foo/mod.rs`. Import `.rs` files; export one file or a whole
  project as a `.zip`.
- Sync a project with a GitHub repository (project menu → **GitHub…**): push
  its files there, or pull them back. A Rust project is a Cargo package
  there (its files under `src/`); a Python one, the folder's `.py` files. It needs
  a fine-grained personal access token for that repository with **Contents:
  read and write** (github.com → Settings → Developer settings → Personal
  access tokens → Fine-grained tokens), kept in the browser only.
- Standard library only (no crates.io).
- Toolchains to choose from (Options → **Toolchains…**), each downloaded
  only when installed, then offline: Rust (74 MB with its docs, installed at
  first, but it can be removed) and **Python** 3.14 from Pyodide (13 MB,
  installed when you first run a `.py` file). `.py` files run with **Run**,
  `input()` included, and a traceback's places are links (and underlined);
  add packages from Pyodide's (numpy, pandas, …) in the same dialog, or
  remove them. **Format** for `.py` files uses Ruff (10 MB, installed when
  first used), which, once installed, also lints them as you type.
- Optional Vim key bindings (in **Options**), with `:w` to save.
- Type-aware completion after `.` (on by default, in **Options**): in Rust,
  the compiler finds the type, and the offline docs list its methods (and
  after `::`, a module's public items, or a type's associated functions);
  in
  Python, jedi (installed with Python) finds the members, and modules in
  imports.
- Optional **AI** suggestions (in **Options**): a small language model runs
  on the device and suggests the rest of the line, in Rust or Python, shown
  greyed out; Tab takes it (Shift-Tab when a completion list is open too).
  Choose one of five models, each downloaded when first chosen (and listed
  in Toolchains, to remove): from SmolLM2-135M (145 MB, fastest, often
  wrong) to Qwen2.5-Coder-0.5B (531 MB, about twice as slow, right about
  twice as often in Rust: listed first, as recommended).
- Offline documentation (**Docs** menu): the Rust Book, the Reference, and
  the std, core and alloc API docs with search; and Python's tutorial,
  library and language reference with search (a 6 MB pack, **Python docs**,
  in Toolchains; online they work without it).

Setup and deployment: [docs/DEPLOY.md](docs/DEPLOY.md). How it works and why:
[docs/DESIGN.md](docs/DESIGN.md).

## Development

```bash
scripts/build.sh          # downloads the toolchain and docs, builds build/site
node tests/serve.mjs      # serves it at http://127.0.0.1:8000/rust-web-offline/
scripts/ci.sh             # unit tests + build + end-to-end test in headless Chromium
node bench/ai.mjs         # how often AI suggestions are right, in Rust and Python
```

## Credits and licences

The toolchain (`rustc` with the Cranelift backend, the Wild linker and the
`wasm32-wasip1-threads` standard library) and the WASI runtime come prebuilt
from [rust-playground-inbrowser](https://github.com/ryancbuckley/rust-playground-inbrowser)
and [browser-kernel](https://github.com/ryancbuckley/browser-kernel) by Ryan
Buckley (Apache-2.0); `web/compiler-worker.js` is adapted from the former.
The documentation is the `rust-docs` component of the same nightly
(MIT/Apache-2.0). The deployed site includes the toolchain's licences (`toolchain/licenses.html`,
`browser-kernel/LICENSE`).
Python is [Pyodide](https://pyodide.org) (MPL-2.0), downloaded from the
jsDelivr CDN only if installed.
