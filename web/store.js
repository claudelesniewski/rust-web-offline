// The user's projects and their files, kept in IndexedDB, plus settings
// such as the open project.
//
//   projects        { id, name }
//   project-files   { project, name, content }, keyed by [project, name];
//                   a name is a path, as geometry/shapes.rs
//   settings        key -> value
//
// Version 1 had one set of files, in `files` ({ name, content }); upgrading
// copies them into a project named "My project" (id "default"), and leaves
// `files` as it was, as a backup.

const DB = "rust-offline";
export const FIRST_PROJECT = "default";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const t = req.transaction;
      if (e.oldVersion < 1) db.createObjectStore("settings");
      db.createObjectStore("projects", { keyPath: "id" });
      const files = db.createObjectStore("project-files", { keyPath: ["project", "name"] });
      if (e.oldVersion === 1) {
        t.objectStore("projects").put({ id: FIRST_PROJECT, name: "My project" });
        t.objectStore("files").openCursor().onsuccess = ({ target: { result: cursor } }) => {
          if (!cursor) return;
          files.put({ project: FIRST_PROJECT, name: cursor.value.name, content: cursor.value.content });
          cursor.continue();
        };
        const settings = t.objectStore("settings");
        settings.get("active").onsuccess = ({ target: { result } }) => {
          if (result !== undefined) settings.put(result, `active:${FIRST_PROJECT}`);
        };
      }
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

/** All the keys of a project's files. */
const ofProject = (project) => IDBKeyRange.bound([project, ""], [project, "￿"]);

export const listProjects = () => tx(["projects"], "readonly", (s) => s.getAll());
export const putProject = (project) => tx(["projects"], "readwrite", (s) => s.put(project));
/** Delete a project and its files. */
export const deleteProject = (id) => tx(["projects", "project-files"], "readwrite", (projects, files) => {
  projects.delete(id);
  return files.delete(ofProject(id));
});

export const listFiles = (project) => tx(["project-files"], "readonly", (s) => s.getAll(ofProject(project)));
export const putFile = (project, name, content) =>
  tx(["project-files"], "readwrite", (s) => s.put({ project, name, content }));
export const deleteFile = (project, name) => tx(["project-files"], "readwrite", (s) => s.delete([project, name]));
export const renameFile = (project, from, to, content) => tx(["project-files"], "readwrite", (s) => {
  s.delete([project, from]);
  return s.put({ project, name: to, content });
});

export const getSetting = (key) => tx(["settings"], "readonly", (s) => s.get(key));
export const setSetting = (key, value) => tx(["settings"], "readwrite", (s) => s.put(value, key));
