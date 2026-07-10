import { createReadStream, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import {
  DEFAULT_META_PATH,
  DEFAULT_LIBRARY_DIR,
  createLibraryFolder,
  createLibraryIndexState,
  deleteLibraryEntry,
  getLibraryErrorStatus,
  moveLibraryEntry,
  openLibraryFile,
  renameLibraryEntry,
  revealLibraryPath,
  resolveLibraryFile,
  scanLibrary,
  uploadLibraryFiles,
  writeLibraryContent,
  watchLibraryChanges
} from "./library.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "127.0.0.1";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const libraryState = createLibraryIndexState();

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

function requestHeaders(headers) {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(key, item);
      }
    } else if (value !== undefined) {
      result.set(key, value);
    }
  }
  return result;
}

async function readUploadForm(req, requestUrl) {
  const request = new Request(requestUrl.href, {
    method: req.method,
    headers: requestHeaders(req.headers),
    body: Readable.toWeb(req),
    duplex: "half"
  });
  const formData = await request.formData();
  const targetPath = String(formData.get("targetPath") ?? "");
  const files = [];

  for (const value of formData.getAll("files")) {
    if (!value || typeof value !== "object" || typeof value.arrayBuffer !== "function") {
      continue;
    }
    files.push({
      name: value.name || "file",
      content: Buffer.from(await value.arrayBuffer())
    });
  }

  return { targetPath, files };
}

async function readJsonBody(req, requestUrl) {
  const request = new Request(requestUrl.href, {
    method: req.method,
    headers: requestHeaders(req.headers),
    body: Readable.toWeb(req),
    duplex: "half"
  });
  return await request.json();
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

export function createApiHandler(options = {}) {
  const libraryDir = options.libraryDir ?? DEFAULT_LIBRARY_DIR;
  const metaPath = options.metaPath ?? DEFAULT_META_PATH;
  const state = options.libraryState ?? createLibraryIndexState();
  const revealPath = options.revealLibraryPath ?? revealLibraryPath;
  const openFile = options.openLibraryFile ?? openLibraryFile;
  const writeContent = options.writeLibraryContent ?? writeLibraryContent;

  return async function handleApi(req, res) {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (requestUrl.pathname === "/api/health") {
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (requestUrl.pathname === "/api/library/status") {
      sendJson(res, 200, state.getStatus());
      return true;
    }

    if (requestUrl.pathname === "/api/library") {
      try {
        const scanVersion = state.getStatus().version;
        const library = await scanLibrary({ libraryDir, metaPath });
        const status = state.markScanned(scanVersion);
        sendJson(res, 200, { ...library, version: status.version });
      } catch (error) {
        sendJson(res, 500, {
          error: "LIBRARY_SCAN_FAILED",
          message: error instanceof Error ? error.message : "Unknown scan error"
        });
      }
      return true;
    }

    if (requestUrl.pathname === "/api/library/upload" && req.method === "POST") {
      try {
        const form = await readUploadForm(req, requestUrl);
        const result = await uploadLibraryFiles({ ...form, libraryDir });
        const status = state.markChanged();
        sendJson(res, 200, { ...result, version: status.version });
      } catch (error) {
        sendJson(res, getLibraryErrorStatus(error), {
          error: "LIBRARY_UPLOAD_FAILED",
          message: error instanceof Error ? error.message : "Unknown upload error"
        });
      }
      return true;
    }

    if (requestUrl.pathname === "/api/library/folder" && req.method === "POST") {
      try {
        const payload = await readJsonBody(req, requestUrl);
        const result = await createLibraryFolder({ ...payload, libraryDir });
        const status = state.markChanged();
        sendJson(res, 200, { ...result, version: status.version });
      } catch (error) {
        sendJson(res, getLibraryErrorStatus(error), {
          error: "LIBRARY_CREATE_FOLDER_FAILED",
          message: error instanceof Error ? error.message : "Unknown folder creation error"
        });
      }
      return true;
    }

    if (requestUrl.pathname === "/api/library/move" && req.method === "POST") {
      try {
        const payload = await readJsonBody(req, requestUrl);
        const result = await moveLibraryEntry({ ...payload, libraryDir, metaPath });
        const status = result.changed ? state.markChanged() : state.getStatus();
        sendJson(res, 200, { ...result, version: status.version });
      } catch (error) {
        sendJson(res, getLibraryErrorStatus(error), {
          error: "LIBRARY_MOVE_FAILED",
          message: error instanceof Error ? error.message : "Unknown move error"
        });
      }
      return true;
    }

    if (requestUrl.pathname === "/api/library/rename" && req.method === "POST") {
      try {
        const payload = await readJsonBody(req, requestUrl);
        const result = await renameLibraryEntry({ ...payload, libraryDir, metaPath });
        const status = result.changed ? state.markChanged() : state.getStatus();
        sendJson(res, 200, { ...result, version: status.version });
      } catch (error) {
        sendJson(res, getLibraryErrorStatus(error), {
          error: "LIBRARY_RENAME_FAILED",
          message: error instanceof Error ? error.message : "Unknown rename error"
        });
      }
      return true;
    }

    if (requestUrl.pathname === "/api/library/delete" && req.method === "POST") {
      try {
        const payload = await readJsonBody(req, requestUrl);
        const result = await deleteLibraryEntry({ ...payload, libraryDir, metaPath });
        const status = state.markChanged();
        sendJson(res, 200, { ...result, version: status.version });
      } catch (error) {
        sendJson(res, getLibraryErrorStatus(error), {
          error: "LIBRARY_DELETE_FAILED",
          message: error instanceof Error ? error.message : "Unknown deletion error"
        });
      }
      return true;
    }

    if (requestUrl.pathname === "/api/library/content" && req.method === "PUT") {
      try {
        const payload = await readJsonBody(req, requestUrl);
        const result = await writeContent({ ...payload, libraryDir });
        const status = state.markChanged();
        sendJson(res, 200, { ...result, version: status.version });
      } catch (error) {
        sendJson(res, getLibraryErrorStatus(error), {
          error: "LIBRARY_CONTENT_WRITE_FAILED",
          message: error instanceof Error ? error.message : "Unknown content write error"
        });
      }
      return true;
    }

    if (requestUrl.pathname === "/api/library/reveal" && req.method === "POST") {
      try {
        const payload = await readJsonBody(req, requestUrl);
        const result = await revealPath({ ...payload, libraryDir });
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, getLibraryErrorStatus(error), {
          error: "LIBRARY_REVEAL_FAILED",
          message: error instanceof Error ? error.message : "Unknown reveal error"
        });
      }
      return true;
    }

    if (requestUrl.pathname === "/api/library/open" && req.method === "POST") {
      try {
        const payload = await readJsonBody(req, requestUrl);
        const result = await openFile({ ...payload, libraryDir });
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, getLibraryErrorStatus(error), {
          error: "LIBRARY_OPEN_FILE_FAILED",
          message: error instanceof Error ? error.message : "Unknown file open error"
        });
      }
      return true;
    }

    if (requestUrl.pathname.startsWith("/files/")) {
      const relativePath = requestUrl.pathname.slice("/files/".length);
      const absolutePath = resolveLibraryFile(relativePath, libraryDir);
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
  };
}

export const handleApi = createApiHandler({ libraryState });

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
  await watchLibraryChanges({
    onChange: () => {
      libraryState.markChanged();
    }
  });

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start();
}
