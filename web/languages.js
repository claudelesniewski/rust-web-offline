// The languages the IDE knows, by file extension: the toolchain pack each
// needs (web/packs.js), and how a project in it is laid out in a folder of
// a repository, for GitHub sync (web/sync.js).

/** A Cargo.toml for a package named after `project`. */
export function cargoToml(project) {
  const name = project.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+|-+$/g, "") || "app";
  return `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n`;
}

/** In order of precedence, for a project with files in several. `layout`:
 *  the files are under `src`, beside a `manifest` made by `makeManifest`
 *  if there is none; without one, a project's files are its folder's. */
export const LANGUAGES = [
  { id: "rust", name: "Rust", ext: ".rs", pack: "rust",
    layout: { src: "src/", manifest: "Cargo.toml", makeManifest: cargoToml } },
  { id: "python", name: "Python", ext: ".py", pack: "python" },
];

/** The language of file `name`, or undefined. */
export const languageOf = (name) => LANGUAGES.find((l) => name.endsWith(l.ext));

/** Is `name` acceptable for a file: a path of module names (folders, then
 *  the file) with a known extension, so that `mod name;` or `import name`
 *  can refer to it. */
export function validName(name) {
  const m = /^((?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*)(\.\w+)$/.exec(name);
  return Boolean(m && LANGUAGES.some((l) => l.ext === m[2]));
}

/** `name` with a known extension: as it is, or with `.rs` added. */
export const withExtension = (name) => (languageOf(name) ? name : `${name}${LANGUAGES[0].ext}`);
