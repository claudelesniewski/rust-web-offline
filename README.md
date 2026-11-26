# Rust Offline

An installable web app (PWA) for writing, compiling and running small Rust
programs entirely in the browser. Open it once online; after that it works
with no network at all. The compiler (`rustc`), the linker and the standard
library run as WebAssembly on your machine; nothing is sent to a server.

- Editor with Rust highlighting and Tab completion (CodeMirror 6), **Run** (Ctrl-Enter),
  **Format** (rustfmt), and a terminal panel with stdin.
- Several files, saved automatically in the browser (IndexedDB). Other files
  are modules: `mod foo;` uses `foo.rs`. Import `.rs` files; export one file
  or all of them as a `.zip`.
- Standard library only (no crates.io).
- Type-aware completion after `.` (on by default, in **Options**): the
  compiler finds the type, and the offline docs list its methods.
- Optional **AI** suggestions (in **Options**): a small language model (SmolLM2-135M, a 145 MB
  download when turned on) runs on the device and suggests the rest of the
  line, shown greyed out; Tab takes it. Small means often wrong.
- Offline documentation: the Rust Book, the Reference, and the std, core and
  alloc API docs with search (**Docs** menu).

Setup and deployment: [docs/DEPLOY.md](docs/DEPLOY.md). How it works and why:
[docs/DESIGN.md](docs/DESIGN.md).

## Development

```bash
scripts/build.sh          # downloads the toolchain and docs, builds build/site
node tests/serve.mjs      # serves it at http://127.0.0.1:8000/rust-web-offline/
scripts/ci.sh             # unit tests + build + end-to-end test in headless Chromium
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
