import { createReadStream, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { DEFAULT_LIBRARY_DIR, resolveLibraryFile, scanLibrary } from "./library.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "127.0.0.1";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".md", "text/markdown; charset=utf-8"],
  [".markdown", "text/markdown; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".log", "text/plain; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".yaml", "text/yaml; charset=utf-8"],
  [".yml", "text/yaml; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"]
]);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendPlain(res, status, message) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(message);
}

async function sendFile(res, absolutePath) {
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    sendPlain(res, 404, "File not found");
    return;
  }

  const extension = path.extname(absolutePath).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME_TYPES.get(extension) ?? "application/octet-stream",
    "content-length": stat.size,
    "cache-control": "no-store"
  });
  createReadStream(absolutePath).pipe(res);
}

async function handleApi(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (requestUrl.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (requestUrl.pathname === "/api/library") {
    try {
      sendJson(res, 200, await scanLibrary());
    } catch (error) {
      sendJson(res, 500, {
        error: "LIBRARY_SCAN_FAILED",
        message: error instanceof Error ? error.message : "Unknown scan error"
      });
    }
    return true;
  }

  if (requestUrl.pathname.startsWith("/files/")) {
    const relativePath = requestUrl.pathname.slice("/files/".length);
    const absolutePath = resolveLibraryFile(relativePath, DEFAULT_LIBRARY_DIR);
    if (!absolutePath) {
      sendPlain(res, 403, "Forbidden");
      return true;
    }

    try {
      await sendFile(res, absolutePath);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        sendPlain(res, 404, "File not found");
        return true;
      }
      sendPlain(res, 500, "Unable to read file");
    }
    return true;
  }

  return false;
}

async function serveProduction(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const safePath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const staticPath = path.join(DIST_DIR, safePath === "/" ? "index.html" : safePath);
  const resolved = path.resolve(staticPath);

  if (resolved.startsWith(`${DIST_DIR}${path.sep}`) && existsSync(resolved)) {
    await sendFile(res, resolved);
    return;
  }

  await sendFile(res, path.join(DIST_DIR, "index.html"));
}

async function start() {
  const vite = IS_PRODUCTION
    ? null
    : await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });

  const server = http.createServer(async (req, res) => {
    try {
      if (await handleApi(req, res)) {
        return;
      }

      if (vite) {
        vite.middlewares(req, res, () => {
          sendPlain(res, 404, "Not found");
        });
        return;
      }

      await serveProduction(req, res);
    } catch (error) {
      sendPlain(res, 500, error instanceof Error ? error.message : "Internal server error");
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Document Gallery running at http://${HOST}:${PORT}`);
  });
}

start();
