// isomorphic-git, and lightning-fs (a filesystem in IndexedDB) to keep each
// project's repository in (web/history.js); bundled by scripts/build.sh into
// git.js. isomorphic-git uses Node's Buffer, which browsers lack.
import { Buffer } from "buffer";
import * as git from "isomorphic-git";
import FS from "@isomorphic-git/lightning-fs";

globalThis.Buffer ??= Buffer;
export { git, FS };
