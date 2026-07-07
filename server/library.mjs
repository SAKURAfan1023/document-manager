import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_LIBRARY_DIR = path.join(ROOT_DIR, "library");
const DEFAULT_META_PATH = path.join(ROOT_DIR, "library.meta.json");

const KIND_BY_EXTENSION = new Map([
  [".html", "html"],
  [".htm", "html"],
  [".pdf", "pdf"],
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".gif", "image"],
  [".webp", "image"],
  [".svg", "image"],
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".txt", "text"],
  [".log", "text"],
  [".csv", "text"],
  [".json", "text"],
  [".xml", "text"],
  [".yaml", "text"],
  [".yml", "text"]
]);

export function getKind(extension) {
  return KIND_BY_EXTENSION.get(extension.toLowerCase()) ?? "other";
}

export function encodeFileUrl(relativePath) {
  return `/files/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

function titleFromFileName(fileName) {
  const parsed = path.parse(fileName);
  return parsed.name.replace(/[_-]+/g, " ").trim() || fileName;
}

async function readTextHead(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function extractReadableTitle(filePath, kind) {
  if (kind !== "html" && kind !== "markdown") {
    return null;
  }

  try {
    const head = await readTextHead(filePath);
    if (kind === "html") {
      const match = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      return match?.[1]?.replace(/\s+/g, " ").trim() || null;
    }

    const heading = head.match(/^#\s+(.+)$/m);
    return heading?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

async function readMeta(metaPath) {
  try {
    const content = await fs.readFile(metaPath, "utf8");
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? parsed : { items: {} };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { items: {} };
    }
    throw error;
  }
}

function applyMeta(item, metaEntry) {
  if (!metaEntry || typeof metaEntry !== "object") {
    return item;
  }

  return {
    ...item,
    title: typeof metaEntry.title === "string" && metaEntry.title.trim() ? metaEntry.title.trim() : item.title,
    tags: Array.isArray(metaEntry.tags) ? metaEntry.tags.filter((tag) => typeof tag === "string") : item.tags,
    order: Number.isFinite(metaEntry.order) ? metaEntry.order : item.order
  };
}

function compareItems(a, b) {
  const orderA = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
  const orderB = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) {
    return orderA - orderB;
  }

  const pathCompare = a.topicPath.join("/").localeCompare(b.topicPath.join("/"), "zh-CN");
  if (pathCompare !== 0) {
    return pathCompare;
  }

  return a.title.localeCompare(b.title, "zh-CN");
}

function buildTree(items) {
  const root = {
    name: "全部文件",
    path: "",
    children: [],
    count: items.length
  };
  const nodeByPath = new Map([["", root]]);

  for (const item of items) {
    let currentPath = "";
    for (const part of item.topicPath) {
      const nextPath = currentPath ? `${currentPath}/${part}` : part;
      if (!nodeByPath.has(nextPath)) {
        const node = {
          name: part,
          path: nextPath,
          children: [],
          count: 0
        };
        nodeByPath.set(nextPath, node);
        nodeByPath.get(currentPath).children.push(node);
      }
      nodeByPath.get(nextPath).count += 1;
      currentPath = nextPath;
    }
  }

  for (const node of nodeByPath.values()) {
    node.children.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  return root;
}

async function walkDirectory({ libraryDir, currentDir, topicPath, meta }) {
  let entries = [];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const itemGroups = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith(".")) {
      return [];
    }

    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      return walkDirectory({
        libraryDir,
        currentDir: absolutePath,
        topicPath: [...topicPath, entry.name],
        meta
      });
    }

    if (!entry.isFile()) {
      return [];
    }

    const relativePath = normalizeRelativePath(path.relative(libraryDir, absolutePath));
    const metaEntry = meta.items?.[relativePath];
    if (metaEntry?.hidden === true) {
      return [];
    }

    const stat = await fs.stat(absolutePath);
    const extension = path.extname(entry.name).toLowerCase();
    const kind = getKind(extension);
    const readableTitle = await extractReadableTitle(absolutePath, kind);
    const item = applyMeta({
      id: relativePath,
      title: readableTitle || titleFromFileName(entry.name),
      relativePath,
      url: encodeFileUrl(relativePath),
      extension: extension.replace(".", ""),
      kind,
      topicPath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      tags: [],
      order: undefined
    }, metaEntry);

    return [item];
  }));

  return itemGroups.flat();
}

export async function scanLibrary(options = {}) {
  const libraryDir = path.resolve(options.libraryDir ?? DEFAULT_LIBRARY_DIR);
  const metaPath = path.resolve(options.metaPath ?? DEFAULT_META_PATH);
  await fs.mkdir(libraryDir, { recursive: true });

  const meta = await readMeta(metaPath);
  const items = await walkDirectory({
    libraryDir,
    currentDir: libraryDir,
    topicPath: [],
    meta
  });

  items.sort(compareItems);

  return {
    generatedAt: new Date().toISOString(),
    root: libraryDir,
    tree: buildTree(items),
    items
  };
}

export function resolveLibraryFile(relativeUrlPath, libraryDir = DEFAULT_LIBRARY_DIR) {
  const decoded = decodeURIComponent(relativeUrlPath || "");
  const normalized = decoded.split("/").filter(Boolean).join(path.sep);
  const root = path.resolve(libraryDir);
  const absolutePath = path.resolve(root, normalized);
  const insideRoot = absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`);

  if (!insideRoot) {
    return null;
  }

  return absolutePath;
}
