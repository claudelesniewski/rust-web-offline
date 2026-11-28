// The languages the IDE knows, by file extension: the toolchain pack each
// needs (web/packs.js), how a project in it is laid out in a folder of a
// repository, for GitHub sync (web/sync.js), the places in the code its
// errors name, and where a name is defined.
import * as rustErrors from "./diagnostics.js";
import * as rustDefinitions from "./definitions.js";
import * as pythonErrors from "./traceback.js";
import * as pythonDefinitions from "./python-definitions.js";
import * as jsModules from "./js-modules.js";
import * as jsDefinitions from "./js-definitions.js";

/** A Cargo.toml for a package named after `project`. */
export function cargoToml(project) {
  const name = project.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+|-+$/g, "") || "app";
  return `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n`;
}

/** In order of precedence, for a project with files in several.
 *  - `layout`: the files are under `src`, beside a `manifest` made by
 *    `makeManifest` if there is none; without one, a project's files are
 *    its folder's.
 *  - `findLocations(text)`: the places in the project that the output of a
 *    compile or run names: [{ index, length, file, line, col }].
 *  - `findDefinition(files, current, word, pos)`: where `word` (at offset
 *    `pos` of file `current`) is defined: { file, line, col }, or null.
 *  - `ai`: how AI suggestions (web/suggest.js) show the model the project,
 *    as a repository named `repo`, a file being at `path(name)`; and how a
 *    `comment`, and strings (in `quotes`), start. */
export const LANGUAGES = [
  { id: "rust", name: "Rust", ext: ".rs", pack: "rust",
    layout: { src: "src/", manifest: "Cargo.toml", makeManifest: cargoToml },
    findLocations: rustErrors.findLocations, findDefinition: rustDefinitions.findDefinition,
    ai: { repo: "rust-examples", path: (name) => `src/${name}`, comment: "//", quotes: '"' } },
  { id: "python", name: "Python", ext: ".py", pack: "python",
    findLocations: pythonErrors.findLocations, findDefinition: pythonDefinitions.findDefinition,
    ai: { repo: "python-examples", path: (name) => name, comment: "#", quotes: "\"'" } },
  { id: "javascript", name: "JavaScript", ext: ".js",
    findLocations: jsModules.findLocations, findDefinition: jsDefinitions.findDefinition,
    ai: { repo: "js-examples", path: (name) => name, comment: "//", quotes: "\"'`" } },
  // Run as JavaScript once the TypeScript pack strips its types.
  { id: "typescript", name: "TypeScript", ext: ".ts", pack: "typescript",
    findLocations: jsModules.findLocations, findDefinition: jsDefinitions.findDefinition,
    ai: { repo: "js-examples", path: (name) => name, comment: "//", quotes: "\"'`" } },
];

/** The places in the project that `text` names, as any language does. */
export const findLocations = (text) => [...new Set(LANGUAGES.map((l) => l.findLocations))].flatMap((find) => find(text)).sort((a, b) => a.index - b.index);

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
