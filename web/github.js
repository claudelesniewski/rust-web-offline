// A small client for GitHub's Git Data API, enough to read a branch's files
// and to commit files to it. GitHub's API allows calls from web pages
// (CORS); it authenticates with a personal access token.

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Decode base64 holding UTF-8 text. */
function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** A client for repository `repo` ("owner/name"). */
export function createGitHub({ token, repo, fetch = globalThis.fetch.bind(globalThis) }) {
  async function call(method, path, body) {
    const res = await fetch(`${API}/repos/${repo}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => {
      throw new GitHubError(0, "GitHub: couldn't reach api.github.com (are you offline?)");
    });
    if (res.ok) return res.json();
    const detail = (await res.json().catch(() => ({}))).message ?? res.statusText;
    const hint = res.status === 401 ? "the token is not valid (or has expired)"
      : res.status === 404 ? `${repo} wasn't found, or the token can't reach it`
      : res.status === 403 ? "the token isn't allowed to do this (it needs Contents: read and write)"
      : res.status === 409 ? "the repository is empty: give it a first commit (a README, say) on GitHub"
      : detail;
    throw new GitHubError(res.status, `GitHub: ${hint} (${res.status} ${detail})`);
  }

  return {
    /** The commit `branch` points to. */
    async head(branch) {
      return (await call("GET", `/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
    },

    /** The files under `prefix` in `commit`: `names`, all their paths
     *  (relative to `prefix`), and `files`, { path: content } of those that
     *  `pick(names)` returns. */
    async read(commit, prefix, pick = (names) => names) {
      const tree = (await call("GET", `/git/commits/${commit}`)).tree.sha;
      const { tree: entries, truncated } = await call("GET", `/git/trees/${tree}?recursive=1`);
      if (truncated) throw new GitHubError(0, "GitHub: the repository is too large to read");
      const shas = new Map();
      for (const e of entries) if (e.type === "blob" && e.path.startsWith(prefix)) shas.set(e.path.slice(prefix.length), e.sha);
      const names = [...shas.keys()];
      const files = {};
      for (const name of pick(names)) files[name] = fromBase64((await call("GET", `/git/blobs/${shas.get(name)}`)).content);
      return { names, files };
    },

    /** Commit on top of `parent`, as the new head of `branch`: files to
     *  write ({ path: content }) and paths to delete, all else as it was.
     *  Fails if `branch` has moved on from `parent`. Returns the commit. */
    async commit(branch, parent, { write, remove, message }) {
      const base = (await call("GET", `/git/commits/${parent}`)).tree.sha;
      const tree = [
        ...Object.entries(write).map(([path, content]) => ({ path, mode: "100644", type: "blob", content })),
        ...remove.map((path) => ({ path, mode: "100644", type: "blob", sha: null })),
      ];
      const { sha: newTree } = await call("POST", "/git/trees", { base_tree: base, tree });
      const { sha } = await call("POST", "/git/commits", { message, tree: newTree, parents: [parent] });
      // Not forced: GitHub refuses if the branch is no longer at `parent`.
      await call("PATCH", `/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: false });
      return sha;
    },
  };
}
