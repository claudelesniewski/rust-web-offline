// Syncing a project with a folder of a GitHub repository: the project's
// files are the .rs files under src/ there (as in a Cargo package), so that
// the repository also builds with Cargo.
//
// A link is { repo, branch, dir, head, snapshot }: `head` is the commit the
// project was last pulled from or pushed as, and `snapshot` its files then,
// to tell local changes from remote ones.

import { validName } from "./store.js";

export class SyncConflict extends Error {}

/** Where a link's files are in the repository. */
export function paths(dir) {
  const base = dir.replace(/^\/+|\/+$/g, "");
  const at = base ? `${base}/` : "";
  return { src: `${at}src/`, cargo: `${at}Cargo.toml` };
}

/** Whether `files` (a Map) differ from `snapshot` ({ name: content }). */
export function changedSince(files, snapshot = {}) {
  const names = Object.keys(snapshot);
  return names.length !== files.size || names.some((n) => files.get(n) !== snapshot[n]);
}

/** A Cargo.toml for a package named after `project`. */
export function cargoToml(project) {
  const name = project.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+|-+$/g, "") || "app";
  return `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n`;
}

/** The project's files at the head of the link's branch: { head, files }. */
export async function pull(gh, link) {
  const head = await gh.head(link.branch);
  const { files } = await gh.read(head, paths(link.dir).src);
  return { head, files: Object.fromEntries(Object.entries(files).filter(([name]) => validName(name))) };
}

/** Commit `files` (a Map) to the link's branch; returns the new head. Throws
 *  SyncConflict if the branch moved on since the link's head (or, before a
 *  first sync, if it already has files there): pull first. */
export async function push(gh, link, files, { message, project }) {
  const { src, cargo } = paths(link.dir);
  const head = await gh.head(link.branch);
  if (link.head && head !== link.head) throw new SyncConflict("The repository has changed since you last synced: pull first.");
  const { files: remote, hasExtra } = await gh.read(head, src, cargo);
  const theirs = Object.fromEntries(Object.entries(remote).filter(([name]) => validName(name)));
  if (!link.head && Object.keys(theirs).length) {
    throw new SyncConflict(`The repository already has files in ${src}: pull them first.`);
  }
  const write = {};
  for (const [name, content] of files) if (theirs[name] !== content) write[src + name] = content;
  if (!hasExtra) write[cargo] = cargoToml(project);
  const remove = Object.keys(theirs).filter((name) => !files.has(name)).map((name) => src + name);
  if (!Object.keys(write).length && !remove.length) return head; // nothing to commit
  return gh.commit(link.branch, head, { write, remove, message });
}
