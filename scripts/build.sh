#!/usr/bin/env bash
# Builds the static site into build/site, ready for any static host.
#   web/        the app's source, copied as is
#   editor/     CodeMirror entry point, bundled by esbuild into editor.js
#   toolchain   downloaded by fetch-toolchain.sh
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
npx esbuild editor/index.js --bundle --minify --format=esm --log-level=warning --outfile="$SITE/editor.js"
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

node scripts/stamp-sw.mjs "$SITE"
du -sh "$SITE"
