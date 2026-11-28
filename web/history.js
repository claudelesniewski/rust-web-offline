// A project's history: a git repository of its own, kept on this device, so
// that it can be committed, its commits listed and compared, and an earlier
// version restored, all offline. The repository is made by isomorphic-git
// (vendor/git.js), its files in IndexedDB (lightning-fs); the project's
// files are mirrored into its working folder to commit them.
//
// `repo` is { git, fs, dir }: isomorphic-git, a filesystem it can use (with
// `fs.promises`), and the repository's folder.

const AUTHOR = { name: "Rust Offline", email: "rust-offline@localhost" };

/** What to write and remove to make the working files `working` (a Map)
 *  those of the project, `files` (a Map). */
export function mirrorPlan(working, files) {
  return {
    write: [...files.keys()].filter((name) => working.get(name) !== files.get(name)).sort(),
    remove: [...working.keys()].filter((name) => !files.has(name)).sort(),
  };
}

/** The files changed from `before` to `after` (Maps of name -> blob id), as
 *  [{ name, status }], status "added", "modified" or "deleted". */
export function changes(before, after) {
  const out = [];
  for (const [name, id] of after) {
    if (!before.has(name)) out.push({ name, status: "added" });
    else if (before.get(name) !== id) out.push({ name, status: "modified" });
  }
  for (const name of before.keys()) if (!after.has(name)) out.push({ name, status: "deleted" });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function mkdirs({ fs, dir }, name) {
  let path = dir;
  for (const part of name.split("/").slice(0, -1)) {
    path += `/${part}`;
    await fs.promises.mkdir(path).catch((e) => { if (e.code !== "EEXIST") throw e; });
  }
}

/** The commit HEAD is at, or null before the first. */
async function head({ git, fs, dir }) {
  return git.resolveRef({ fs, dir, ref: "HEAD" }).catch(() => null);
}

/** Commit `files` (a Map of name -> content) with `message`, making the
 *  repository if there is none; returns the commit, or null if nothing
 *  changed since the last. */
export async function commit(repo, files, message) {
  const { git, fs, dir } = repo;
  await git.init({ fs, dir, defaultBranch: "main" });
  const working = new Map();
  for (const name of await git.listFiles({ fs, dir })) {
    working.set(name, await fs.promises.readFile(`${dir}/${name}`, { encoding: "utf8" }));
  }
  const { write, remove } = mirrorPlan(working, files);
  if (!write.length && !remove.length && (await head(repo))) return null;
  for (const name of write) {
    await mkdirs(repo, name);
    await fs.promises.writeFile(`${dir}/${name}`, files.get(name), { encoding: "utf8" });
    await git.add({ fs, dir, filepath: name });
  }
  for (const name of remove) {
    await fs.promises.unlink(`${dir}/${name}`);
    await git.remove({ fs, dir, filepath: name });
  }
  return git.commit({ fs, dir, message, author: AUTHOR });
}

/** The files of commit `oid`: a Map of name -> blob id. */
async function blobs({ git, fs, dir }, oid, prefix = "") {
  const out = new Map();
  for (const e of (await git.readTree({ fs, dir, oid })).tree) {
    const name = prefix + e.path;
    if (e.type === "tree") for (const [n, id] of await blobs({ git, fs, dir }, e.oid, `${name}/`)) out.set(n, id);
    else if (e.type === "blob") out.set(name, e.oid);
  }
  return out;
}

/** The commits, newest first: [{ oid, message, time (ms), changes }], each
 *  one's changes from its first parent's files. */
export async function log(repo) {
  const { git, fs, dir } = repo;
  if (!(await head(repo))) return [];
  const commits = await git.log({ fs, dir });
  return Promise.all(commits.map(async ({ oid, commit: c }) => ({
    oid,
    message: c.message.trim(),
    time: c.author.timestamp * 1000,
    changes: changes(c.parent.length ? await blobs(repo, c.parent[0]) : new Map(), await blobs(repo, oid)),
  })));
}

/** The files of commit `oid`, { name: content }. */
export async function filesAt(repo, oid) {
  const { git, fs, dir } = repo;
  const out = {};
  for (const [name, id] of await blobs(repo, oid)) {
    out[name] = new TextDecoder().decode((await git.readBlob({ fs, dir, oid: id })).blob);
  }
  return out;
}

/** Remove the repository, as when its project is deleted. */
export async function removeRepo({ fs, dir }) {
  const rm = async (path) => {
    const stat = await fs.promises.stat(path).catch(() => null);
    if (!stat) return;
    if (stat.isDirectory()) {
      for (const name of await fs.promises.readdir(path)) await rm(`${path}/${name}`);
      await fs.promises.rmdir(path);
    } else {
      await fs.promises.unlink(path);
    }
  };
  await rm(dir);
}
