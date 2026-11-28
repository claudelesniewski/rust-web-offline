#!/usr/bin/env bash
# Builds the static site into build/site, ready for any static host.
#   web/        the app's source, copied as is
#   vendor/     entry points for npm packages, bundled by esbuild
#   toolchain   downloaded by fetch-toolchain.sh
#   docs        the Rust docs, packed by pack-docs.mjs
#   python-docs the Python docs, likewise
#   lm          the optional AI completion: wllama (llama.cpp in wasm), and
#               where to get the model; downloaded only when turned on
# sw.js is then stamped with the list of files to precache for offline use.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SITE=build/site
TC=build/cache/toolchain

scripts/fetch-toolchain.sh
[ -d node_modules ] || npm ci

rm -rf "$SITE"
mkdir -p "$SITE/toolchain" "$SITE/browser-kernel"
cp -R web/. "$SITE/"
for entry in vendor/*.js; do
  npx esbuild "$entry" --bundle --minify --format=esm --log-level=warning --outfile="$SITE/${entry#vendor/}"
done
node scripts/make-icons.mjs "$SITE/icons"

cp "$TC"/browser-kernel/{kernel.js,fs.js,thread-worker.js,LICENSE} "$SITE/browser-kernel/"
cp "$TC/dist/licenses.html" "$SITE/toolchain/licenses.html"
# Content-hashed names, so an update never mixes old and new toolchain
# files; split into parts of at most 20 MiB, as Cloudflare Pages allows
# files of up to 25 MiB.
json="{"
for f in rustc.wasm.gz wild.wasm.gz sysroot.bundle; do
  hash="$(sha256sum "$TC/dist/$f" | cut -c1-12)"
  prefix="toolchain/${f%%.*}.$hash.${f#*.}."
  split -b 20M -d -a 1 "$TC/dist/$f" "$SITE/$prefix"
  parts="$(cd "$SITE" && ls "$prefix"* | sed 's/.*/"&"/' | paste -sd, -)"
  json+="\"${f%%.*}\": [$parts], "
done
echo "${json%, }}" > "$SITE/toolchain/index.json"

# AI completion: content-hashed, as they are cached apart from the rest.
mkdir -p "$SITE/lm"
npx esbuild vendor/lm/wllama.js --bundle --minify --format=esm --log-level=warning --outfile="$SITE/lm/wllama.js"
cp node_modules/@wllama/wllama/esm/wasm/wllama.wasm "$SITE/lm/wllama.wasm"
for f in wllama.js wllama.wasm; do
  hash="$(sha256sum "$SITE/lm/$f" | cut -c1-12)"
  mv "$SITE/lm/$f" "$SITE/lm/${f%.*}.$hash.${f##*.}"
done
# SmolLM2-135M (Apache-2.0), 8-bit, from llama.cpp's own conversions, pinned.
cat > "$SITE/lm/index.json" <<JSON
{
  "js": "lm/$(cd "$SITE/lm" && ls wllama.*.js)",
  "wasm": "lm/$(cd "$SITE/lm" && ls wllama.*.wasm)",
  "model": {
    "url": "https://huggingface.co/ggml-org/SmolLM2-135M-GGUF/resolve/1076b85d135017971845b19b8d07df1479155988/SmolLM2-135M-Q8_0.gguf",
    "sha256": "813966e2b5e5aba261f6f198849a13b815db3c77bf4e389e72aa1e0f35a0d455",
    "size": 144810560
  }
}
JSON

# Packing docs takes a minute, so the result is cached until the docs or
# the packer change.
#   pack_docs <set> <archive> <folder in the site> <tar's options and path>
pack_docs() {
  local set="$1" archive="$2" dest="$3"
  shift 3
  local out="build/cache/$set-docs-$(cat "$archive" scripts/pack-docs.mjs | sha256sum | cut -c1-12)"
  if [ ! -d "$out" ]; then
    rm -rf "build/cache/$set-docs-"* build/cache/docs-html
    mkdir -p build/cache/docs-html
    tar -xf "$archive" -C build/cache/docs-html "$@"
    node scripts/pack-docs.mjs "$set" build/cache/docs-html "$out.part"
    rm -rf build/cache/docs-html
    mv "$out.part" "$out"
  fi
  cp -R "$out" "$SITE/$dest"
}
pack_docs rust "$TC/rust-docs.tar.xz" docs --strip-components=6 \
  rust-docs-nightly-x86_64-unknown-linux-gnu/rust-docs/share/doc/rust/html
pack_docs python "$TC/python-docs.tar.bz2" python-docs --strip-components=1 python-3.14.2-docs-html

node scripts/stamp-sw.mjs "$SITE"
du -sh "$SITE"
