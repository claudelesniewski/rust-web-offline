// The user's files, kept in IndexedDB: { name, content } records, plus
// settings such as the open file.

const DB = "rust-offline";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("files", { keyPath: "name" });
      req.result.createObjectStore("settings");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let db; // opened on first use

/** Run `fn(stores)` in a transaction over `names`; resolves with what `fn`'s
 *  last request returned, once the transaction commits. */
async function tx(names, mode, fn) {
  const t = (await (db ??= open())).transaction(names, mode);
  const req = fn(...names.map((n) => t.objectStore(n)));
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const listFiles = () => tx(["files"], "readonly", (s) => s.getAll());
export const putFile = (name, content) => tx(["files"], "readwrite", (s) => s.put({ name, content }));
export const deleteFile = (name) => tx(["files"], "readwrite", (s) => s.delete(name));
export const renameFile = (from, to, content) => tx(["files"], "readwrite", (s) => {
  s.delete(from);
  return s.put({ name: to, content });
});
export const getSetting = (key) => tx(["settings"], "readonly", (s) => s.get(key));
export const setSetting = (key, value) => tx(["settings"], "readwrite", (s) => s.put(value, key));

/** Is `name` acceptable for a file: a plain name ending in .rs, which is also
 *  a valid Rust module name, so that `mod name;` can refer to it. */
export function validName(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*\.rs$/.test(name);
}
