// A plain static server for build/site under /rust-web-offline/, like GitHub
// Pages: no COOP/COEP headers, so the service worker must add them.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".gz": "application/gzip",
};
export const PREFIX = "/rust-web-offline/";

export function serve(root, port = 0) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!path.startsWith(PREFIX)) return res.writeHead(404).end();
    let file = normalize(join(root, path.slice(PREFIX.length)));
    if (!file.startsWith(normalize(root))) return res.writeHead(403).end();
    if (path.endsWith("/")) file = join(file, "index.html");
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await serve(process.argv[2] ?? "build/site", Number(process.argv[3] ?? 8000));
  console.log(`http://127.0.0.1:${server.address().port}${PREFIX}`);
}
