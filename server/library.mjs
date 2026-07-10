import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_LIBRARY_DIR = path.join(ROOT_DIR, "library");
export const DEFAULT_META_PATH = path.join(ROOT_DIR, "library.meta.json");

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

const WPS_OPEN_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".dot",
  ".dotx",
  ".dps",
  ".dpt",
  ".et",
  ".ett",
  ".pot",
  ".potx",
  ".pps",
  ".ppsx",
  ".ppt",
  ".pptx",
  ".rtf",
  ".wps",
  ".wpt",
  ".xls",
  ".xlsm",
  ".xlsx",
  ".xlt",
  ".xltx"
]);

const EDITABLE_TEXT_EXTENSIONS = new Set([".html", ".htm", ".md", ".markdown"]);

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

function getErrorStatus(error, fallback = 500) {
  return Number.isInteger(error?.statusCode) ? error.statusCode : fallback;
}

function createLibraryError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeUploadFileName(fileName) {
  const baseName = path.basename(fileName || "").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "").trim();
  if (!baseName || baseName.startsWith(".")) {
    return null;
  }
  return baseName;
}

function sanitizeFolderName(folderName) {
  const baseName = path.basename(folderName || "").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "").trim();
  if (!baseName || baseName === "." || baseName === ".." || baseName.startsWith(".")) {
    return null;
  }
  return baseName;
}

function sanitizeEntryName(entryName, isDirectory) {
  return isDirectory ? sanitizeFolderName(entryName) : sanitizeUploadFileName(entryName);
}

async function resolveAvailableFilePath(targetDir, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(targetDir, fileName);
  let index = 2;

  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(targetDir, `${parsed.name} ${index}${parsed.ext}`);
      index += 1;
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return candidate;
      }
      throw error;
    }
  }
}

async function resolveAvailableDirectoryPath(targetDir, folderName) {
  let candidate = path.join(targetDir, folderName);
  let index = 2;

  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(targetDir, `${folderName} ${index}`);
      index += 1;
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return candidate;
      }
      throw error;
    }
  }
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

async function writeMeta(metaPath, meta) {
  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
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

function buildTree(items, folderPaths = []) {
  const root = {
    name: "全部文件",
    path: "",
    children: [],
    count: items.length
  };
  const nodeByPath = new Map([["", root]]);

  const ensureNode = (folderPath) => {
    let currentPath = "";
    for (const part of folderPath.split("/").filter(Boolean)) {
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
      currentPath = nextPath;
    }
  };

  for (const folderPath of folderPaths) {
    ensureNode(folderPath);
  }

  for (const item of items) {
    let currentPath = "";
    for (const part of item.topicPath) {
      const nextPath = currentPath ? `${currentPath}/${part}` : part;
      ensureNode(nextPath);
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
      return { folders: [], items: [] };
    }
    throw error;
  }

  const itemGroups = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith(".")) {
      return { folders: [], items: [] };
    }

    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const relativePath = normalizeRelativePath(path.relative(libraryDir, absolutePath));
      const nested = await walkDirectory({
        libraryDir,
        currentDir: absolutePath,
        topicPath: [...topicPath, entry.name],
        meta
      });
      return {
        folders: [relativePath, ...nested.folders],
        items: nested.items
      };
    }

    if (!entry.isFile()) {
      return { folders: [], items: [] };
    }

    const relativePath = normalizeRelativePath(path.relative(libraryDir, absolutePath));
    const metaEntry = meta.items?.[relativePath];
    if (metaEntry?.hidden === true) {
      return { folders: [], items: [] };
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

    return { folders: [], items: [item] };
  }));

  return {
    folders: itemGroups.flatMap((group) => group.folders),
    items: itemGroups.flatMap((group) => group.items)
  };
}

export async function scanLibrary(options = {}) {
  const libraryDir = path.resolve(options.libraryDir ?? DEFAULT_LIBRARY_DIR);
  const metaPath = path.resolve(options.metaPath ?? DEFAULT_META_PATH);
  await fs.mkdir(libraryDir, { recursive: true });

  const meta = await readMeta(metaPath);
  const { folders, items } = await walkDirectory({
    libraryDir,
    currentDir: libraryDir,
    topicPath: [],
    meta
  });

  items.sort(compareItems);

  return {
    generatedAt: new Date().toISOString(),
    root: libraryDir,
    tree: buildTree(items, folders),
    items
  };
}

