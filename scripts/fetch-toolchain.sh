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
# Test model: a 1 MB llama.cpp test model (MIT), which tests/e2e.mjs uses in
# place of the real one to test AI suggestions.
#
# To update: change COMMIT or NIGHTLY, run with UPDATE_PINS=1 to print the new hashes,
# and paste them below.
set -euo pipefail

COMMIT=47377dd2ff6b725548e7847e7bd9a37efeed2c96
NIGHTLY=2026-10-19
BASE="https://raw.githubusercontent.com/ryancbuckley/rust-playground-inbrowser-site/$COMMIT"
DOCS="https://static.rust-lang.org/dist/$NIGHTLY/rust-docs-nightly-x86_64-unknown-linux-gnu.tar.xz"
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
270cba1bd5109f42d03350f60406024560464db173c0e387d91f0426d3bd256d  test/stories260K.gguf  $TEST_MODEL
"

OUT="$(cd "$(dirname "$0")/.." && pwd)/build/cache/toolchain"
mkdir -p "$OUT"
cd "$OUT"
while read -r sha path url; do
  [ -n "$path" ] || continue
  if [ -f "$path" ] && echo "$sha  $path" | sha256sum -c --status; then continue; fi
  mkdir -p "$(dirname "$path")"
  echo "fetching $path"
  curl -fsSL --retry 4 -o "$path.part" "${url:-$BASE/$path}"
  mv -f "$path.part" "$path"
  if [ -n "${UPDATE_PINS:-}" ]; then sha256sum "$path"; continue; fi
  echo "$sha  $path" | sha256sum -c --quiet || { echo "checksum mismatch: $path" >&2; exit 1; }
done <<< "$PINS"
