// Syncing a project with a folder of a GitHub repository, laid out as its
// language has it (web/languages.js): a Rust project is a Cargo package,
// its files the .rs files under src/ beside a Cargo.toml, so that the
// repository also builds with Cargo; a Python project's files are those of
// the folder.
//
// A link is { repo, branch, dir, head, snapshot }: `head` is the commit the
// project was last pulled from or pushed as, and `snapshot` its files then,
// to tell local changes from remote ones.

import { LANGUAGES, validName } from "./languages.js";

export class SyncConflict extends Error {}

/** The layout of a project's files `names`, or of a folder with files
 *  `names`: the first language's whose manifest or files are among them, else
 *  the files as they are. */
export function layoutOf(names) {
  for (const { ext, layout } of LANGUAGES) {
    if (layout && names.some((n) => n === layout.manifest || n.endsWith(ext))) return layout;
  }
  return { src: "" };
}

/** The folder of a link, as a prefix of paths in the repository. */
export function folder(dir) {
  const base = dir.replace(/^\/+|\/+$/g, "");
  return base ? `${base}/` : "";
}

/** The project's files among `names`, paths in a folder laid out as `layout`. */
const projectFiles = (names, { src }) => names.filter((n) => n.startsWith(src) && validName(n.slice(src.length)));

/** `files` ({ path: content }), by their names in the project. */
const unprefixed = (files, { src }) => Object.fromEntries(Object.entries(files).map(([path, c]) => [path.slice(src.length), c]));

/** Whether `files` (a Map) differ from `snapshot` ({ name: content }). */
export function changedSince(files, snapshot = {}) {
  const names = Object.keys(snapshot);
  return names.length !== files.size || names.some((n) => files.get(n) !== snapshot[n]);
}

/** The project's files at the head of the link's branch: { head, files }. */
export async function pull(gh, link) {
  const head = await gh.head(link.branch);
  let layout;
  const { files } = await gh.read(head, folder(link.dir), (names) => projectFiles(names, (layout = layoutOf(names))));
  return { head, files: unprefixed(files, layout) };
}

/** Commit `files` (a Map) to the link's branch; returns the new head. Throws
 *  SyncConflict if the branch moved on since the link's head (or, before a
 *  first sync, if it already has files there): pull first. */
export async function push(gh, link, files, { message, project }) {
  const at = folder(link.dir);
  const layout = layoutOf([...files.keys()]);
  const head = await gh.head(link.branch);
  if (link.head && head !== link.head) throw new SyncConflict("The repository has changed since you last synced: pull first.");
  const { names, files: remote } = await gh.read(head, at, (all) => projectFiles(all, layout));
  const theirs = unprefixed(remote, layout);
  if (!link.head && Object.keys(theirs).length) {
    throw new SyncConflict(`The repository already has files in ${at + layout.src || "its top folder"}: pull them first.`);
  }
  const write = {};
  for (const [name, content] of files) if (theirs[name] !== content) write[at + layout.src + name] = content;
  if (layout.manifest && !names.includes(layout.manifest)) write[at + layout.manifest] = layout.makeManifest(project);
  const remove = Object.keys(theirs).filter((name) => !files.has(name)).map((name) => at + layout.src + name);
  if (!Object.keys(write).length && !remove.length) return head; // nothing to commit
  return gh.commit(link.branch, head, { write, remove, message });
}
