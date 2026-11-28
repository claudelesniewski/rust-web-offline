# TODO

1. Rename: tell a local variable from a name elsewhere (today, every
   whole-word use in the language's files is renamed).

## Smaller packs (measured: about 19 MB less to download, 26 MB less disk)

- rustc.wasm as zstd-19 rather than gzip: 22.9 → 14.2 MB (13.3 with a long
  window); fzstd decodes it in about 0.45 s, against 0.26 s for gunzip.
- The sysroot's entries as zstd rather than deflate (still read lazily):
  32.9 → 26.2 MB; and leave out proc_macro (0.9 MB).
- Cache Pyodide's wasm and mjs gzipped (CompressionStream): 10.9 → 3.8 MB
  of disk.
- Rust docs: leave out the 2,010 core/alloc pages that std re-exports,
  sending them to std's: 14.1 → 11.3 MB.

## Languages (each a pack)

1. C/C++: YoWASP's clang and lld (Apache-2.0 with LLVM exception), 27 MB,
   targets wasm32-wasi, so its programs run in the Rust pack's WASI kernel.
2. JavaScript, run as is; TypeScript with typescript.js 6.x (1.7 MB).
3. Python data: numpy, pandas and matplotlib (Agg backend, PNGs shown in
   the output).
4. Ruby: ruby.wasm (WASI, 9 MB).
5. SQL with sqlite-wasm (3 MB), and Lua with wasmoon (0.5 MB).

## IDE features

1. Editor tabs, and a split view.
2. Program arguments (and environment variables) per project.
3. Settings: font size, a light theme, tab width.
4. Outline of the file's items (Ctrl-Shift-O), from the syntax tree.
5. A Python REPL, in the terminal.
6. A diff of the changes before a GitHub push or pull.
7. Open a folder on disk (File System Access API).
8. Share a file by URL (compressed into the link, no server).
9. A Python debugger (breakpoints, stepping, variables), with sys.settrace
   blocking on a SharedArrayBuffer as stdin does.
10. Precompiled crates (rand, regex, serde) as packs.

`bench/ai.mjs` measures AI suggestions, in Rust and Python.