export function createLibraryIndexState() {
  let changed = false;
  let version = 0;
  let changedAt = null;

  const getStatus = () => ({ changed, version, changedAt });

  return {
    getStatus,
    markChanged() {
      changed = true;
      version += 1;
      changedAt = new Date().toISOString();
      return getStatus();
    },
    markScanned(scanVersion) {
      if (version === scanVersion) {
        changed = false;
        changedAt = null;
      }
      return getStatus();
    }
  };
}

export function resolveLibraryDirectory(relativePath = "", libraryDir = DEFAULT_LIBRARY_DIR) {
  const normalized = String(relativePath)
    .split("/")
    .filter(Boolean)
    .join(path.sep);
  const root = path.resolve(libraryDir);
  const absolutePath = path.resolve(root, normalized);
  const insideRoot = absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`);

  if (!insideRoot) {
    return null;
  }

  return absolutePath;
}

function resolveLibraryEntry(relativePath = "", libraryDir = DEFAULT_LIBRARY_DIR) {
  const normalized = String(relativePath)
    .split("/")
    .filter(Boolean)
    .join(path.sep);
  const root = path.resolve(libraryDir);
  const absolutePath = path.resolve(root, normalized);
  const insideRoot = absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`);

  if (!insideRoot) {
    return null;
  }

  return absolutePath;
}

function revealInFileManager(absolutePath, kind) {
  const showFolder = kind === "folder";
  let command;
  let args;

  if (process.platform === "darwin") {
    command = "open";
    args = showFolder ? [absolutePath] : ["-R", absolutePath];
  } else if (process.platform === "win32") {
    command = "explorer.exe";
    args = showFolder ? [absolutePath] : [`/select,${absolutePath}`];
  } else {
    command = "xdg-open";
    args = [showFolder ? absolutePath : path.dirname(absolutePath)];
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function launchExternalFile(absolutePath, mode) {
  let command;
  let args;

  if (mode === "wps") {
    if (process.platform === "darwin") {
      command = "open";
      args = ["-a", "WPS Office", absolutePath];
    } else if (process.platform === "win32") {
      command = "cmd.exe";
      args = ["/c", "start", "", "wps", absolutePath];
    } else {
      command = "wps";
      args = [absolutePath];
    }
  } else if (process.platform === "darwin") {
    command = "open";
    args = [absolutePath];
  } else if (process.platform === "win32") {
    command = "cmd.exe";
    args = ["/c", "start", "", absolutePath];
  } else {
    command = "xdg-open";
    args = [absolutePath];
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.on("error", () => {});
  child.unref();
}

export async function uploadLibraryFiles(options = {}) {
  const libraryDir = path.resolve(options.libraryDir ?? DEFAULT_LIBRARY_DIR);
  const targetDir = resolveLibraryDirectory(options.targetPath ?? "", libraryDir);
  const files = Array.isArray(options.files) ? options.files : [];

  if (!targetDir) {
    throw createLibraryError("上传目录不在 library 内", 403);
  }

  await fs.mkdir(targetDir, { recursive: true });

  const uploaded = [];
  for (const file of files) {
    const fileName = sanitizeUploadFileName(file?.name);
    if (!fileName || !file?.content) {
      continue;
    }

    const destination = await resolveAvailableFilePath(targetDir, fileName);
    await fs.writeFile(destination, file.content);
    const relativePath = normalizeRelativePath(path.relative(libraryDir, destination));
    uploaded.push({
      relativePath,
      title: titleFromFileName(path.basename(destination))
    });
  }

  if (!uploaded.length) {
    throw createLibraryError("没有可上传的文件", 400);
  }

  return { uploaded };
}

export async function writeLibraryContent(options = {}) {
  const libraryDir = path.resolve(options.libraryDir ?? DEFAULT_LIBRARY_DIR);
  const relativePath = typeof options.relativePath === "string" ? options.relativePath : "";
  const content = options.content;
  const absolutePath = resolveLibraryFile(relativePath, libraryDir);

  if (!absolutePath) {
    throw createLibraryError("文件路径不在 library 内", 403);
  }

  if (!EDITABLE_TEXT_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
    throw createLibraryError("仅支持编辑 HTML 和 Markdown 文件", 400);
  }

  if (typeof content !== "string") {
    throw createLibraryError("文件内容必须是文本", 400);
  }

  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw createLibraryError("文件不存在", 404);
    }
    throw error;
  }

  if (!stat.isFile()) {
    throw createLibraryError("目标不是文件", 400);
  }

  await fs.writeFile(absolutePath, content, "utf8");
  const updatedStat = await fs.stat(absolutePath);

  return {
    content: {
      relativePath,
      mtimeMs: updatedStat.mtimeMs
    }
  };
}

export async function createLibraryFolder(options = {}) {
  const libraryDir = path.resolve(options.libraryDir ?? DEFAULT_LIBRARY_DIR);
  const parentDir = resolveLibraryDirectory(options.parentPath ?? "", libraryDir);
  const folderName = sanitizeFolderName(options.name);

  if (!parentDir) {
    throw createLibraryError("新建目录不在 library 内", 403);
  }

  if (!folderName) {
    throw createLibraryError("文件夹名称无效", 400);
  }

  let parentStat;
  try {
    parentStat = await fs.stat(parentDir);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw createLibraryError("父目录不存在", 404);
    }
    throw error;
  }

  if (!parentStat.isDirectory()) {
    throw createLibraryError("父路径不是目录", 400);
  }

  const destination = await resolveAvailableDirectoryPath(parentDir, folderName);
  await fs.mkdir(destination);
  const relativePath = normalizeRelativePath(path.relative(libraryDir, destination));

  return {
    folder: {
      relativePath,
      name: path.basename(destination)
    }
  };
}

