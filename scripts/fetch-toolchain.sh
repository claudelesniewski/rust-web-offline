#!/usr/bin/env bash
# Downloads the prebuilt Rust toolchain and documentation into
# build/cache/toolchain, verifying each file against a pinned SHA-256.
# Nothing here is committed to git.
#
# Toolchain: the published site of ryancbuckley/rust-playground-inbrowser
# (Apache-2.0), pinned to one commit:
#   dist/rustc.wasm.gz     rustc nightly-2026-10-19, cg_clif backend, for wasm32-wasip1-threads
#   dist/wild.wasm.gz      the Wild linker, compiled to wasm
#   dist/sysroot.bundle    the wasm32-wasip1-threads standard library
#   dist/licenses.html     licences of everything in the above
#   browser-kernel/*       WASI + wasi-threads runtime (ryancbuckley/browser-kernel, Apache-2.0)
# Documentation: the rust-docs component of the same nightly, from
# static.rust-lang.org (MIT/Apache-2.0; the Book and Reference are
# MIT/Apache-2.0 too). scripts/pack-docs.mjs picks what is served offline.
# Python documentation: that of Python 3.14.2, Pyodide's (PSF licence).
# Test model: a 1 MB llama.cpp test model (MIT), which tests/e2e.mjs uses in
# place of the real one to test AI suggestions. Test Pyodide: the Python
# pack's files (as in web/packs.json) and a small package, and test Ruff, the
# Ruff pack's, which tests/e2e.mjs serves in place of the CDN.
#
# Mirror: these files are also published as a release of this repository,
# named after a hash of the pins below, by .github/workflows/mirror.yml, so
# that builds don't depend on the upstream commit staying reachable. Files
# come from the mirror if it has them, else from upstream; either way, they
# must match their pinned SHA-256.
#
# To update: change COMMIT or NIGHTLY, run with UPDATE_PINS=1 to print the new hashes,
# and paste them below.
#
# With STAGE=<dir>, also puts the files in <dir>/assets, named for the
# release, and the release's tag in <dir>/TAG (for mirror.yml).
set -euo pipefail

