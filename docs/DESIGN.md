# Design

## Choosing a toolchain

Building rustc for wasm is a large project, so this app reuses a prebuilt one.
Candidates, as evaluated in November 2026:

| Project | Licence | Rust | Size | Prebuilt | Verdict |
| --- | --- | --- | --- | --- | --- |
| [rust-playground-inbrowser](https://github.com/ryancbuckley/rust-playground-inbrowser) | Apache-2.0 | nightly-2026-10-19 | ~57 MB | yes, in its published site | **chosen** |
| [rust-wasm-serve](https://github.com/rntz-llm/rust-wasm-serve) | none stated | 1.83-dev (2024) | ~56 MB | yes (oligamiq/rust_wasm v3.0.0) | no licence, so its code can't be reused; older rustc |
| [rubrc](https://github.com/oligamiq/rubrc) | MIT/Apache in package.json, no licence file | — | much larger (cargo, clang, rust-analyzer) | demo site only | self-described pre-release and unstable; heavy |
| [wasm-rustc](https://github.com/Mearman/wasm-rustc) | MIT/Apache | recent | ~224 MB | yes (GitHub Releases) | can't link yet (emits `.o` only), so can't run programs |

rust-playground-inbrowser compiles with rustc's Cranelift backend to wasm
objects, links them with the Wild linker (also in wasm), and runs on a small
WASI kernel ([browser-kernel](https://github.com/ryancbuckley/browser-kernel)).
It is recent, permissively licensed, fast (about a second for hello world),
and includes rustfmt. Its crates.io support (124 MB) is left out.

`scripts/fetch-toolchain.sh` downloads its files from one pinned commit of
the published site, checked against pinned SHA-256 hashes. Nothing binary is
committed here. That project replaces its site's history on every deploy,
so the commit may one day be gone: `.github/workflows/mirror.yml` publishes
the same files as a release of this repository (`toolchain-<hash of the
pins>`), and the script tries that release first. Whichever it comes from,
a file must match its pinned hash.

## Hosting and cross-origin isolation

rustc runs threads, which need `SharedArrayBuffer`, which needs the page to be
cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`).

**Recommendation: let the service worker add the headers** (`web/sw.js`).
The app needs a service worker anyway to work offline, and offline every
response comes from that worker's cache, so the worker must produce correct
headers regardless of the host. Doing it there makes the site work on any
static host, including GitHub Pages, which cannot set headers. The only cost
is that the very first visit reloads itself once, when the worker takes
control.

For hosts that can set headers (Cloudflare Pages, Netlify), `web/_headers`
sends them as well, so even the first visit is isolated without the reload.

Which host:

- **GitHub Pages** (recommended if the repository can be public): deploys from
  this repository with a workflow (`.github/workflows/pages.yml`), with no
  other account. Free Pages requires a public repository.
- **Cloudflare Pages** (if the repository must stay private): free for private
  repositories and reads `_headers`. It allows files of up to 25 MiB, so the
  build splits toolchain files into 20 MiB parts.

## How it works

```
page (app.js)                   compiler worker                  thread workers
 editor, files, terminal  ───►  browser-kernel: in-memory FS,  ─► one per wasm thread,
 IndexedDB store          ◄───  WASI syscalls, processes          sharing memory
                                 rustc.wasm → wild.wasm → your program
service worker (sw.js): precache the site, serve it and the installed
                        toolchains from cache (docs from compressed
                        chunks), add COOP/COEP
```

- **Compiling.** `compiler-worker.js` loads rustc, the linker and the sysroot
  into the kernel once. Run writes all files into `src/` and compiles the open
  file as the crate root for `wasm32-wasip1-threads`; rustc calls the linker
  through the kernel; the resulting wasm runs as a new process, with stdin
  piped from the terminal's input line.
- **Offline.** At build time `scripts/stamp-sw.mjs` writes into `sw.js` a
  version (a hash of the site) and the list of its files (but the
  toolchains', see below) with their sizes. The worker downloads them one at
  a time into a cache named after the version, reporting progress to the
  page, which shows "Ready for offline use" when all are cached, and the
  installed toolchains too. Requests are answered cache-first. The page calls
  `navigator.storage.persist()` so the browser doesn't evict the cache.
- **Updates.** A new deploy changes `sw.js`, so the browser installs the new
  version in the background. When the new version takes over, the page
  offers "Update ready: reload"; the reloaded page then updates the
  toolchains, downloading only their changed files.
- **Docs.** The `rust-docs` component of the toolchain's nightly is 918 MB
  over 66,000 files. `scripts/pack-docs.mjs` keeps the Book, the Reference,
  the std, core and alloc APIs (without `core::arch`, the SIMD intrinsics for
  every platform, which are two thirds of all pages) and rustdoc's search
  index: 8,500 files, 310 MB. Pages share most of their markup, so it
  concatenates them, in path order, into 8 MB chunks and compresses each with
  zstd: 14 MB in all, against about 35 MB for zipping each file alone.
  The service worker answers requests under `docs/` from these chunks
  (`web/docs.js`), decompressing a chunk with
  [fzstd](https://github.com/101arrowz/fzstd) when one of its pages is first
  asked for and keeping the last four in memory. Pages not included get a
  page linking to doc.rust-lang.org.

  Python's docs, the HTML archive of Python 3.14.2 (Pyodide's version,
  76 MB), are packed the same way, without the pages' reStructuredText
  sources, the release notes and the C API: 500 files, 43 MB, 6 MB packed,
  served under `python-docs/` and linking to docs.python.org. They are a
  pack of their own ("Python docs"), as not everyone writing Python wants
  them offline; Sphinx's search works offline as it is.
- **Completion.** Keywords, snippets, common std names and methods, and the
  file's words (`vendor/completion.js`), by context. After a dot, with
  type-aware completion on (`web/types.js`): the word there is replaced by a
  field that cannot exist and the program is type-checked (`--emit=metadata`,
  0.3 to 1.3 s), so that rustc's error names the type (``no field
  `__rwo_probe` on type `Vec<i32>` ``) and lists a struct's fields; that
  type's stable methods taking `self` then come from its offline docs page,
  found through `docs/types.json` (made by `pack-docs.mjs`), or, for your own
  types, from your `impl` blocks. If the type can't be found (e.g. the code
  doesn't parse), the plain list is offered. With AI turned on: `web/lm.js` downloads
  [wllama](https://github.com/ngxson/wllama) (llama.cpp in wasm, 11 MB, built
  into the site but not precached) into a cache of its own, which the
  service worker keeps across versions; the model is a pack (packs.json,
  `model`: its prompt format, and whether it fills in the middle), one of
  five measured below, from Hugging Face at a pinned revision, checked by
  SHA-256, downloaded when first chosen. After a pause
  in typing at the end of a line, `vendor/ghost.js` asks for the rest of it
  (`web/suggest.js`). The prompt lays out the project as files of a
  repository, in the format of the model's code training data (StarCoder2's:
  `<repo_name>…<file_sep>src/geometry.rs …<file_sep>src/main.rs …`): the
  other files (2,000 characters at most), then the open one up to the cursor
  (1,500). The toolchain then helps:
  - Right after a dot, type-aware completion finds the members there, and a
    llama.cpp grammar (GBNF) makes the model start with one of them.
  - The suggestion is type-checked in place, and not shown if rustc finds
    an error on its line (or if it is only a comment, which always compiles),
    unless rustc's own suggested fixes for it (from `--error-format=json`,
    those it deems machine-applicable or maybe incorrect; up to two rounds)
    mend it: `read_line(input)` becomes `read_line(&mut input)`. After a
    dot, a member that fails the check is tried once more without it, as
    the model's next pick (`read_line` after `read`).

  Measured on 18 lines of Rust (`push(i)`, `read_line(&mut input)`,
  `.iter().enumerate()`, …), in headless Chromium on 4 cores, with the
  preamble prompt described below:

  | | right (and compile) | shown | shown that compile | time |
  | --- | --- | --- | --- | --- |
  | model alone, indentation dropped from the prompt (before) | 3 | 18 | 4 | 0.6 s |
  | model alone, only the last space dropped | 6 | 18 | 9 | 0.5 s |
  | and held to the type's members after a dot | 8 | 18 | 12 | 0.7 s |
  | and type-checked (now) | 8 | 12 | 12 | 0.8 s |

  Trying other samples when the check fails found one more right line, and
  was 40 to 90% slower.

  The prompt was first a preamble of idiomatic Rust before the code. Adding
  8 lines unlike anything in it showed that it helped mostly where it held
  the answer (`read_line`, `entry(…).or_insert(0)`). On all 26, with the
  checks above: the preamble got 9 right (1 of the 8 new ones) in 0.7 s; the
  repository layout without it, 9 or 10 (3 of the 8) in 0.5 s, and other
  layouts (a `Cargo.toml` first, the Book's repository name) did no better.
  With the other files in the prompt, the model names their items (`area(`,
  `Circle(`) where it guessed (`new()`) without, though its arguments don't
  always compile yet.

  In Python, the same: the prompt is a repository named `python-examples`
  (with its files at the top, as `main.py`), after a dot jedi finds the
  members (a list it can't make counts as not known, as jedi often can't
  tell), and the check is Python's own, in the Python worker: a syntax
  error, or a name bound nowhere in the file (nor a builtin), on the line
  (one that opens a block gets a `pass` after it, to be checked alone).

  `bench/ai.mjs` measures all this, with the real model in headless
  Chromium, on 59 lines of each language (`bench/rust.json`,
  `bench/python.json`): 18 to tune on, 34 unlike those (held out, to tell
  whether a change only fits the 18: traits, `?`, closures, tests,
  dataclasses, exceptions, comprehensions, generators, the standard
  library…), and 7 that need another file of the project. Right means
  matching the case's pattern and passing the check:

  | | Rust | Python | time (Rust, Python) |
  | --- | --- | --- | --- |
  | model alone | 18 (8 held out, 4 multi-file) | 39 (21, 5) | 0.25 s, 0.15 s |
  | held to the members after a dot | 21 (10, 4) | 42 (22, 7) | 0.4 s, 0.2 s |
  | checked (Rust: and fixed) | 21 (9, 5) | 39 (21, 5) | 0.35 s, 0.2 s |
  | both (as the app) | 24 (11, 5) | 42 (22, 7) | 0.6 s, 0.25 s |

  On the first 29 lines (18 tuned on, 8 held out, 3 multi-file), without
  rustc's fixes and the second pick of a member, the app got 10 in Rust,
  against 12 with them; the fixes alone, 11; three picks rather than two, no more, and
  slower. Both gains are among the 18 tuned on (`read_line(&mut input)`,
  `println!("{}", name)`), though nothing in them is tuned to those lines.
  The check's gain is otherwise in what it hides: of Rust's 59, the model
  alone shows 41 wrong lines, and the app 20. Python's check
  has no fixes to offer, and a second pick of a member found none better.
  Filling in the middle (the code after the cursor too, with the
  tokenizer's `<fim_…>` tokens) made the model write nonsense: 0 and 1
  right, so it wasn't trained to. Python's
  repository named `python`, `TheAlgorithms/Python` or `python-exercises`
  did no better; up to 48 tokens a suggestion, rather than 32, got one more
  Python line right that was cut before its end.

  The models to choose from, on the same benchmark (`MODEL=<pack id> node
  bench/ai.mjs`), with the toolchain's help as above; FIM is filling in
  the middle, which Qwen2.5-Coder was trained for (`<|fim_prefix|>` …), and
  SmolLM2 wasn't:

  | | download | Rust | Python | time (Rust, Python) |
  | --- | --- | --- | --- | --- |
  | SmolLM2-135M, 8 bits | 145 MB | 24 (11 held out, 5 multi-file) | 42 (22, 7) | 0.6 s, 0.25 s |
  | SmolLM2-360M, 8 bits | 386 MB | 48 (28, 7) | 49 (27, 7) | 1.25 s, 0.5 s |
  | Qwen2.5-Coder-0.5B, 4 bits (Q4_K_M), and FIM | 398 MB | 51 (29, 7) | 49 (29, 7) | 1.15 s, 0.65 s |
  | Qwen2.5-Coder-0.5B, 8 bits, and FIM | 531 MB | 52 (30, 7) | 51 (30, 7) | 1.0 s, 0.55 s |

  Without FIM, Qwen2.5-Coder-0.5B got 22 of the first 29 Rust lines and 17
  Python ones, against 25 and 23 with it; Qwen2.5-Coder-1.5B (4 bits,
  986 MB) with FIM did no better than 0.5B on those 29, in twice the time.
  (Times on 4 cores; Qwen's 8 bits are faster than its 4, which take more
  work to unpack in wasm.) So a model of about 400 to 500 MB does much
  better: twice as many Rust lines right, held-out ones too, at about twice
  the time. Chat-tuned variants
  (SmolLM2-135M-Instruct, kimi-coder-135m) complete code no better (5 of 12
  test lines, as the base model) and answer Rust questions confidently
  wrongly, so offline chat would need a much larger model.
- **Projects and files.** IndexedDB (`web/store.js`): projects, and their
  files keyed by project and path; saved 400 ms after each edit and when the
  page is hidden. A path is Rust module names separated by `/`, ending in
  `.rs` (`geometry/mod.rs`) or `.py`, so files are modules in folders as Cargo would
  have them; Run writes them all into `src/` and compiles the open one as
  the crate root. Version 1 of the database had one set of files: upgrading
  copies them into a project named "My project", and keeps the old store as
  it was, as a backup.

- **GitHub sync.** `web/github.js` talks to GitHub's Git Data API, which
  allows calls from web pages; it authenticates with a personal access
  token, as GitHub's sign-in flows need a server (or a token endpoint that
  allows web pages, which GitHub's doesn't). `web/sync.js`: a project is a folder
  of a branch, laid out as its language has it (`web/languages.js`): with
  `.rs` files (or, to pull, a `Cargo.toml`) a Cargo package, its files
  those under `src/`; otherwise the folder's files as they are, as for
  Python. Push makes one commit of the changed and deleted files on top of
  the branch's head, adding the layout's manifest (`Cargo.toml`) if there
  is none, and leaves all else as it was; it refuses
  if the branch moved since the last sync (or, before the first, has files
  there already): pull first. Pull replaces the project's files, asking
  first if there are changes not pushed. What was last synced (commit and
  files) is kept per project, to tell changes here from changes there.

- **Toolchains ("packs").** Each language's toolchain is a pack, installed
  from the Toolchains dialog rather than precached with the site (2 MB):
  `packs.json` pins each pack's files by SHA-256, and `web/packs.js`
  downloads them, checks them and puts them in a cache of their own
  ("packs"), at the pack's `dir` plus the file's name. `sw.js` keeps that
  cache across versions, as the AI model's, and serves it offline like the
  rest of the site, so a pack's code loads its files from those same-origin
  paths. Each cached file is tagged with its pack and SHA-256: when a new
  version pins different files, the page downloads only those, then
  removes the pack's files that are no longer pinned. Which packs to keep is
  a setting; packs marked `default` (Rust) are kept until removed.
  Downloads bypass the service worker (`cache: "no-store"`), which would
  serve the earlier file.

  Rust's pack is the site's own toolchain and docs files (74 MB):
  `scripts/stamp-sw.mjs` adds them to `packs.json` at build time, and leaves
  them out of the precache. Content-hashed files come first, so an update
  cut short leaves the indexes that name them as they were. Python's pack is
  Pyodide's core files (CPython and its standard library, 13 MB), stored
  under `packs/python/`. Ruff's pack is its WebAssembly build (10 MB, from
  npm via the same CDN), which `web/ruff.js` loads to format Python as
  Black would; Pyodide has no formatter, and Ruff's is fast and small
  enough to be a pack of its own.
  Its packages come from Pyodide's lock file (`pyodide-lock.json`), which
  names each one's file, SHA-256 and dependencies; installing one fetches
  those too, from the same CDN. Separate builds of the site per language
  were the alternative; one site with packs keeps the projects, editor and
  settings in one place.
- **Running Python.** `web/python-worker.js` loads Pyodide from the pack,
  writes the project's files to `/src` and runs the open file with `runpy`,
  importing the installed packages it imports first. `input()` blocks the
  worker on a SharedArrayBuffer (`Atomics.wait`) until the terminal sends a
  line, as Rust programs' stdin does. Stop terminates the worker; the next
  run starts a new one. A traceback shows only the program's frames (not
  runpy's); `web/traceback.js` makes its places links, and underlines where
  the exception was raised, and the calls that led there.
- **Python completion.** CodeMirror's Python mode completes keywords,
  builtins and the file's names. After a dot, and in imports, the editor
  asks the Python worker, which asks jedi (a package installed with the
  Python pack, 1.7 MB with parso) with the project's files in `/src`: the
  members of what jedi infers is there, and modules and their names. The
  first takes about a second, as Python loads; later ones, about 150 ms.
  While a program runs, the worker can't answer, and there are none.

## Limits

- Rust is about 74 MB (60 MB toolchain, 14 MB docs), which the first visit
  downloads, after the 2 MB site.
- Memory: rustc reserves up to 1 GiB of address space (512 MiB on devices
  reporting under 4 GB of RAM). Very large programs may run out.
- Python: only packages that Pyodide builds for WebAssembly (no PyTorch, for
  one).
- Standard library only; one crate per run; programs are wasm, so no
  processes, networking or real filesystem.
- The toolchain is a nightly using the Cranelift backend. Its author reports
  2,640 of 2,650 rustc run-pass tests behaving as with LLVM.