export async function revealLibraryPath(options = {}) {
  const libraryDir = path.resolve(options.libraryDir ?? DEFAULT_LIBRARY_DIR);
  const kind = options.kind === "folder" ? "folder" : "file";
  const absolutePath = kind === "folder"
    ? resolveLibraryDirectory(options.relativePath ?? "", libraryDir)
    : resolveLibraryEntry(options.relativePath ?? "", libraryDir);

  if (!absolutePath) {
    throw createLibraryError("打开路径不在 library 内", 403);
  }

  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw createLibraryError(kind === "folder" ? "文件夹不存在" : "文件不存在", 404);
    }
    throw error;
  }

  if (kind === "folder" && !stat.isDirectory()) {
    throw createLibraryError("目标不是文件夹", 400);
  }
  if (kind === "file" && !stat.isFile()) {
    throw createLibraryError("目标不是文件", 400);
  }

  const reveal = typeof options.reveal === "function" ? options.reveal : revealInFileManager;
  reveal(absolutePath, kind);

  return {
    revealed: {
      relativePath: normalizeRelativePath(path.relative(libraryDir, absolutePath)),
      kind
    }
  };
}

export async function openLibraryFile(options = {}) {
  const libraryDir = path.resolve(options.libraryDir ?? DEFAULT_LIBRARY_DIR);
  const mode = options.mode === "system" || options.mode === "wps" ? options.mode : null;
  const absolutePath = resolveLibraryEntry(options.relativePath ?? "", libraryDir);

  if (!mode) {
    throw createLibraryError("打开方式无效", 400);
  }

  if (!absolutePath) {
    throw createLibraryError("打开路径不在 library 内", 403);
  }

  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw createLibraryError("文件不存在", 404);
    }
    throw error;
  }

  if (!stat.isFile()) {
    throw createLibraryError("只能打开文件", 400);
  }

  const extension = path.extname(absolutePath).toLowerCase();
  if (mode === "wps" && !WPS_OPEN_EXTENSIONS.has(extension)) {
    throw createLibraryError("WPS 打开仅支持 Office 文档", 400);
  }

  const open = typeof options.open === "function" ? options.open : launchExternalFile;
  open(absolutePath, mode);

  return {
    opened: {
      relativePath: normalizeRelativePath(path.relative(libraryDir, absolutePath)),
      mode
    }
  };
}

