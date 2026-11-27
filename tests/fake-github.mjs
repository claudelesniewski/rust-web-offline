// An in-memory GitHub, answering the Git Data API calls web/github.js makes,
// for the unit and end-to-end tests.
import { createHash } from "node:crypto";

export function createFakeGitHub(repo, branch = "main") {
  const objects = new Map(); // sha -> { type, ... }
  const refs = new Map();
  const put = (obj) => {
    const sha = createHash("sha1").update(JSON.stringify(obj)).digest("hex");
    objects.set(sha, obj);
    return sha;
  };
  const blob = (content) => put({ type: "blob", content });
  /** A tree from { path: blobSha }. */
  const tree = (files) => put({ type: "tree", files: { ...files } });
  const commitOf = (treeSha, parents, message) => put({ type: "commit", tree: treeSha, parents, message, t: Math.random() });

  /** The files at the head of `branch`: { path: content }. */
  function files(b = branch) {
    const t = objects.get(objects.get(refs.get(b)).tree);
    return Object.fromEntries(Object.entries(t.files).map(([p, s]) => [p, objects.get(s).content]));
  }

  /** Commit `contents` ({ path: content|null }) on `branch`, as someone else would. */
  function commitFiles(contents, b = branch) {
    const parent = refs.get(b);
    const base = parent ? { ...objects.get(objects.get(parent).tree).files } : {};
    for (const [p, c] of Object.entries(contents)) {
      if (c === null) delete base[p];
      else base[p] = blob(c);
    }
    refs.set(b, commitOf(tree(base), parent ? [parent] : [], "external"));
  }

  /** Answer a request: { status, json }. */
  function handle(method, url, body) {
    const u = new URL(url);
    const prefix = `/repos/${repo}`;
    if (!u.pathname.startsWith(prefix)) return { status: 404, json: { message: "Not Found" } };
    const path = decodeURIComponent(u.pathname.slice(prefix.length));
    let m;
    if (method === "GET" && (m = path.match(/^\/git\/ref\/heads\/(.+)$/))) {
      return refs.has(m[1]) ? { status: 200, json: { object: { sha: refs.get(m[1]) } } } : { status: 404, json: { message: "Not Found" } };
    }
    if (method === "GET" && (m = path.match(/^\/git\/commits\/(\w+)$/))) {
      const c = objects.get(m[1]);
      return { status: 200, json: { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), message: c.message } };
    }
    if (method === "GET" && (m = path.match(/^\/git\/trees\/(\w+)$/))) {
      const t = objects.get(m[1]);
      const entries = Object.entries(t.files).map(([p, sha]) => ({ path: p, type: "blob", mode: "100644", sha }));
      return { status: 200, json: { sha: m[1], tree: entries, truncated: false } };
    }
    if (method === "GET" && (m = path.match(/^\/git\/blobs\/(\w+)$/))) {
      return { status: 200, json: { sha: m[1], encoding: "base64", content: Buffer.from(objects.get(m[1]).content).toString("base64") } };
    }
    if (method === "POST" && path === "/git/trees") {
      const files = { ...objects.get(body.base_tree).files };
      for (const e of body.tree) {
        if (e.sha === null) delete files[e.path];
        else files[e.path] = e.content !== undefined ? blob(e.content) : e.sha;
      }
      return { status: 201, json: { sha: tree(files) } };
    }
    if (method === "POST" && path === "/git/commits") {
      return { status: 201, json: { sha: commitOf(body.tree, body.parents, body.message) } };
    }
    if (method === "PATCH" && (m = path.match(/^\/git\/refs\/heads\/(.+)$/))) {
      const current = refs.get(m[1]);
      if (!body.force && !objects.get(body.sha).parents.includes(current)) {
        return { status: 422, json: { message: "Update is not a fast forward" } };
      }
      refs.set(m[1], body.sha);
      return { status: 200, json: { object: { sha: body.sha } } };
    }
    return { status: 404, json: { message: `fake: no ${method} ${path}` } };
  }

  /** A fetch that answers from this fake. */
  async function fetch(url, { method = "GET", body } = {}) {
    const { status, json } = handle(method, url, body ? JSON.parse(body) : undefined);
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  }

  return { handle, fetch, files, commitFiles, head: (b = branch) => refs.get(b) };
}