COMMIT=47377dd2ff6b725548e7847e7bd9a37efeed2c96
NIGHTLY=2026-10-19
BASE="https://raw.githubusercontent.com/ryancbuckley/rust-playground-inbrowser-site/$COMMIT"
DOCS="https://static.rust-lang.org/dist/$NIGHTLY/rust-docs-nightly-x86_64-unknown-linux-gnu.tar.xz"
PYTHON_DOCS="https://www.python.org/ftp/python/doc/3.14.2/python-3.14.2-docs-html.tar.bz2"
PYODIDE="https://cdn.jsdelivr.net/pyodide/v314.0.8/full"
RUFF="https://cdn.jsdelivr.net/npm/@astral-sh/ruff-wasm-web@0.17.6"
TEST_MODEL="https://huggingface.co/ggml-org/models-moved/resolve/499bc8821c6b12b4e53c5bffcb21ec206f212d81/tinyllamas/stories260K.gguf"
# sha256, path under build/cache/toolchain, and URL if not $BASE/path.
PINS="
57a83e028447192f4d7216afb02f3f2fcd0f124c2f0d0c6c3e28d909ba640f57  dist/rustc.wasm.gz
695aa352be33b9fe9249a8bb50bee408daa58a06f4ba43562091cffc1a046e5a  dist/wild.wasm.gz
d0315512f7bb053253e4ff5a875d7c754ae2a53a692bc249448c1166229a2f56  dist/sysroot.bundle
aa6a601f373699fd60988e73fbf0ea9fd216f9429f09ddb8cdb8b4781d0a97b2  dist/licenses.html
69966f3c73dbd008a3adb2f7ccce03d0af96b3cf1ac234cb49e03dae27d74afd  browser-kernel/kernel.js
ad25ce898e25bf67229d78981278f61b0a0dbb29964c946f46d0fb35632ce3c0  browser-kernel/fs.js
3b7f7eacc8acf852bec18dcb0f6dabad7390551a25b90da8edb4071ceb1b5920  browser-kernel/thread-worker.js
62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a  browser-kernel/LICENSE
496eb961421f63cf451b850b6f1a0c23acb0fea296a89a79ea197eac50b77457  rust-docs.tar.xz  $DOCS
d72a50b427913492be4c8eacfa66618096be9163bf27b97a651fd96bfec4df3d  python-docs.tar.bz2  $PYTHON_DOCS
270cba1bd5109f42d03350f60406024560464db173c0e387d91f0426d3bd256d  test/stories260K.gguf  $TEST_MODEL
1bb8cc14f9405aaa7cd4e00c12edd0a8539de9cc026618d6ee5a9663f367dc70  test/pyodide/pyodide.mjs  $PYODIDE/pyodide.mjs
22514b8be6980e28a02c8b1d6387ce8dfe666fc4edf8d547cff5dce29ff4d972  test/pyodide/pyodide.asm.mjs  $PYODIDE/pyodide.asm.mjs
e14d49ceca9b4a0e274ea918f3a898de2d3880b6e5573a6cfe1a2267ecc70329  test/pyodide/pyodide.asm.wasm  $PYODIDE/pyodide.asm.wasm
2bd3394a145bfbbe5bbc9d9d6ab9136abbb986c6fef6c142b3a2962227aa5c28  test/pyodide/python_stdlib.zip  $PYODIDE/python_stdlib.zip
5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010  test/pyodide/pyodide-lock.json  $PYODIDE/pyodide-lock.json
6541523b4b16c1953d2fc9b82fb86c540eea9f78fca329ab371ed13a8b0faa51  test/pyodide/annotated_types-0.7.0-py3-none-any.whl  $PYODIDE/annotated_types-0.7.0-py3-none-any.whl
8a90aec3c47c6d0b06a0930d2ff7be0b584e15fc7c09768f74717fc8b5103d0e  test/ruff/ruff_wasm.js  $RUFF/ruff_wasm.js
aee635cd86fd718af224d460e786422a76eeae4c59719eb89f6925f9514d39e1  test/ruff/ruff_wasm_bg.wasm  $RUFF/ruff_wasm_bg.wasm
"

TAG="toolchain-$(printf '%s' "$PINS" | sha256sum | cut -c1-12)"
MIRROR="https://github.com/${MIRROR_REPO:-claudelesniewski/rust-web-offline}/releases/download/$TAG"
# A release's files have no folders: dist/rustc.wasm.gz is dist_rustc.wasm.gz.
asset() { echo "${1//\//_}"; }

[ -z "${STAGE:-}" ] || STAGE="$(realpath -m "$STAGE")"
OUT="$(cd "$(dirname "$0")/.." && pwd)/build/cache/toolchain"
mkdir -p "$OUT"
cd "$OUT"
while read -r sha path url; do
  [ -n "$path" ] || continue
  ok() { echo "$sha  $path" | sha256sum -c --status; }
  if [ -f "$path" ] && ok; then continue; fi
  mkdir -p "$(dirname "$path")"
  echo "fetching $path"
  for from in "$MIRROR/$(asset "$path")" "${url:-$BASE/$path}"; do
    if curl -fsSL --retry 4 -o "$path.part" "$from" 2>/dev/null; then
      mv -f "$path.part" "$path"
      if [ -n "${UPDATE_PINS:-}" ] || ok; then break; fi
      echo "  checksum mismatch from $from" >&2
    fi
  done
  if [ -n "${UPDATE_PINS:-}" ]; then sha256sum "$path"; continue; fi
  ok || { echo "could not fetch $path with its pinned checksum" >&2; exit 1; }
done <<< "$PINS"

if [ -n "${STAGE:-}" ]; then
  mkdir -p "$STAGE/assets"
  while read -r sha path url; do
    [ -n "$path" ] && cp "$path" "$STAGE/assets/$(asset "$path")"
  done <<< "$PINS"
  echo "$TAG" > "$STAGE/TAG"
fi