export async function moveLibraryEntry(options = {}) {
  const libraryDir = path.resolve(options.libraryDir ?? DEFAULT_LIBRARY_DIR);
  const metaPath = path.resolve(options.metaPath ?? DEFAULT_META_PATH);
  const sourceEntry = resolveLibraryEntry(options.sourcePath ?? "", libraryDir);
  const targetDir = resolveLibraryDirectory(options.targetPath ?? "", libraryDir);

  if (!sourceEntry || !targetDir) {
    throw createLibraryError("移动路径不在 library 内", 403);
  }

  let sourceStat;
  try {
    sourceStat = await fs.stat(sourceEntry);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw createLibraryError("源条目不存在", 404);
    }
    throw error;
  }

  const isDirectory = sourceStat.isDirectory();
  if (!sourceStat.isFile() && !isDirectory) {
    throw createLibraryError("只能移动文件或文件夹", 400);
  }

  let targetStat;
  try {
    targetStat = await fs.stat(targetDir);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw createLibraryError("目标目录不存在", 404);
    }
    throw error;
  }

  if (!targetStat.isDirectory()) {
    throw createLibraryError("目标不是目录", 400);
  }

  const sourceDir = path.dirname(sourceEntry);
  const sourceRelativePath = normalizeRelativePath(path.relative(libraryDir, sourceEntry));
  if (isDirectory && !sourceRelativePath) {
    throw createLibraryError("不能移动 library 根目录", 400);
  }

  if (isDirectory && (targetDir === sourceEntry || targetDir.startsWith(`${sourceEntry}${path.sep}`))) {
    throw createLibraryError("不能将文件夹移动到自身或其子目录", 400);
  }

  if (sourceDir === targetDir) {
    return {
      moved: {
        relativePath: sourceRelativePath,
        title: isDirectory ? path.basename(sourceEntry) : titleFromFileName(path.basename(sourceEntry)),
        kind: isDirectory ? "folder" : "file"
      },
      changed: false
    };
  }

  const destination = isDirectory
    ? await resolveAvailableDirectoryPath(targetDir, path.basename(sourceEntry))
    : await resolveAvailableFilePath(targetDir, path.basename(sourceEntry));
  await fs.rename(sourceEntry, destination);

  const movedRelativePath = normalizeRelativePath(path.relative(libraryDir, destination));
  const meta = await readMeta(metaPath);
  if (meta.items && typeof meta.items === "object") {
    const sourcePrefix = `${sourceRelativePath}/`;
    let metaChanged = false;
    for (const [itemPath, metaEntry] of Object.entries(meta.items)) {
      if (itemPath === sourceRelativePath || (isDirectory && itemPath.startsWith(sourcePrefix))) {
        const suffix = itemPath.slice(sourceRelativePath.length);
        meta.items[`${movedRelativePath}${suffix}`] = metaEntry;
        delete meta.items[itemPath];
        metaChanged = true;
      }
    }
    if (metaChanged) {
      await writeMeta(metaPath, meta);
    }
  }

  return {
    moved: {
      relativePath: movedRelativePath,
      title: isDirectory ? path.basename(destination) : titleFromFileName(path.basename(destination)),
      kind: isDirectory ? "folder" : "file"
    },
    changed: true
  };
}

export async function renameLibraryEntry(options = {}) {
  const libraryDir = path.resolve(options.libraryDir ?? DEFAULT_LIBRARY_DIR);
  const metaPath = path.resolve(options.metaPath ?? DEFAULT_META_PATH);
  const sourceEntry = resolveLibraryEntry(options.relativePath ?? "", libraryDir);

  if (!sourceEntry) {
    throw createLibraryError("重命名路径不在 library 内", 403);
  }

  let sourceStat;
  try {
    sourceStat = await fs.stat(sourceEntry);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw createLibraryError("重命名目标不存在", 404);
    }
    throw error;
  }

  const isDirectory = sourceStat.isDirectory();
  if (!sourceStat.isFile() && !isDirectory) {
    throw createLibraryError("只能重命名文件或文件夹", 400);
  }

  const sourceRelativePath = normalizeRelativePath(path.relative(libraryDir, sourceEntry));
  if (!sourceRelativePath && isDirectory) {
    throw createLibraryError("不能重命名 library 根目录", 400);
  }

  const name = sanitizeEntryName(options.name ?? "", isDirectory);
  if (!name) {
    throw createLibraryError(`${isDirectory ? "文件夹" : "文件"}名称无效`, 400);
  }

  const destination = path.join(path.dirname(sourceEntry), name);
  if (destination === sourceEntry) {
    return {
      renamed: {
        previousRelativePath: sourceRelativePath,
        relativePath: sourceRelativePath,
        title: isDirectory ? path.basename(sourceEntry) : titleFromFileName(path.basename(sourceEntry)),
        kind: isDirectory ? "folder" : "file"
      },
      changed: false
    };
  }

  try {
    await fs.access(destination);
    throw createLibraryError("同级目录中已存在同名文件或文件夹", 409);
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.rename(sourceEntry, destination);
  const renamedRelativePath = normalizeRelativePath(path.relative(libraryDir, destination));
  const meta = await readMeta(metaPath);
  if (meta.items && typeof meta.items === "object") {
    const sourcePrefix = `${sourceRelativePath}/`;
    let metaChanged = false;
    for (const [itemPath, metaEntry] of Object.entries(meta.items)) {
      if (itemPath === sourceRelativePath || (isDirectory && itemPath.startsWith(sourcePrefix))) {
        const suffix = itemPath.slice(sourceRelativePath.length);
        meta.items[`${renamedRelativePath}${suffix}`] = metaEntry;
        delete meta.items[itemPath];
        metaChanged = true;
      }
    }
    if (metaChanged) {
      await writeMeta(metaPath, meta);
    }
  }

  return {
    renamed: {
      previousRelativePath: sourceRelativePath,
      relativePath: renamedRelativePath,
      title: isDirectory ? path.basename(destination) : titleFromFileName(path.basename(destination)),
      kind: isDirectory ? "folder" : "file"
    },
    changed: true
  };
}

export async function deleteLibraryEntry(options = {}) {
  const libraryDir = path.resolve(options.libraryDir ?? DEFAULT_LIBRARY_DIR);
  const metaPath = path.resolve(options.metaPath ?? DEFAULT_META_PATH);
  const sourceEntry = resolveLibraryEntry(options.relativePath ?? "", libraryDir);

  if (!sourceEntry) {
    throw createLibraryError("删除路径不在 library 内", 403);
  }

  let sourceStat;
  try {
    sourceStat = await fs.stat(sourceEntry);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw createLibraryError("删除目标不存在", 404);
    }
    throw error;
  }

  const isDirectory = sourceStat.isDirectory();
  if (!sourceStat.isFile() && !isDirectory) {
    throw createLibraryError("只能删除文件或文件夹", 400);
  }

  const relativePath = normalizeRelativePath(path.relative(libraryDir, sourceEntry));
  if (!relativePath && isDirectory) {
    throw createLibraryError("不能删除 library 根目录", 400);
  }

  if (isDirectory) {
    await fs.rm(sourceEntry, { recursive: true });
  } else {
    await fs.rm(sourceEntry);
  }

  const meta = await readMeta(metaPath);
  if (meta.items && typeof meta.items === "object") {
    const prefix = `${relativePath}/`;
    let metaChanged = false;
    for (const itemPath of Object.keys(meta.items)) {
      if (itemPath === relativePath || (isDirectory && itemPath.startsWith(prefix))) {
        delete meta.items[itemPath];
        metaChanged = true;
      }
    }
    if (metaChanged) {
      await writeMeta(metaPath, meta);
    }
  }

  return {
    deleted: {
      relativePath,
      title: isDirectory ? path.basename(sourceEntry) : titleFromFileName(path.basename(sourceEntry)),
      kind: isDirectory ? "folder" : "file"
    }
  };
}

export async function watchLibraryChanges(options = {}) {
  const libraryDir = path.resolve(options.libraryDir ?? DEFAULT_LIBRARY_DIR);
  const metaPath = path.resolve(options.metaPath ?? DEFAULT_META_PATH);
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
  const watchers = [];

  await fs.mkdir(libraryDir, { recursive: true });

  const watchTarget = (target, watchOptions = {}) => {
    try {
      const watcher = watch(target, watchOptions, (_eventType, fileName) => {
        if (typeof fileName === "string" && path.basename(fileName).startsWith(".")) {
          return;
        }
        onChange();
      });
      watcher.on("error", () => {});
      watchers.push(watcher);
      return true;
    } catch {
      return false;
    }
  };

  if (!watchTarget(libraryDir, { recursive: true })) {
    watchTarget(libraryDir);
  }
  watchTarget(metaPath);

  return () => {
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}

export function getLibraryErrorStatus(error, fallback = 500) {
  return getErrorStatus(error, fallback);
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
