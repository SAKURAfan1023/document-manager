import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  File,
  FileArchive,
  FileBadge,
  FileCode,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  Folder,
  FolderPlus,
  Home,
  ListFilter,
  Menu,
  Presentation,
  RefreshCw,
  Search,
  Tags,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { AnimatePresence, LazyMotion, domMax, m, useReducedMotion } from "framer-motion";
import {
  Component,
  createContext,
  Suspense,
  use,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { createPortal } from "react-dom";
import type { Transition } from "framer-motion";
import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import type {
  LibraryCreateFolderResponse,
  LibraryDeleteEntryResponse,
  LibraryItem,
  LibraryKind,
  LibraryMoveResponse,
  LibraryNativeOpenMode,
  LibraryOpenResponse,
  LibraryNode,
  LibraryRevealResponse,
  LibraryResponse,
  LibraryStatusResponse,
  LibraryUploadResponse,
  SortMode
} from "./types";

type TopicOption = {
  path: string;
  name: string;
  count: number;
  depth: number;
};

type UploadState = {
  status: "idle" | "dragging" | "uploading" | "moving" | "creating" | "deleting" | "success" | "error";
  targetPath: string;
  message: string;
};

type TreeDisplayMode = "folders" | "all";
type TreeDragAction = "upload" | "move";
type ExternalOpenMode = "tab" | LibraryNativeOpenMode;
type OpenModeDefaults = Partial<Record<FileVisualKind, ExternalOpenMode>>;

type DragTargetState = {
  path: string;
  action: TreeDragAction;
};

type TreeContextTarget =
  | {
    kind: "folder";
    path: string;
    label: string;
  }
  | {
    kind: "file";
    path: string;
    parentPath: string;
    label: string;
  };

type TreeContextMenuState = {
  x: number;
  y: number;
  target: TreeContextTarget;
};

type TreeFileDragPayload = {
  relativePath: string;
};

type SidebarResizeState = {
  pointerId: number;
  startWidth: number;
  startX: number;
};

type TreeCollapseStorage = {
  collapsed: Set<string>;
  hasStoredState: boolean;
  known: Set<string>;
};

type SelectOption<TValue extends string> = {
  value: TValue;
  label: string;
};

type FileVisualKind = "archive" | "html" | "image" | "markdown" | "other" | "pdf" | "presentation" | "sheet" | "text" | "word";
type DetailTagId = "childFolders" | "custom" | "fileCount" | "kind" | "location" | "modified" | "size";
type DetailTag = {
  id: DetailTagId;
  label: string;
};

type HoverTooltipContextValue = {
  hide: () => void;
  show: (text: string) => void;
  setAnchor: (anchor: HoverTooltipAnchor | null) => void;
};

type HoverTooltipAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
  panelPlacement: "top" | "bottom";
};

const KIND_LABELS: Record<LibraryKind | "all", string> = {
  all: "全部",
  html: "HTML",
  pdf: "PDF",
  image: "图片",
  markdown: "Markdown",
  text: "文本",
  other: "其他"
};

const KIND_OPTIONS: Array<LibraryKind | "all"> = ["all", "html", "pdf", "image", "markdown", "text", "other"];
const SORT_OPTIONS: Array<SelectOption<SortMode>> = [
  { value: "library", label: "目录顺序" },
  { value: "recent", label: "最近更新" },
  { value: "title", label: "标题排序" },
  { value: "type", label: "类型排序" }
];
const EXTERNAL_OPEN_MODE_LABELS: Record<ExternalOpenMode, string> = {
  tab: "新标签页",
  system: "系统默认应用",
  wps: "WPS"
};
const DETAIL_TAG_OPTIONS: Array<SelectOption<DetailTagId>> = [
  { value: "kind", label: "类型" },
  { value: "location", label: "位置" },
  { value: "size", label: "大小" },
  { value: "modified", label: "更新时间" },
  { value: "fileCount", label: "文件数量" },
  { value: "childFolders", label: "子文件夹" },
  { value: "custom", label: "自定义标签" }
];
const DETAIL_TAG_IDS = new Set<DetailTagId>(DETAIL_TAG_OPTIONS.map((option) => option.value));
const DEFAULT_DETAIL_TAGS = new Set<DetailTagId>(DETAIL_TAG_OPTIONS.map((option) => option.value));
const EMPTY_ITEMS: LibraryItem[] = [];
const EMPTY_NODES: LibraryNode[] = [];
const EMPTY_TOPICS: TopicOption[] = [];
const TREE_FILE_DRAG_TYPE = "application/x-document-gallery-file+json";
const LOCATION_CHANGE_EVENT = "document-gallery-location-change";
const WPS_TEXT_EXTENSIONS = new Set(["doc", "docx", "dot", "dotx", "rtf", "wps", "wpt"]);
const WPS_SHEET_EXTENSIONS = new Set(["et", "ett", "xls", "xlsx", "xlsm", "xlt", "xltx"]);
const WPS_PRESENTATION_EXTENSIONS = new Set(["dps", "dpt", "pot", "potx", "pps", "ppsx", "ppt", "pptx"]);
const ARCHIVE_EXTENSIONS = new Set(["7z", "bz2", "gz", "rar", "tar", "tgz", "xz", "zip"]);
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "ico", "jpeg", "jpg", "pic", "png", "svg", "tif", "tiff", "webp"]);
const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 480;
const LIBRARY_REFRESH_INTERVAL_MS = 30_000;
const DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});
const TEXT_CONTENT_CACHE = new Map<string, Promise<string>>();
const TREE_COLLAPSE_STORAGE_KEY = "document-gallery-tree-collapse-state";
const SIDEBAR_WIDTH_STORAGE_KEY = "document-gallery-sidebar-width";
const READER_CONTROLS_STORAGE_KEY = "document-gallery-reader-controls-position";
const FILE_OPEN_DEFAULTS_STORAGE_KEY = "document-gallery-file-open-defaults";
const DETAIL_TAGS_STORAGE_KEY = "document-gallery-visible-detail-tags";
const TREE_CONTEXT_MENU_WIDTH = 232;
const TREE_CONTEXT_MENU_HEIGHT = 384;
const READER_FLOAT_SIZE = 56;
const READER_PANEL_HEIGHT = 76;
const READER_PANEL_MOBILE_HEIGHT = 124;
const READER_PANEL_MAX_WIDTH = 720;
const READER_PANEL_MARGIN = 24;
const READER_DRAG_THRESHOLD = 4;
const MOTION_EASE_OUT = [0.22, 1, 0.36, 1] as const;

type Point = {
  x: number;
  y: number;
};

type ViewportSize = {
  width: number;
  height: number;
};

type ReaderPanelPlacement = "top" | "bottom";

type StoredReaderControlState = {
  position: Point;
  panelPlacement: ReaderPanelPlacement | null;
};

const HoverTooltipContext = createContext<HoverTooltipContextValue>({
  hide: () => {},
  show: () => {},
  setAnchor: () => {}
});

type MarkdownBlock =
  | { type: "h1" | "h2" | "h3" | "p"; text: string }
  | { type: "ul"; items: string[] };

type TextPreviewBoundaryProps = {
  children: React.ReactNode;
  resetKey: string;
};

type TextPreviewBoundaryState = {
  error: string | null;
  resetKey: string;
};

class TextPreviewErrorBoundary extends Component<TextPreviewBoundaryProps, TextPreviewBoundaryState> {
  state: TextPreviewBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(props: TextPreviewBoundaryProps, state: TextPreviewBoundaryState) {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "读取失败" };
  }

  render() {
    if (this.state.error) {
      return <div className="text-preview error">{this.state.error}</div>;
    }

    return this.props.children;
  }
}

function getSelectedPathFromLocation() {
  return new URLSearchParams(window.location.search).get("file");
}

function subscribeSelectedPath(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(LOCATION_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(LOCATION_CHANGE_EVENT, onStoreChange);
  };
}

function setSelectedPathInLocation(relativePath: string | null) {
  const url = new URL(window.location.href);
  if (relativePath) {
    url.searchParams.set("file", relativePath);
  } else {
    url.searchParams.delete("file");
  }
  window.history.pushState({}, "", url);
  window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
}

function formatSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(ms: number) {
  return DATE_FORMATTER.format(new Date(ms));
}

function getViewportSize(): ViewportSize {
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function areSetsEqual<TValue>(first: Set<TValue>, second: Set<TValue>) {
  if (first.size !== second.size) {
    return false;
  }
  for (const value of first) {
    if (!second.has(value)) {
      return false;
    }
  }
  return true;
}

function collectFolderPaths(node: LibraryNode) {
  const paths: string[] = [];
  const visit = (current: LibraryNode, isRoot = false) => {
    if (isRoot || current.path) {
      paths.push(current.path);
    }
    for (const child of current.children) {
      visit(child);
    }
  };
  visit(node, true);
  return paths;
}

function readTreeCollapseStorage(): TreeCollapseStorage {
  if (typeof window === "undefined") {
    return { collapsed: new Set(), hasStoredState: false, known: new Set() };
  }

  try {
    const raw = window.localStorage.getItem(TREE_COLLAPSE_STORAGE_KEY);
    if (!raw) {
      return { collapsed: new Set(), hasStoredState: false, known: new Set() };
    }
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const collapsed = new Set(parsed.filter((path): path is string => typeof path === "string"));
      return { collapsed, hasStoredState: true, known: new Set(collapsed) };
    }
    if (!parsed || typeof parsed !== "object") {
      return { collapsed: new Set(), hasStoredState: false, known: new Set() };
    }
    const value = parsed as { collapsed?: unknown; known?: unknown };
    const collapsed = Array.isArray(value.collapsed)
      ? new Set(value.collapsed.filter((path): path is string => typeof path === "string"))
      : new Set<string>();
    const known = Array.isArray(value.known)
      ? new Set(value.known.filter((path): path is string => typeof path === "string"))
      : new Set(collapsed);
    return { collapsed, hasStoredState: true, known };
  } catch {
    return { collapsed: new Set(), hasStoredState: false, known: new Set() };
  }
}

function writeTreeCollapseStorage(collapsed: Set<string>, known: Set<string>) {
  try {
    window.localStorage.setItem(TREE_COLLAPSE_STORAGE_KEY, JSON.stringify({
      collapsed: Array.from(collapsed),
      known: Array.from(known)
    }));
  } catch {
    // Local storage can be unavailable in private windows; the tree still works in-memory.
  }
}

function readStoredSidebarWidth() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const width = Number.parseFloat(raw);
    return Number.isFinite(width) ? clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH) : null;
  } catch {
    return null;
  }
}

function saveSidebarWidth(width: number) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SIDEBAR_WIDTH_STORAGE_KEY,
      String(clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH))
    );
  } catch {
    // Width resizing still works for the current session if storage is unavailable.
  }
}

function isExternalOpenMode(value: unknown): value is ExternalOpenMode {
  return value === "tab" || value === "system" || value === "wps";
}

function readOpenModeDefaults(): OpenModeDefaults {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(FILE_OPEN_DEFAULTS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const defaults: OpenModeDefaults = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isExternalOpenMode(value)) {
        defaults[key as FileVisualKind] = value;
      }
    }
    return defaults;
  } catch {
    return {};
  }
}

function writeOpenModeDefaults(defaults: OpenModeDefaults) {
  try {
    window.localStorage.setItem(FILE_OPEN_DEFAULTS_STORAGE_KEY, JSON.stringify(defaults));
  } catch {
    // Opening still works with the built-in default if storage is unavailable.
  }
}

function readVisibleDetailTags(): Set<DetailTagId> {
  if (typeof window === "undefined") {
    return new Set(DEFAULT_DETAIL_TAGS);
  }

  try {
    const raw = window.localStorage.getItem(DETAIL_TAGS_STORAGE_KEY);
    if (!raw) {
      return new Set(DEFAULT_DETAIL_TAGS);
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set(DEFAULT_DETAIL_TAGS);
    }
    return new Set(parsed.filter((value): value is DetailTagId => DETAIL_TAG_IDS.has(value as DetailTagId)));
  } catch {
    return new Set(DEFAULT_DETAIL_TAGS);
  }
}

function writeVisibleDetailTags(visibleTags: Set<DetailTagId>) {
  try {
    window.localStorage.setItem(DETAIL_TAGS_STORAGE_KEY, JSON.stringify(Array.from(visibleTags)));
  } catch {
    // Detail cards keep the in-memory selection if storage is unavailable.
  }
}

function getReaderPanelSize(viewport: ViewportSize) {
  return {
    width: Math.max(READER_FLOAT_SIZE, Math.min(READER_PANEL_MAX_WIDTH, viewport.width - READER_PANEL_MARGIN * 2)),
    height: viewport.width <= 640 ? READER_PANEL_MOBILE_HEIGHT : READER_PANEL_HEIGHT
  };
}

function getDefaultReaderControlPosition(viewport = getViewportSize()): Point {
  return {
    x: viewport.width - READER_FLOAT_SIZE - READER_PANEL_MARGIN,
    y: viewport.height - READER_FLOAT_SIZE - READER_PANEL_MARGIN
  };
}

function clampReaderControlPosition(position: Point, viewport = getViewportSize()): Point {
  return {
    x: clamp(position.x, READER_PANEL_MARGIN / 2, viewport.width - READER_FLOAT_SIZE - READER_PANEL_MARGIN / 2),
    y: clamp(position.y, READER_PANEL_MARGIN / 2, viewport.height - READER_FLOAT_SIZE - READER_PANEL_MARGIN / 2)
  };
}

function getReaderPanelPlacement(position: Point, viewport = getViewportSize()): ReaderPanelPlacement {
  return position.y + READER_FLOAT_SIZE / 2 < viewport.height / 2 ? "top" : "bottom";
}

function isReaderPanelPlacement(value: unknown): value is ReaderPanelPlacement {
  return value === "top" || value === "bottom";
}

function readStoredReaderControlState(): StoredReaderControlState | null {
  try {
    const raw = window.localStorage.getItem(READER_CONTROLS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<Point> & { panelPlacement?: unknown };
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return {
        position: { x: parsed.x, y: parsed.y },
        panelPlacement: isReaderPanelPlacement(parsed.panelPlacement) ? parsed.panelPlacement : null
      };
    }
  } catch {
    return null;
  }
  return null;
}

function saveReaderControlState(position: Point, panelPlacement: ReaderPanelPlacement) {
  try {
    window.localStorage.setItem(READER_CONTROLS_STORAGE_KEY, JSON.stringify({ ...position, panelPlacement }));
  } catch {
    // The floating control still works if storage is unavailable.
  }
}

function getReaderControlTarget(
  ballPosition: Point,
  isExpanded: boolean,
  viewport: ViewportSize,
  panelPlacement: ReaderPanelPlacement
) {
  if (!isExpanded) {
    return {
      x: ballPosition.x,
      y: ballPosition.y,
      width: READER_FLOAT_SIZE,
      height: READER_FLOAT_SIZE,
      borderRadius: READER_FLOAT_SIZE / 2
    };
  }

  const panelSize = getReaderPanelSize(viewport);
  return {
    x: Math.round((viewport.width - panelSize.width) / 2),
    y: panelPlacement === "bottom" ? viewport.height - panelSize.height - READER_PANEL_MARGIN : READER_PANEL_MARGIN,
    width: panelSize.width,
    height: panelSize.height,
    borderRadius: panelSize.height / 2
  };
}

function topicLabel(topicPath: string[]) {
  return topicPath.length ? topicPath.join(" / ") : "根目录";
}

function flattenTopics(node: LibraryNode, depth = 0): TopicOption[] {
  const current = {
    path: node.path,
    name: node.path ? node.name : "全部主题",
    count: node.count,
    depth
  };
  return [current, ...node.children.flatMap((child) => flattenTopics(child, depth + 1))];
}

function findTreeNodeByPath(node: LibraryNode, targetPath: string): LibraryNode | null {
  if (node.path === targetPath) {
    return node;
  }
  for (const child of node.children) {
    const match = findTreeNodeByPath(child, targetPath);
    if (match) {
      return match;
    }
  }
  return null;
}

function sortItems(items: LibraryItem[], sortMode: SortMode) {
  const copy = [...items];
  if (sortMode === "recent") {
    return copy.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }
  if (sortMode === "title") {
    return copy.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  }
  if (sortMode === "type") {
    return copy.sort((a, b) => {
      const kindCompare = a.kind.localeCompare(b.kind);
      return kindCompare || a.title.localeCompare(b.title, "zh-CN");
    });
  }
  return copy;
}

function isDirectTopicMatch(item: LibraryItem, activeTopic: string) {
  return item.topicPath.join("/") === activeTopic;
}

function matchesQuery(item: LibraryItem, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return [item.title, item.relativePath, ...(item.tags ?? [])]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function folderMatchesQuery(node: LibraryNode, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return [node.name, node.path].join(" ").toLowerCase().includes(normalized);
}

function filterDetailTags(tags: DetailTag[], visibleTags: Set<DetailTagId>) {
  return tags.filter((tag) => visibleTags.has(tag.id));
}

function folderDetailTags(folder: LibraryNode): DetailTag[] {
  return [
    { id: "kind", label: "文件夹" },
    { id: "location", label: folder.path || "根目录" },
    { id: "fileCount", label: `${folder.count} 个文件` },
    { id: "childFolders", label: `${folder.children.length} 个子文件夹` }
  ];
}

function normalizedExtension(item: LibraryItem) {
  return item.extension.trim().toLowerCase();
}

function fileDisplayLabel(item: LibraryItem) {
  const extension = normalizedExtension(item);
  if (WPS_TEXT_EXTENSIONS.has(extension)) {
    return "WPS文字";
  }
  if (WPS_SHEET_EXTENSIONS.has(extension)) {
    return "WPS表格";
  }
  if (WPS_PRESENTATION_EXTENSIONS.has(extension)) {
    return "WPS演示";
  }
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return "压缩包";
  }
  if (item.kind === "pdf") {
    return "PDF";
  }
  if (IMAGE_EXTENSIONS.has(extension) || item.kind === "image") {
    return "图片";
  }
  if (item.kind === "html") {
    return "HTML";
  }
  return KIND_LABELS[item.kind];
}

function fileDetailTags(item: LibraryItem): DetailTag[] {
  return [
    { id: "kind", label: fileDisplayLabel(item) },
    { id: "location", label: topicLabel(item.topicPath) },
    { id: "size", label: formatSize(item.size) },
    { id: "modified", label: formatDate(item.mtimeMs) },
    ...(item.tags ?? []).map((tag) => ({ id: "custom" as const, label: tag }))
  ];
}

function fileVisualKind(item: LibraryItem): FileVisualKind {
  const extension = normalizedExtension(item);
  if (WPS_TEXT_EXTENSIONS.has(extension)) {
    return "word";
  }
  if (WPS_SHEET_EXTENSIONS.has(extension)) {
    return "sheet";
  }
  if (WPS_PRESENTATION_EXTENSIONS.has(extension)) {
    return "presentation";
  }
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return "archive";
  }
  if (item.kind === "pdf") {
    return "pdf";
  }
  if (IMAGE_EXTENSIONS.has(extension) || item.kind === "image") {
    return "image";
  }
  if (item.kind === "html") {
    return "html";
  }
  if (item.kind === "markdown") {
    return "markdown";
  }
  if (item.kind === "text") {
    return "text";
  }
  return "other";
}

function fileOpenDefaultKey(item: LibraryItem) {
  return fileVisualKind(item);
}

function isPreviewableItem(item: LibraryItem) {
  return item.kind === "html"
    || item.kind === "pdf"
    || item.kind === "image"
    || item.kind === "markdown"
    || item.kind === "text";
}

function isWpsOpenableItem(item: LibraryItem) {
  const visualKind = fileVisualKind(item);
  return visualKind === "word" || visualKind === "sheet" || visualKind === "presentation";
}

function getDefaultOpenMode(item: LibraryItem, defaults: OpenModeDefaults): ExternalOpenMode {
  const mode = defaults[fileOpenDefaultKey(item)] ?? "tab";
  return mode === "wps" && !isWpsOpenableItem(item) ? "tab" : mode;
}

function fileDisplayIcon(visualKind: FileVisualKind) {
  if (visualKind === "word") {
    return <FileType2 aria-hidden="true" />;
  }
  if (visualKind === "sheet") {
    return <FileSpreadsheet aria-hidden="true" />;
  }
  if (visualKind === "presentation") {
    return <Presentation aria-hidden="true" />;
  }
  if (visualKind === "archive") {
    return <FileArchive aria-hidden="true" />;
  }
  if (visualKind === "pdf") {
    return <FileBadge aria-hidden="true" />;
  }
  if (visualKind === "image") {
    return <FileImage aria-hidden="true" />;
  }
  if (visualKind === "html") {
    return <FileCode2 aria-hidden="true" />;
  }
  if (visualKind === "markdown") {
    return <FileCode aria-hidden="true" />;
  }
  if (visualKind === "text") {
    return <FileText aria-hidden="true" />;
  }
  return <File aria-hidden="true" />;
}

function FileIcon({ className, item }: { className: string; item: LibraryItem }) {
  const visualKind = fileVisualKind(item);
  return (
    <span className={className} data-file-kind={visualKind}>
      {fileDisplayIcon(visualKind)}
    </span>
  );
}

function itemMimeType(item: LibraryItem) {
  if (item.kind === "html") {
    return "text/html";
  }
  if (item.kind === "pdf") {
    return "application/pdf";
  }
  if (item.kind === "image") {
    if (item.extension === "svg") {
      return "image/svg+xml";
    }
    return `image/${item.extension === "jpg" ? "jpeg" : item.extension || "png"}`;
  }
  if (item.kind === "markdown") {
    return "text/markdown";
  }
  if (item.kind === "text") {
    return "text/plain";
  }
  return "application/octet-stream";
}

function fileNameFromRelativePath(relativePath: string) {
  return relativePath.split("/").filter(Boolean).pop() ?? relativePath;
}

function dragTargetLabel(targetPath: string) {
  return targetPath ? targetPath : "根目录";
}

function parentPathFromRelativePath(relativePath: string) {
  const parts = relativePath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function folderPathWithAncestors(folderPath: string) {
  const paths = [""];
  let current = "";
  for (const part of folderPath.split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    paths.push(current);
  }
  return paths;
}

function joinLibraryPath(root: string, relativePath: string) {
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  if (!relativePath) {
    return normalizedRoot || root;
  }
  const separator = root.includes("\\") ? "\\" : "/";
  const normalizedRelativePath = relativePath.split("/").filter(Boolean).join(separator);
  return normalizedRoot ? `${normalizedRoot}${separator}${normalizedRelativePath}` : normalizedRelativePath;
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  document.body.appendChild(textarea);
  textarea.select();
  const didCopy = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!didCopy) {
    throw new Error("复制路径失败");
  }
}

function escapeDragHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") {
      return "&amp;";
    }
    if (char === "<") {
      return "&lt;";
    }
    if (char === ">") {
      return "&gt;";
    }
    if (char === "\"") {
      return "&quot;";
    }
    return "&#39;";
  });
}

function isTreeFileDrag(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes(TREE_FILE_DRAG_TYPE);
}

function readTreeFileDrag(dataTransfer: DataTransfer): TreeFileDragPayload | null {
  try {
    const raw = dataTransfer.getData(TREE_FILE_DRAG_TYPE);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<TreeFileDragPayload>;
    return typeof parsed.relativePath === "string" && parsed.relativePath ? { relativePath: parsed.relativePath } : null;
  } catch {
    return null;
  }
}

function setTreeFileDragData(event: ReactDragEvent<HTMLElement>, item: LibraryItem) {
  const fileUrl = new URL(item.url, window.location.href).toString();
  const fileName = fileNameFromRelativePath(item.relativePath).replace(/:/g, "_");
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData(TREE_FILE_DRAG_TYPE, JSON.stringify({ relativePath: item.relativePath }));
  event.dataTransfer.setData("DownloadURL", `${itemMimeType(item)}:${fileName}:${fileUrl}`);
  event.dataTransfer.setData("text/uri-list", fileUrl);
  event.dataTransfer.setData("text/plain", fileUrl);
  event.dataTransfer.setData(
    "text/html",
    `<a href="${escapeDragHtml(fileUrl)}" download="${escapeDragHtml(fileName)}">${escapeDragHtml(item.title)}</a>`
  );
}

function hasDirectoryItems(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.items).some((item) => {
    const entry = (
      item as DataTransferItem & {
        webkitGetAsEntry?: () => { isDirectory?: boolean } | null;
      }
    ).webkitGetAsEntry?.();
    return entry?.isDirectory === true;
  });
}

function visibleFilesFromList(files: FileList | File[]) {
  return Array.from(files).filter((file) => file.name && !file.name.startsWith("."));
}

function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length) {
      blocks.push({ type: "ul", items: listItems });
      listItems = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      blocks.push({ type: `h${level}` as "h1" | "h2" | "h3", text: heading[2] });
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      listItems.push(bullet[1]);
      continue;
    }

    flushList();
    blocks.push({ type: "p", text: trimmed });
  }

  flushList();
  return blocks;
}

function loadTextContent(url: string) {
  const cached = TEXT_CONTENT_CACHE.get(url);
  if (cached) {
    return cached;
  }

  const request = fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(`读取失败：${response.status}`);
    }
    return response.text();
  });
  TEXT_CONTENT_CACHE.set(url, request);
  return request;
}

async function readJsonResponse<TPayload>(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(fallbackMessage);
  }
  return await response.json() as TPayload;
}

function HoverTooltipProvider({ children }: { children: React.ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HoverTooltipAnchor | null>(null);
  const show = useCallback((nextText: string) => {
    const normalized = nextText.trim();
    if (normalized) {
      setText(normalized);
    }
  }, []);
  const hide = useCallback(() => setText(null), []);
  const value = useMemo(() => ({ hide, show, setAnchor }), [hide, show]);
  const tooltipStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!anchor || typeof window === "undefined") {
      return undefined;
    }

    const left = clamp(anchor.x + anchor.width / 2, 16, window.innerWidth - 16);
    if (anchor.panelPlacement === "top") {
      return {
        bottom: "auto",
        left,
        top: anchor.y + anchor.height + 10
      };
    }

    return {
      bottom: window.innerHeight - anchor.y + 10,
      left,
      top: "auto"
    };
  }, [anchor]);

  return (
    <HoverTooltipContext.Provider value={value}>
      {children}
      {text ? <div className="hover-full-text" data-anchored={anchor ? "true" : undefined} style={tooltipStyle}>{text}</div> : null}
    </HoverTooltipContext.Provider>
  );
}

function FullText({ children, className, text }: { children?: React.ReactNode; className?: string; text: string }) {
  const tooltip = useContext(HoverTooltipContext);

  return (
    <span
      className={className}
      onBlur={tooltip.hide}
      onFocus={() => tooltip.show(text)}
      onMouseEnter={() => tooltip.show(text)}
      onMouseLeave={tooltip.hide}
    >
      {children ?? text}
    </span>
  );
}

type MotionSelectProps<TValue extends string> = {
  ariaLabel: string;
  className?: string;
  icon?: React.ReactNode;
  maxVisibleItems?: number;
  options: Array<SelectOption<TValue>>;
  value: TValue;
  onChange: (value: TValue) => void;
};

function MotionSelect<TValue extends string>({
  ariaLabel,
  className,
  icon,
  maxVisibleItems = 7,
  options,
  value,
  onChange
}: MotionSelectProps<TValue>) {
  const id = useId();
  const prefersReducedMotion = useReducedMotion();
  const tooltip = useContext(HoverTooltipContext);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? { value, label: "" };
  const transition: Transition = prefersReducedMotion ? { duration: 0 } : { duration: 0.18, ease: MOTION_EASE_OUT };
  const exitTransition: Transition = prefersReducedMotion ? { duration: 0 } : { duration: 0.08, ease: MOTION_EASE_OUT };
  const visibleOptionCount = Math.min(options.length, maxVisibleItems);
  const listMaxHeight = Math.max(0, visibleOptionCount * 42 + 8);
  const expandedHeight = 44 + listMaxHeight;

  const toggleMenu = () => {
    setIsOpen((current) => !current);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (triggerRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  return (
    <LazyMotion features={domMax}>
      <div
        className={className ? `motion-select ${className}` : "motion-select"}
        ref={triggerRef}
        data-open={isOpen ? "true" : undefined}
      >
        <m.div
          className="motion-select-surface"
          animate={{
            borderColor: "oklch(0% 0 0 / 8%)",
            borderRadius: isOpen ? 18 : 22,
            height: isOpen ? expandedHeight : 44
          }}
          initial={false}
          transition={transition}
        >
          {icon ? <span className="motion-select-icon">{icon}</span> : null}
          <button
            className="motion-select-trigger"
            type="button"
            aria-controls={`${id}-listbox`}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-label={ariaLabel}
            onClick={toggleMenu}
          >
            <FullText className="motion-select-value" text={selectedOption.label}>
              {selectedOption.label}
            </FullText>
            <ChevronDown className="motion-select-chevron" aria-hidden="true" />
          </button>

          <AnimatePresence initial={false}>
            {isOpen ? (
              <m.div
                className="motion-select-menu"
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2, transition: exitTransition }}
                transition={transition}
              >
                <div
                  className="motion-select-list"
                  id={`${id}-listbox`}
                  role="listbox"
                  aria-label={ariaLabel}
                  style={{ maxHeight: listMaxHeight }}
                >
                  {options.map((option, index) => {
                    const isSelected = option.value === value;
                    return (
                      <m.button
                        className="motion-select-option"
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-selected={isSelected ? "true" : undefined}
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 6, transition: exitTransition }}
                        transition={{
                          ...transition,
                          delay: prefersReducedMotion ? 0 : Math.min(index, 6) * 0.015
                        }}
                        onClick={() => {
                          onChange(option.value);
                          tooltip.hide();
                          setIsOpen(false);
                        }}
                      >
                        <FullText className="motion-select-option-label" text={option.label}>
                          {option.label}
                        </FullText>
                        {isSelected ? <Check aria-hidden="true" /> : null}
                      </m.button>
                    );
                  })}
                </div>
              </m.div>
            ) : null}
          </AnimatePresence>
        </m.div>
      </div>
    </LazyMotion>
  );
}

function useLibrary() {
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedLibraryRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!hasLoadedLibraryRef.current) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const response = await fetch(`/api/library?t=${Date.now()}`);
      if (!response.ok) {
        throw new Error(`索引读取失败：${response.status}`);
      }
      setLibrary(await readJsonResponse<LibraryResponse>(
        response,
        "索引接口未就绪，请使用 npm run dev 启动本地服务"
      ));
      hasLoadedLibraryRef.current = true;
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "索引读取失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const checkForChanges = useCallback(async () => {
    try {
      const response = await fetch(`/api/library/status?t=${Date.now()}`);
      if (!response.ok) {
        throw new Error(`索引状态读取失败：${response.status}`);
      }
      const status = await readJsonResponse<LibraryStatusResponse>(
        response,
        "索引状态接口未就绪，已改用完整刷新"
      );
      if (status.changed) {
        await refresh();
      }
      return status;
    } catch (statusError) {
      if (statusError instanceof Error && statusError.message === "索引状态接口未就绪，已改用完整刷新") {
        await refresh();
        return null;
      }
      setError(statusError instanceof Error ? statusError.message : "索引状态读取失败");
      return null;
    }
  }, [refresh]);

  const uploadFiles = useCallback(async (targetPath: string, files: File[]) => {
    const formData = new FormData();
    formData.set("targetPath", targetPath);
    for (const file of files) {
      formData.append("files", file);
    }

    const response = await fetch("/api/library/upload", {
      method: "POST",
      body: formData
    });
    const payload = await readJsonResponse<Partial<LibraryUploadResponse> & { message?: string }>(
      response,
      "上传接口未就绪，请重启本地服务"
    );

    if (!response.ok) {
      throw new Error(payload?.message || `上传失败：${response.status}`);
    }

    await checkForChanges();
    return payload as LibraryUploadResponse;
  }, [checkForChanges]);

  const moveFile = useCallback(async (sourcePath: string, targetPath: string) => {
    const response = await fetch("/api/library/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePath, targetPath })
    });
    const payload = await readJsonResponse<Partial<LibraryMoveResponse> & { message?: string }>(
      response,
      "移动接口未就绪，请重启本地服务"
    );

    if (!response.ok) {
      throw new Error(payload?.message || `移动失败：${response.status}`);
    }

    await checkForChanges();
    return payload as LibraryMoveResponse;
  }, [checkForChanges]);

  const createFolder = useCallback(async (parentPath: string, name: string) => {
    const response = await fetch("/api/library/folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentPath, name })
    });
    const payload = await readJsonResponse<Partial<LibraryCreateFolderResponse> & { message?: string }>(
      response,
      "新建文件夹接口未就绪，请重启本地服务"
    );

    if (!response.ok) {
      throw new Error(payload?.message || `新建文件夹失败：${response.status}`);
    }

    await checkForChanges();
    return payload as LibraryCreateFolderResponse;
  }, [checkForChanges]);

  const deleteEntry = useCallback(async (relativePath: string) => {
    const response = await fetch("/api/library/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ relativePath })
    });
    const payload = await readJsonResponse<Partial<LibraryDeleteEntryResponse> & { message?: string }>(
      response,
      "删除接口未就绪，请重启本地服务"
    );

    if (!response.ok) {
      throw new Error(payload?.message || `删除失败：${response.status}`);
    }

    await checkForChanges();
    return payload as LibraryDeleteEntryResponse;
  }, [checkForChanges]);

  const revealPath = useCallback(async (relativePath: string, kind: "file" | "folder") => {
    const response = await fetch("/api/library/reveal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ relativePath, kind })
    });
    const payload = await readJsonResponse<Partial<LibraryRevealResponse> & { message?: string }>(
      response,
      "打开位置接口未就绪，请重启本地服务"
    );

    if (!response.ok) {
      throw new Error(payload?.message || `打开位置失败：${response.status}`);
    }

    return payload as LibraryRevealResponse;
  }, []);

  const openFile = useCallback(async (relativePath: string, mode: LibraryNativeOpenMode) => {
    const response = await fetch("/api/library/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ relativePath, mode })
    });
    const payload = await readJsonResponse<Partial<LibraryOpenResponse> & { message?: string }>(
      response,
      "外部打开接口未就绪，请重启本地服务"
    );

    if (!response.ok) {
      throw new Error(payload?.message || `外部打开失败：${response.status}`);
    }

    return payload as LibraryOpenResponse;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!document.hidden) {
        void checkForChanges();
      }
    }, LIBRARY_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [checkForChanges]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void checkForChanges();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [checkForChanges]);

  return { library, isLoading, error, createFolder, deleteEntry, refresh, moveFile, openFile, revealPath, uploadFiles };
}

function App() {
  const { library, isLoading, error, createFolder, deleteEntry, refresh, moveFile, openFile, revealPath, uploadFiles } = useLibrary();
  const [query, setQuery] = useState("");
  const [activeKind, setActiveKind] = useState<LibraryKind | "all">("all");
  const [activeTopic, setActiveTopic] = useState("");
  const [treeMode, setTreeMode] = useState<TreeDisplayMode>("all");
  const [selectedTreeFilePath, setSelectedTreeFilePath] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("library");
  const [openModeDefaults, setOpenModeDefaults] = useState<OpenModeDefaults>(() => readOpenModeDefaults());
  const [visibleDetailTags, setVisibleDetailTags] = useState<Set<DetailTagId>>(() => readVisibleDetailTags());
  const selectedPath = useSyncExternalStore(subscribeSelectedPath, getSelectedPathFromLocation, () => null);

  const items = library?.items ?? EMPTY_ITEMS;
  const topics = useMemo(() => library ? flattenTopics(library.tree) : EMPTY_TOPICS, [library]);
  const activeTreeNode = useMemo(
    () => library ? findTreeNodeByPath(library.tree, activeTopic) : null,
    [activeTopic, library]
  );
  const selectedTreeFile = useMemo(
    () => selectedTreeFilePath ? items.find((item) => item.relativePath === selectedTreeFilePath) ?? null : null,
    [items, selectedTreeFilePath]
  );
  const effectiveSelectedTreeFilePath = selectedTreeFile ? selectedTreeFilePath : null;
  const filteredFolders = useMemo(() => {
    if (selectedTreeFile || !activeTreeNode) {
      return EMPTY_NODES;
    }
    return activeTreeNode.children.filter((node) => folderMatchesQuery(node, query));
  }, [activeTreeNode, query, selectedTreeFile]);

  const filteredItems = useMemo(() => {
    if (selectedTreeFile) {
      return [selectedTreeFile];
    }

    const filtered = items.filter((item) => {
      const kindMatches = activeKind === "all" || item.kind === activeKind;
      return kindMatches && isDirectTopicMatch(item, activeTopic) && matchesQuery(item, query);
    });
    return sortItems(filtered, sortMode);
  }, [activeKind, activeTopic, items, query, selectedTreeFile, sortMode]);

  const selectedItem = useMemo(
    () => items.find((item) => item.relativePath === selectedPath) ?? null,
    [items, selectedPath]
  );

  const openExternalItem = useCallback(async (item: LibraryItem, mode?: ExternalOpenMode) => {
    const nextMode = mode ?? getDefaultOpenMode(item, openModeDefaults);
    if (nextMode === "tab") {
      window.open(item.url, "_blank", "noopener,noreferrer");
      return;
    }

    await openFile(item.relativePath, nextMode);
  }, [openFile, openModeDefaults]);

  const setDefaultOpenMode = useCallback((item: LibraryItem, mode: ExternalOpenMode) => {
    if (mode === "wps" && !isWpsOpenableItem(item)) {
      return;
    }
    setOpenModeDefaults((current) => {
      const next = {
        ...current,
        [fileOpenDefaultKey(item)]: mode
      };
      writeOpenModeDefaults(next);
      return next;
    });
  }, []);

  const toggleDetailTag = useCallback((tagId: DetailTagId) => {
    setVisibleDetailTags((current) => {
      const next = new Set(current);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      writeVisibleDetailTags(next);
      return next;
    });
  }, []);

  const showAllDetailTags = useCallback(() => {
    const next = new Set(DEFAULT_DETAIL_TAGS);
    writeVisibleDetailTags(next);
    setVisibleDetailTags(next);
  }, []);

  const openItem = useCallback((relativePath: string) => {
    const item = items.find((candidate) => candidate.relativePath === relativePath);
    if (item && !isPreviewableItem(item)) {
      void openExternalItem(item).catch((openError) => {
        window.alert(openError instanceof Error ? openError.message : "外部打开失败");
      });
      return;
    }
    setSelectedPathInLocation(relativePath);
  }, [items, openExternalItem]);

  const selectTopic = useCallback((topic: string) => {
    setSelectedTreeFilePath(null);
    setActiveTopic(topic);
  }, []);

  const selectTreeFile = useCallback((relativePath: string) => {
    const item = items.find((candidate) => candidate.relativePath === relativePath);
    if (!item) {
      return;
    }
    setActiveTopic(item.topicPath.join("/"));
    setSelectedTreeFilePath(relativePath);
  }, [items]);

  const changeTreeMode = useCallback((mode: TreeDisplayMode) => {
    setTreeMode(mode);
    if (mode === "folders") {
      setSelectedTreeFilePath(null);
    }
  }, []);

  const returnToLibrary = useCallback(() => {
    setSelectedPathInLocation(null);
  }, []);

  if (selectedPath && selectedItem) {
    return (
      <HoverTooltipProvider>
        <Reader
          item={selectedItem}
          navigationItems={filteredItems.length ? filteredItems : items}
          onBack={returnToLibrary}
          onOpen={openItem}
          onRefresh={refresh}
        />
      </HoverTooltipProvider>
    );
  }

  return (
    <HoverTooltipProvider>
      <LibraryHome
        activeKind={activeKind}
        activeTopic={activeTopic}
        error={error}
        filteredFolders={filteredFolders}
        filteredItems={filteredItems}
        generatedAt={library?.generatedAt ?? null}
        isLoading={isLoading}
        items={items}
        libraryRoot={library?.root ?? ""}
        missingPath={selectedPath}
        openModeDefaults={openModeDefaults}
        query={query}
        sortMode={sortMode}
        tree={library?.tree ?? null}
        treeMode={treeMode}
        topics={topics}
        visibleDetailTags={visibleDetailTags}
        selectedTreeFile={selectedTreeFile}
        selectedTreeFilePath={effectiveSelectedTreeFilePath}
        onClearMissing={returnToLibrary}
        onKindChange={setActiveKind}
        onOpenExternal={openExternalItem}
        onOpen={openItem}
        onQueryChange={setQuery}
        onRefresh={refresh}
        onRevealPath={revealPath}
        onSetDefaultOpenMode={setDefaultOpenMode}
        onShowAllDetailTags={showAllDetailTags}
        onSelectTreeFile={selectTreeFile}
        onSortChange={setSortMode}
        onTopicChange={selectTopic}
        onToggleDetailTag={toggleDetailTag}
        onTreeModeChange={changeTreeMode}
        onCreateFolder={createFolder}
        onDeleteEntry={deleteEntry}
        onMoveFile={moveFile}
        onUploadFiles={uploadFiles}
      />
    </HoverTooltipProvider>
  );
}

type LibraryHomeProps = {
  activeKind: LibraryKind | "all";
  activeTopic: string;
  error: string | null;
  filteredFolders: LibraryNode[];
  filteredItems: LibraryItem[];
  generatedAt: string | null;
  isLoading: boolean;
  items: LibraryItem[];
  libraryRoot: string;
  missingPath: string | null;
  openModeDefaults: OpenModeDefaults;
  query: string;
  selectedTreeFile: LibraryItem | null;
  selectedTreeFilePath: string | null;
  sortMode: SortMode;
  tree: LibraryNode | null;
  treeMode: TreeDisplayMode;
  topics: TopicOption[];
  visibleDetailTags: Set<DetailTagId>;
  onClearMissing: () => void;
  onKindChange: (kind: LibraryKind | "all") => void;
  onOpen: (relativePath: string) => void;
  onOpenExternal: (item: LibraryItem, mode?: ExternalOpenMode) => Promise<void>;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
  onRevealPath: (relativePath: string, kind: "file" | "folder") => Promise<LibraryRevealResponse>;
  onSetDefaultOpenMode: (item: LibraryItem, mode: ExternalOpenMode) => void;
  onShowAllDetailTags: () => void;
  onSelectTreeFile: (relativePath: string) => void;
  onSortChange: (sortMode: SortMode) => void;
  onTopicChange: (topic: string) => void;
  onToggleDetailTag: (tagId: DetailTagId) => void;
  onTreeModeChange: (mode: TreeDisplayMode) => void;
  onCreateFolder: (parentPath: string, name: string) => Promise<LibraryCreateFolderResponse>;
  onDeleteEntry: (relativePath: string) => Promise<LibraryDeleteEntryResponse>;
  onMoveFile: (sourcePath: string, targetPath: string) => Promise<LibraryMoveResponse>;
  onUploadFiles: (targetPath: string, files: File[]) => Promise<LibraryUploadResponse>;
};

function LibraryHome(props: LibraryHomeProps) {
  const initialTreeCollapseRef = useRef<TreeCollapseStorage | null>(null);
  if (initialTreeCollapseRef.current === null) {
    initialTreeCollapseRef.current = readTreeCollapseStorage();
  }
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sidebarPanelRef = useRef<HTMLElement>(null);
  const sidebarResizeRef = useRef<SidebarResizeState | null>(null);
  const treeContextMenuRef = useRef<HTMLDivElement>(null);
  const [dragTarget, setDragTarget] = useState<DragTargetState | null>(null);
  const [draggedFilePath, setDraggedFilePath] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set(initialTreeCollapseRef.current?.collapsed));
  const [knownFolderPaths, setKnownFolderPaths] = useState<Set<string>>(() => new Set(initialTreeCollapseRef.current?.known));
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(() => readStoredSidebarWidth());
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({
    status: "idle",
    targetPath: "",
    message: "选择或拖入文件"
  });
  const {
    onCreateFolder,
    onDeleteEntry,
    onMoveFile,
    onOpenExternal,
    onRevealPath,
    onSetDefaultOpenMode,
    onTopicChange,
    onUploadFiles
  } = props;
  const readableCount = props.items.filter((item) => item.kind !== "other").length;
  const activeTopicName = props.topics.find((topic) => topic.path === props.activeTopic)?.name ?? "全部主题";
  const topicName = props.selectedTreeFile?.title ?? activeTopicName;
  const uploadTargetName = props.activeTopic ? activeTopicName : "根目录";
  const filesByTopic = useMemo(() => {
    const next = new Map<string, LibraryItem[]>();
    for (const item of props.items) {
      const topicPath = item.topicPath.join("/");
      const group = next.get(topicPath);
      if (group) {
        group.push(item);
      } else {
        next.set(topicPath, [item]);
      }
    }
    return next;
  }, [props.items]);
  const allFolderPaths = useMemo(() => props.tree ? collectFolderPaths(props.tree) : [], [props.tree]);
  const contextMenuFile = useMemo(() => {
    if (treeContextMenu?.target.kind !== "file") {
      return null;
    }
    return props.items.find((item) => item.relativePath === treeContextMenu.target.path) ?? null;
  }, [props.items, treeContextMenu]);
  const contextMenuDefaultMode = contextMenuFile
    ? getDefaultOpenMode(contextMenuFile, props.openModeDefaults)
    : "tab";
  const sidebarLayoutStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (sidebarWidth === null) {
      return undefined;
    }
    return { "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties;
  }, [sidebarWidth]);
  const visibleCollapsedFolders = useMemo(() => {
    const next = new Set<string>();
    const currentFolderPaths = new Set(allFolderPaths);
    for (const path of collapsedFolders) {
      if (currentFolderPaths.has(path)) {
        next.add(path);
      }
    }
    for (const path of allFolderPaths) {
      if (path && (!initialTreeCollapseRef.current?.hasStoredState || !knownFolderPaths.has(path))) {
        next.add(path);
      }
    }
    return next;
  }, [allFolderPaths, collapsedFolders, knownFolderPaths]);
  const allFoldersCollapsed = allFolderPaths.length > 0 && allFolderPaths.every((path) => visibleCollapsedFolders.has(path));

  useEffect(() => {
    if (!props.tree) {
      return;
    }

    const nextKnownFolderPaths = new Set(allFolderPaths);
    const hasStoredState = initialTreeCollapseRef.current?.hasStoredState ?? false;
    setCollapsedFolders((current) => {
      const next = new Set<string>();
      for (const path of current) {
        if (nextKnownFolderPaths.has(path)) {
          next.add(path);
        }
      }
      for (const path of allFolderPaths) {
        if (path && (!hasStoredState || !knownFolderPaths.has(path))) {
          next.add(path);
        }
      }
      return areSetsEqual(current, next) ? current : next;
    });
    setKnownFolderPaths((current) => areSetsEqual(current, nextKnownFolderPaths) ? current : nextKnownFolderPaths);
    if (initialTreeCollapseRef.current) {
      initialTreeCollapseRef.current.hasStoredState = true;
    }
  }, [allFolderPaths, knownFolderPaths, props.tree]);

  useEffect(() => {
    if (!props.tree) {
      return;
    }
    writeTreeCollapseStorage(collapsedFolders, knownFolderPaths);
  }, [collapsedFolders, knownFolderPaths, props.tree]);

  useEffect(() => {
    if (!treeContextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && treeContextMenuRef.current?.contains(target)) {
        return;
      }
      setTreeContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTreeContextMenu(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [treeContextMenu]);

  const uploadToTopic = useCallback(async (targetPath: string, files: FileList | File[]) => {
    const visibleFiles = visibleFilesFromList(files);
    if (!visibleFiles.length) {
      setUploadState({
        status: "error",
        targetPath,
        message: "没有可上传的文件"
      });
      return;
    }

    setUploadState({
      status: "uploading",
      targetPath,
      message: `正在上传 ${visibleFiles.length} 个文件`
    });

    try {
      const result = await onUploadFiles(targetPath, visibleFiles);
      setUploadState({
        status: "success",
        targetPath,
        message: `已添加 ${result.uploaded.length} 个文件`
      });
    } catch (uploadError) {
      setUploadState({
        status: "error",
        targetPath,
        message: uploadError instanceof Error ? uploadError.message : "上传失败"
      });
    }
  }, [onUploadFiles]);

  const moveFileToTopic = useCallback(async (sourcePath: string, targetPath: string) => {
    setUploadState({
      status: "moving",
      targetPath,
      message: `正在移动到 ${dragTargetLabel(targetPath)}`
    });

    try {
      const result = await onMoveFile(sourcePath, targetPath);
      setUploadState({
        status: "success",
        targetPath,
        message: result.changed ? `已移动到 ${dragTargetLabel(targetPath)}` : "文件已在此目录"
      });
      onTopicChange(targetPath);
    } catch (moveError) {
      setUploadState({
        status: "error",
        targetPath,
        message: moveError instanceof Error ? moveError.message : "移动失败"
      });
    }
  }, [onMoveFile, onTopicChange]);

  const dropToTopic = useCallback((targetPath: string, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const treeFile = readTreeFileDrag(event.dataTransfer);
    const sourcePath = treeFile?.relativePath ?? draggedFilePath;
    setDragTarget(null);
    setDraggedFilePath(null);

    if (sourcePath) {
      void moveFileToTopic(sourcePath, targetPath);
      return;
    }

    if (hasDirectoryItems(event.dataTransfer)) {
      setUploadState({
        status: "error",
        targetPath,
        message: "暂不支持拖入文件夹"
      });
      return;
    }

    void uploadToTopic(targetPath, event.dataTransfer.files);
  }, [draggedFilePath, moveFileToTopic, uploadToTopic]);

  const markDragTarget = useCallback((targetPath: string, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const action: TreeDragAction = draggedFilePath || isTreeFileDrag(event.dataTransfer) ? "move" : "upload";
    event.dataTransfer.dropEffect = action === "move" ? "move" : "copy";
    setDragTarget({ path: targetPath, action });
    setUploadState((current) => current.status === "uploading" || current.status === "moving"
      ? current
      : {
        status: "dragging",
        targetPath,
        message: `${action === "move" ? "移动到" : "添加到"} ${dragTargetLabel(targetPath)}`
      });
  }, [draggedFilePath]);

  const clearDragTarget = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    setDragTarget(null);
    setUploadState((current) => current.status === "dragging"
      ? { status: "idle", targetPath: "", message: "选择或拖入文件" }
      : current);
  }, []);

  const startFileDrag = useCallback((item: LibraryItem, event: ReactDragEvent<HTMLElement>) => {
    setDraggedFilePath(item.relativePath);
    setTreeFileDragData(event, item);
    setUploadState({
      status: "dragging",
      targetPath: item.topicPath.join("/"),
      message: "拖到目录移动，拖出窗口转发"
    });
  }, []);

  const endFileDrag = useCallback(() => {
    setDraggedFilePath(null);
    setDragTarget(null);
    setUploadState((current) => current.status === "dragging"
      ? { status: "idle", targetPath: "", message: "选择或拖入文件" }
      : current);
  }, []);

  const toggleFolder = useCallback((folderPath: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  const collapseAllFolders = useCallback(() => {
    setCollapsedFolders(new Set(allFolderPaths));
  }, [allFolderPaths]);

  const expandFolderPath = useCallback((folderPath: string) => {
    const pathsToExpand = new Set(folderPathWithAncestors(folderPath));
    setCollapsedFolders((current) => {
      const next = new Set(current);
      for (const path of pathsToExpand) {
        next.delete(path);
      }
      return areSetsEqual(current, next) ? current : next;
    });
  }, []);

  const openContentFolder = useCallback((folderPath: string) => {
    expandFolderPath(folderPath);
    onTopicChange(folderPath);
  }, [expandFolderPath, onTopicChange]);

  const openTreeContextMenu = useCallback((target: TreeContextTarget, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const x = clamp(event.clientX, 8, Math.max(8, window.innerWidth - TREE_CONTEXT_MENU_WIDTH - 8));
    const y = clamp(event.clientY, 8, Math.max(8, window.innerHeight - TREE_CONTEXT_MENU_HEIGHT - 8));
    setTreeContextMenu({ x, y, target });
  }, []);

  const openFileFromContext = useCallback((mode: ExternalOpenMode) => {
    if (!contextMenuFile) {
      return;
    }
    setTreeContextMenu(null);
    void onOpenExternal(contextMenuFile, mode).catch((openError) => {
      setUploadState({
        status: "error",
        targetPath: contextMenuFile.topicPath.join("/"),
        message: openError instanceof Error ? openError.message : "外部打开失败"
      });
    });
  }, [contextMenuFile, onOpenExternal]);

  const setDefaultOpenModeFromContext = useCallback((mode: ExternalOpenMode) => {
    if (!contextMenuFile) {
      return;
    }
    if (mode === "wps" && !isWpsOpenableItem(contextMenuFile)) {
      return;
    }
    onSetDefaultOpenMode(contextMenuFile, mode);
    setUploadState({
      status: "success",
      targetPath: contextMenuFile.topicPath.join("/"),
      message: `已将 ${EXTERNAL_OPEN_MODE_LABELS[mode]} 设为${fileDisplayLabel(contextMenuFile)}默认打开方式`
    });
    setTreeContextMenu(null);
  }, [contextMenuFile, onSetDefaultOpenMode]);

  const createFolderFromContext = useCallback(() => {
    const target = treeContextMenu?.target;
    if (!target) {
      return;
    }

    const parentPath = target.kind === "folder" ? target.path : target.parentPath;
    setTreeContextMenu(null);
    const name = window.prompt(`在${dragTargetLabel(parentPath)}中新建文件夹`, "新建文件夹")?.trim();
    if (name === undefined) {
      return;
    }
    if (!name) {
      setUploadState({
        status: "error",
        targetPath: parentPath,
        message: "文件夹名称不能为空"
      });
      return;
    }

    setUploadState({
      status: "creating",
      targetPath: parentPath,
      message: `正在${dragTargetLabel(parentPath)}中新建文件夹`
    });

    void (async () => {
      try {
        const result = await onCreateFolder(parentPath, name);
        expandFolderPath(parentPath);
        setUploadState({
          status: "success",
          targetPath: result.folder.relativePath,
          message: `已新建 ${result.folder.name}`
        });
        onTopicChange(result.folder.relativePath);
      } catch (createError) {
        setUploadState({
          status: "error",
          targetPath: parentPath,
          message: createError instanceof Error ? createError.message : "新建文件夹失败"
        });
      }
    })();
  }, [expandFolderPath, onCreateFolder, onTopicChange, treeContextMenu]);

  const copyPathFromContext = useCallback(() => {
    const target = treeContextMenu?.target;
    if (!target) {
      return;
    }

    const pathToCopy = joinLibraryPath(props.libraryRoot, target.path);
    setTreeContextMenu(null);
    void copyTextToClipboard(pathToCopy)
      .then(() => {
        setUploadState({
          status: "success",
          targetPath: target.path,
          message: `已复制路径：${pathToCopy}`
        });
      })
      .catch((copyError) => {
        setUploadState({
          status: "error",
          targetPath: target.path,
          message: copyError instanceof Error ? copyError.message : "复制路径失败"
        });
      });
  }, [props.libraryRoot, treeContextMenu]);

  const deleteTargetFromContext = useCallback(() => {
    const target = treeContextMenu?.target;
    if (!target || (target.kind === "folder" && !target.path)) {
      return;
    }

    const targetKindLabel = target.kind === "folder" ? "文件夹" : "文件";
    const parentPath = target.kind === "folder" ? parentPathFromRelativePath(target.path) : target.parentPath;
    setTreeContextMenu(null);
    const confirmMessage = target.kind === "folder"
      ? `删除文件夹“${target.label}”及其中所有内容？`
      : `删除文件“${target.label}”？`;
    if (!window.confirm(confirmMessage)) {
      return;
    }

    setUploadState({
      status: "deleting",
      targetPath: parentPath,
      message: `正在删除${targetKindLabel} ${target.label}`
    });

    void (async () => {
      try {
        const result = await onDeleteEntry(target.path);
        expandFolderPath(parentPath);
        setUploadState({
          status: "success",
          targetPath: parentPath,
          message: `已删除${targetKindLabel} ${result.deleted.title}`
        });
        onTopicChange(parentPath);
      } catch (deleteError) {
        setUploadState({
          status: "error",
          targetPath: parentPath,
          message: deleteError instanceof Error ? deleteError.message : "删除失败"
        });
      }
    })();
  }, [expandFolderPath, onDeleteEntry, onTopicChange, treeContextMenu]);

  const revealPathInManager = useCallback((relativePath: string, kind: "file" | "folder") => {
    void (async () => {
      try {
        await onRevealPath(relativePath, kind);
      } catch (revealError) {
        setUploadState({
          status: "error",
          targetPath: relativePath,
          message: revealError instanceof Error ? revealError.message : "打开位置失败"
        });
      }
    })();
  }, [onRevealPath]);

  const startSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const currentWidth = sidebarPanelRef.current?.getBoundingClientRect().width ?? SIDEBAR_DEFAULT_WIDTH;
    sidebarResizeRef.current = {
      pointerId: event.pointerId,
      startWidth: currentWidth,
      startX: event.clientX
    };
    setIsSidebarResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const updateSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const resizeState = sidebarResizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const nextWidth = resizeState.startWidth + event.clientX - resizeState.startX;
    setSidebarWidth(clamp(nextWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
  }, []);

  const endSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const resizeState = sidebarResizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (event.type !== "pointercancel") {
      const nextWidth = clamp(
        resizeState.startWidth + event.clientX - resizeState.startX,
        SIDEBAR_MIN_WIDTH,
        SIDEBAR_MAX_WIDTH
      );
      setSidebarWidth(nextWidth);
      saveSidebarWidth(nextWidth);
    }
    sidebarResizeRef.current = null;
    setIsSidebarResizing(false);
  }, []);

  const stepSidebarResize = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") {
      return;
    }
    event.preventDefault();
    const baseWidth = sidebarWidth ?? sidebarPanelRef.current?.getBoundingClientRect().width ?? SIDEBAR_DEFAULT_WIDTH;
    let nextWidth = baseWidth;
    if (event.key === "Home") {
      nextWidth = SIDEBAR_MIN_WIDTH;
    } else if (event.key === "End") {
      nextWidth = SIDEBAR_MAX_WIDTH;
    } else {
      const delta = event.key === "ArrowLeft" ? -20 : 20;
      nextWidth = clamp(baseWidth + delta, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
    }
    setSidebarWidth(nextWidth);
    saveSidebarWidth(nextWidth);
  }, [sidebarWidth]);

  const treeContextMenuLayer = treeContextMenu && typeof document !== "undefined"
    ? createPortal(
      <div
        ref={treeContextMenuRef}
        className="tree-context-menu"
        role="menu"
        style={{ left: treeContextMenu.x, top: treeContextMenu.y }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {contextMenuFile ? (
          <>
            <div className="tree-context-menu-group">
              <button type="button" role="menuitem" onClick={() => openFileFromContext("tab")}>
                <ExternalLink aria-hidden="true" />
                <span>新标签页打开</span>
              </button>
              <button type="button" role="menuitem" onClick={() => openFileFromContext("system")}>
                <File aria-hidden="true" />
                <span>系统默认应用打开</span>
              </button>
              {isWpsOpenableItem(contextMenuFile) ? (
                <button type="button" role="menuitem" onClick={() => openFileFromContext("wps")}>
                  <FileType2 aria-hidden="true" />
                  <span>WPS 打开</span>
                </button>
              ) : null}
            </div>
            <div className="tree-context-menu-group">
              {(["tab", "system", "wps"] as ExternalOpenMode[]).map((mode) => {
                const isWpsModeUnavailable = mode === "wps" && !isWpsOpenableItem(contextMenuFile);
                if (isWpsModeUnavailable) {
                  return null;
                }
                const isDefault = contextMenuDefaultMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="menuitem"
                    onClick={() => setDefaultOpenModeFromContext(mode)}
                  >
                    {isDefault ? <Check aria-hidden="true" /> : <span className="menu-icon-placeholder" aria-hidden="true" />}
                    <span>默认：{EXTERNAL_OPEN_MODE_LABELS[mode]}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
        <div className="tree-context-menu-group">
          <button type="button" role="menuitem" onClick={copyPathFromContext}>
            <Copy aria-hidden="true" />
            <span>复制路径</span>
          </button>
          <button type="button" role="menuitem" onClick={createFolderFromContext}>
            <FolderPlus aria-hidden="true" />
            <span>新建文件夹</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={treeContextMenu.target.kind === "folder" && !treeContextMenu.target.path}
            onClick={deleteTargetFromContext}
          >
            <Trash2 aria-hidden="true" />
            <span>{treeContextMenu.target.kind === "folder" ? "删除文件夹" : "删除文件"}</span>
          </button>
        </div>
      </div>,
      document.body
    )
    : null;

  return (
    <div className="app-shell" data-sidebar-resizing={isSidebarResizing ? "true" : undefined}>
      <header className="global-nav">
        <div className="global-nav-inner">
          <div className="global-brand">
            <span className="brand-mark"><BookOpen aria-hidden="true" /></span>
            <span>本地文档阅读馆</span>
          </div>
          <nav className="global-links" aria-label="全局导航">
            <span>{props.items.length} 个文件</span>
            <span>{readableCount} 个可预览</span>
          </nav>
        </div>
      </header>

      <div className="sub-nav">
        <div className="sub-nav-inner">
          <div>
            <p className="sub-title">{topicName}</p>
            <p className="sub-caption">
              {props.generatedAt ? `索引更新于 ${formatDate(Date.parse(props.generatedAt))}` : "等待索引"}
            </p>
          </div>
          <button className="button primary compact" type="button" onClick={props.onRefresh}>
            <RefreshCw aria-hidden="true" />
            刷新索引
          </button>
        </div>
      </div>

      <main
        className="catalog-layout"
        data-sidebar-resizing={isSidebarResizing ? "true" : undefined}
        style={sidebarLayoutStyle}
      >
        <aside ref={sidebarPanelRef} className="sidebar-panel" aria-label="主题目录">
          <div className="panel-heading">
            <span className="panel-heading-title">
              <Folder aria-hidden="true" />
              <span>目录</span>
            </span>
            <span className="panel-actions">
              <button
                className="panel-action"
                type="button"
                title={`添加到${uploadTargetName}`}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload aria-hidden="true" />
                添加
              </button>
              <button
                className="panel-action"
                type="button"
                title={allFoldersCollapsed ? "所有文件夹已折叠" : "折叠所有文件夹"}
                onClick={collapseAllFolders}
              >
                <ChevronDown aria-hidden="true" />
                全折叠
              </button>
              <button
                className="panel-action"
                type="button"
                aria-pressed={props.treeMode === "all"}
                title={props.treeMode === "all" ? "切换为只展示文件夹" : "切换为展示文件夹和文件"}
                onClick={() => props.onTreeModeChange(props.treeMode === "all" ? "folders" : "all")}
              >
                <File aria-hidden="true" />
                {props.treeMode === "all" ? "仅文件夹" : "显示文件"}
              </button>
            </span>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              aria-label={`添加文件到${uploadTargetName}`}
              multiple
              onChange={(event) => {
                if (event.currentTarget.files) {
                  void uploadToTopic(props.activeTopic, event.currentTarget.files);
                }
                event.currentTarget.value = "";
              }}
            />
          </div>
          <div
            className="upload-status"
            data-status={uploadState.status}
            data-active={dragTarget?.path === "" ? "true" : undefined}
            data-drop-action={dragTarget?.path === "" ? dragTarget.action : undefined}
            onDragOver={(event) => markDragTarget("", event)}
            onDragLeave={clearDragTarget}
            onDrop={(event) => dropToTopic("", event)}
          >
            <Upload aria-hidden="true" />
            <span>{uploadState.message}</span>
          </div>
          {props.tree ? (
            <TopicTree
              activeTopic={props.activeTopic}
              collapsedFolders={visibleCollapsedFolders}
              dragTarget={dragTarget}
              draggedFilePath={draggedFilePath}
              filesByTopic={filesByTopic}
              mode={props.treeMode}
              root={props.tree}
              selectedFilePath={props.selectedTreeFilePath}
              onDragLeave={clearDragTarget}
              onDragTarget={markDragTarget}
              onDropToTopic={dropToTopic}
              onFileDragEnd={endFileDrag}
              onFileDragStart={startFileDrag}
              onFileSelect={props.onSelectTreeFile}
              onContextMenu={openTreeContextMenu}
              onRevealPath={revealPathInManager}
              onTopicChange={props.onTopicChange}
              onToggleFolder={toggleFolder}
            />
          ) : (
            <div className="topic-list empty">等待索引</div>
          )}
          <div
            className="sidebar-resize-handle"
            role="separator"
            tabIndex={0}
            aria-label="拖拽调整目录宽度"
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuenow={Math.round(sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH)}
            title="拖拽调整目录宽度"
            onKeyDown={stepSidebarResize}
            onPointerCancel={endSidebarResize}
            onPointerDown={startSidebarResize}
            onPointerMove={updateSidebarResize}
            onPointerUp={endSidebarResize}
          />
        </aside>

        <section className="library-content" aria-label="文件列表">
          <div className="library-controls">
            <div className="filter-strip">
              <label className="search-field">
                <Search aria-hidden="true" />
                <input
                  value={props.query}
                  placeholder="搜索标题、路径或标签"
                  onChange={(event) => props.onQueryChange(event.target.value)}
                />
              </label>

              <MotionSelect
                ariaLabel="排序方式"
                className="select-field"
                icon={<ListFilter aria-hidden="true" />}
                maxVisibleItems={4}
                options={SORT_OPTIONS}
                value={props.sortMode}
                onChange={props.onSortChange}
              />
            </div>

            <div className="kind-tabs" aria-label="文件类型筛选">
              {KIND_OPTIONS.map((kind) => (
                <button
                  className={kind === props.activeKind ? "kind-tab active" : "kind-tab"}
                  key={kind}
                  type="button"
                  onClick={() => props.onKindChange(kind)}
                >
                  {KIND_LABELS[kind]}
                </button>
              ))}
            </div>

            <DetailTagFilter
              visibleTags={props.visibleDetailTags}
              onShowAll={props.onShowAllDetailTags}
              onToggle={props.onToggleDetailTag}
            />

            {props.missingPath ? (
              <div className="notice">
                <span>未找到文件：{props.missingPath}</span>
                <button type="button" onClick={props.onClearMissing}>返回列表</button>
              </div>
            ) : null}

            {props.selectedTreeFile ? (
              <div className="notice">
                <span>文件树已选中：{props.selectedTreeFile.title}</span>
                <button type="button" onClick={() => props.onTopicChange(props.activeTopic)}>显示当前目录</button>
              </div>
            ) : null}

            {props.error ? <div className="notice error">{props.error}</div> : null}
          </div>

          <div className="file-list-scroll">
            {props.isLoading ? (
              <div className="file-grid">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div className="file-card skeleton" key={index} />
                ))}
              </div>
            ) : props.filteredFolders.length || props.filteredItems.length ? (
              <div className="file-grid">
                {props.filteredFolders.map((folder) => (
                  <FolderCard
                    folder={folder}
                    key={`folder:${folder.path}`}
                    visibleTags={props.visibleDetailTags}
                    onOpen={openContentFolder}
                  />
                ))}
                {props.filteredItems.map((item) => (
                  <FileCard
                    item={item}
                    key={item.id}
                    visibleTags={props.visibleDetailTags}
                    onContextMenu={(event) => openTreeContextMenu({
                      kind: "file",
                      path: item.relativePath,
                      parentPath: parentPathFromRelativePath(item.relativePath),
                      label: item.title
                    }, event)}
                    onOpen={props.onOpen}
                    onReveal={(relativePath) => revealPathInManager(relativePath, "file")}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <h2>这里暂时没有匹配文件</h2>
                <p>调整搜索、主题或文件类型后，列表会立即更新。</p>
              </div>
            )}
          </div>
        </section>
      </main>
      {treeContextMenuLayer}
    </div>
  );
}

type TopicTreeProps = {
  activeTopic: string;
  collapsedFolders: Set<string>;
  dragTarget: DragTargetState | null;
  draggedFilePath: string | null;
  filesByTopic: Map<string, LibraryItem[]>;
  mode: TreeDisplayMode;
  root: LibraryNode;
  selectedFilePath: string | null;
  onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  onDragTarget: (targetPath: string, event: ReactDragEvent<HTMLElement>) => void;
  onDropToTopic: (targetPath: string, event: ReactDragEvent<HTMLElement>) => void;
  onFileDragEnd: () => void;
  onFileDragStart: (item: LibraryItem, event: ReactDragEvent<HTMLElement>) => void;
  onFileSelect: (relativePath: string) => void;
  onContextMenu: (target: TreeContextTarget, event: ReactMouseEvent<HTMLElement>) => void;
  onRevealPath: (relativePath: string, kind: "file" | "folder") => void;
  onTopicChange: (topic: string) => void;
  onToggleFolder: (folderPath: string) => void;
};

function TopicTree(props: TopicTreeProps) {
  return (
    <div
      className="topic-list"
      onDragOver={(event) => props.onDragTarget("", event)}
      onDragLeave={props.onDragLeave}
      onDrop={(event) => props.onDropToTopic("", event)}
    >
      <TopicTreeNode
        activeTopic={props.activeTopic}
        collapsedFolders={props.collapsedFolders}
        dragTarget={props.dragTarget}
        draggedFilePath={props.draggedFilePath}
        filesByTopic={props.filesByTopic}
        mode={props.mode}
        node={props.root}
        depth={0}
        selectedFilePath={props.selectedFilePath}
        onDragLeave={props.onDragLeave}
        onDragTarget={props.onDragTarget}
        onDropToTopic={props.onDropToTopic}
        onFileDragEnd={props.onFileDragEnd}
        onFileDragStart={props.onFileDragStart}
        onFileSelect={props.onFileSelect}
        onContextMenu={props.onContextMenu}
        onRevealPath={props.onRevealPath}
        onTopicChange={props.onTopicChange}
        onToggleFolder={props.onToggleFolder}
      />
    </div>
  );
}

type TopicTreeNodeProps = Omit<TopicTreeProps, "root"> & {
  node: LibraryNode;
  depth: number;
};

function TopicTreeNode({
  activeTopic,
  collapsedFolders,
  dragTarget,
  draggedFilePath,
  filesByTopic,
  mode,
  node,
  depth,
  selectedFilePath,
  onDragLeave,
  onDragTarget,
  onDropToTopic,
  onFileDragEnd,
  onFileDragStart,
  onFileSelect,
  onContextMenu,
  onRevealPath,
  onTopicChange,
  onToggleFolder
}: TopicTreeNodeProps) {
  const tooltip = useContext(HoverTooltipContext);
  const isRoot = node.path === "";
  const isActive = node.path === activeTopic;
  const isDropTarget = dragTarget?.path === node.path;
  const files = mode === "all" ? filesByTopic.get(node.path) ?? EMPTY_ITEMS : EMPTY_ITEMS;
  const canCollapse = node.children.length > 0 || files.length > 0;
  const isCollapsed = canCollapse && collapsedFolders.has(node.path);
  const nodeLabel = isRoot ? "全部主题" : node.name;

  return (
    <div className="topic-node">
      <div
        className={[
          "topic-button",
          isActive ? "active" : "",
          isDropTarget ? "drop-target" : ""
        ].filter(Boolean).join(" ")}
        data-drop-action={isDropTarget ? dragTarget?.action : undefined}
        style={{ "--topic-depth": depth } as React.CSSProperties}
        onBlur={tooltip.hide}
        onDragOver={(event) => onDragTarget(node.path, event)}
        onDragLeave={onDragLeave}
        onDrop={(event) => onDropToTopic(node.path, event)}
        onFocus={() => tooltip.show(nodeLabel)}
        onContextMenu={(event) => onContextMenu({
          kind: "folder",
          path: node.path,
          label: nodeLabel
        }, event)}
        onMouseEnter={() => tooltip.show(nodeLabel)}
        onMouseLeave={tooltip.hide}
      >
        {canCollapse ? (
          <button
            className="topic-fold"
            type="button"
            aria-label={`${isCollapsed ? "展开" : "折叠"}${node.name}`}
            aria-expanded={!isCollapsed}
            data-collapsed={isCollapsed ? "true" : undefined}
            title={isCollapsed ? "展开文件夹" : "折叠文件夹"}
            onClick={() => onToggleFolder(node.path)}
          >
            <ChevronDown aria-hidden="true" />
          </button>
        ) : (
          <span className="topic-fold-placeholder" aria-hidden="true" />
        )}
        <button
          className="topic-select"
          type="button"
          onClick={() => onTopicChange(node.path)}
        >
          <span className="topic-main">
            <Folder aria-hidden="true" />
            <span className="topic-name">{nodeLabel}</span>
          </span>
        </button>
        <span className="topic-count">{node.count}</span>
        <button
          className="topic-reveal"
          type="button"
          aria-label={`在资源管理器中显示${isRoot ? "全部主题" : node.name}`}
          title="在资源管理器中显示"
          onClick={() => onRevealPath(node.path, "folder")}
        >
          <ExternalLink aria-hidden="true" />
        </button>
      </div>
      {!isCollapsed && node.children.length ? (
        <div className="topic-children">
          {node.children.map((child) => (
            <TopicTreeNode
              activeTopic={activeTopic}
              collapsedFolders={collapsedFolders}
              dragTarget={dragTarget}
              draggedFilePath={draggedFilePath}
              filesByTopic={filesByTopic}
              key={child.path}
              mode={mode}
              node={child}
              depth={depth + 1}
              selectedFilePath={selectedFilePath}
              onDragLeave={onDragLeave}
              onDragTarget={onDragTarget}
              onDropToTopic={onDropToTopic}
              onFileDragEnd={onFileDragEnd}
              onFileDragStart={onFileDragStart}
              onFileSelect={onFileSelect}
              onContextMenu={onContextMenu}
              onRevealPath={onRevealPath}
              onTopicChange={onTopicChange}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      ) : null}
      {!isCollapsed && files.length ? (
        <div className="topic-files" style={{ "--topic-depth": depth + 1 } as React.CSSProperties}>
          {files.map((item) => (
            <div
              className={[
                "topic-button",
                "file-node",
                item.relativePath === selectedFilePath ? "active" : "",
                item.relativePath === draggedFilePath ? "drag-source" : ""
              ].filter(Boolean).join(" ")}
              draggable
              key={item.id}
              style={{ "--topic-depth": depth + 1 } as React.CSSProperties}
              onBlur={tooltip.hide}
              onDragEnd={onFileDragEnd}
              onDragOver={(event) => event.stopPropagation()}
              onDragStart={(event) => onFileDragStart(item, event)}
              onDrop={(event) => event.stopPropagation()}
              onFocus={() => tooltip.show(item.title)}
              onContextMenu={(event) => onContextMenu({
                kind: "file",
                path: item.relativePath,
                parentPath: parentPathFromRelativePath(item.relativePath),
                label: item.title
              }, event)}
              onMouseEnter={() => tooltip.show(item.title)}
              onMouseLeave={tooltip.hide}
            >
              <span className="topic-fold-placeholder" aria-hidden="true" />
              <button
                className="topic-select"
                type="button"
                onClick={() => onFileSelect(item.relativePath)}
              >
                <span className="topic-main">
                  <FileIcon className="file-type-icon" item={item} />
                  <span className="topic-name">{item.title}</span>
                </span>
              </button>
              <span className="topic-file-kind">{fileDisplayLabel(item)}</span>
              <button
                className="topic-reveal"
                type="button"
                aria-label={`在资源管理器中显示${item.title}`}
                title="在资源管理器中显示"
                onClick={() => onRevealPath(item.relativePath, "file")}
              >
                <ExternalLink aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DetailTagFilter({
  visibleTags,
  onShowAll,
  onToggle
}: {
  visibleTags: Set<DetailTagId>;
  onShowAll: () => void;
  onToggle: (tagId: DetailTagId) => void;
}) {
  const allVisible = DETAIL_TAG_OPTIONS.every((option) => visibleTags.has(option.value));

  return (
    <div className="detail-tag-filter" aria-label="详情标签筛选">
      <button className="detail-tag-filter-title" type="button" aria-haspopup="true">
        <Tags aria-hidden="true" />
        <span>详情标签</span>
        <ChevronDown className="detail-tag-filter-chevron" aria-hidden="true" />
      </button>
      <div className="detail-tag-popover">
        <div className="detail-tag-options">
          {DETAIL_TAG_OPTIONS.map((option) => {
            const isVisible = visibleTags.has(option.value);
            return (
              <button
                className={isVisible ? "detail-tag-option active" : "detail-tag-option"}
                key={option.value}
                type="button"
                aria-pressed={isVisible}
                onClick={() => onToggle(option.value)}
              >
                {isVisible ? <Check aria-hidden="true" /> : <span className="detail-tag-option-dot" aria-hidden="true" />}
                <span>{option.label}</span>
              </button>
            );
          })}
          <button
            className="detail-tag-option"
            type="button"
            disabled={allVisible}
            onClick={onShowAll}
          >
            <span className="detail-tag-option-dot" aria-hidden="true" />
            <span>全部</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailTagList({ tags }: { tags: DetailTag[] }) {
  if (!tags.length) {
    return null;
  }

  return (
    <div className="file-meta">
      {tags.map((tag, index) => <span key={`${tag.id}-${tag.label}-${index}`}>{tag.label}</span>)}
    </div>
  );
}

function FolderCard({
  folder,
  visibleTags,
  onOpen
}: {
  folder: LibraryNode;
  visibleTags: Set<DetailTagId>;
  onOpen: (folderPath: string) => void;
}) {
  const detailTags = filterDetailTags(folderDetailTags(folder), visibleTags);

  return (
    <article className="file-card folder-card">
      <button className="file-card-button" type="button" onClick={() => onOpen(folder.path)}>
        <span className="folder-card-icon">
          <Folder aria-hidden="true" />
        </span>
        <span className="file-main">
          <FullText className="file-title" text={folder.name}>{folder.name}</FullText>
          <FullText className="file-path" text={folder.path}>{folder.path || "根目录"}</FullText>
        </span>
      </button>
      <DetailTagList tags={detailTags} />
    </article>
  );
}

function FileCardPreview({ item, visualKind }: { item: LibraryItem; visualKind: FileVisualKind }) {
  if (visualKind === "image") {
    return (
      <span className="file-image-preview" aria-hidden="true">
        <img src={item.url} alt="" loading="lazy" decoding="async" />
      </span>
    );
  }

  return <FileIcon className="file-icon" item={item} />;
}

function FileCard({
  item,
  visibleTags,
  onContextMenu,
  onOpen,
  onReveal
}: {
  item: LibraryItem;
  visibleTags: Set<DetailTagId>;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onOpen: (relativePath: string) => void;
  onReveal: (relativePath: string) => void;
}) {
  const detailTags = filterDetailTags(fileDetailTags(item), visibleTags);
  const visualKind = fileVisualKind(item);

  return (
    <article className="file-card" onContextMenu={onContextMenu}>
      <button
        className="file-card-reveal"
        type="button"
        aria-label={`在资源管理器中显示${item.title}`}
        title="在资源管理器中显示"
        onClick={(event) => {
          event.stopPropagation();
          onReveal(item.relativePath);
        }}
      >
        <ExternalLink aria-hidden="true" />
      </button>
      <button
        className="file-card-button"
        type="button"
        data-preview={visualKind === "image" ? "image" : undefined}
        onClick={() => onOpen(item.relativePath)}
      >
        <FileCardPreview item={item} visualKind={visualKind} />
        <span className="file-main">
          <FullText className="file-title" text={item.title}>{item.title}</FullText>
          <FullText className="file-path" text={item.relativePath}>{item.relativePath}</FullText>
        </span>
      </button>
      <DetailTagList tags={detailTags} />
    </article>
  );
}

type ReaderProps = {
  item: LibraryItem;
  navigationItems: LibraryItem[];
  onBack: () => void;
  onOpen: (relativePath: string) => void;
  onRefresh: () => void;
};

function Reader({ item, navigationItems, onBack, onOpen, onRefresh }: ReaderProps) {
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const currentIndex = navigationItems.findIndex((candidate) => candidate.relativePath === item.relativePath);
  const previous = currentIndex > 0 ? navigationItems[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < navigationItems.length - 1 ? navigationItems[currentIndex + 1] : null;
  const handleReaderKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape" && isControlsOpen) {
      setIsControlsOpen(false);
      return;
    }
    if (event.key === "Escape") {
      onBack();
    }
    if (event.key === "ArrowLeft" && previous) {
      onOpen(previous.relativePath);
    }
    if (event.key === "ArrowRight" && next) {
      onOpen(next.relativePath);
    }
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      handleReaderKey(event);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="reader-shell">
      <ReaderControls
        isOpen={isControlsOpen}
        item={item}
        navigationItems={navigationItems}
        next={next}
        previous={previous}
        onBack={onBack}
        onOpen={onOpen}
        onRefresh={onRefresh}
        onToggleOpen={setIsControlsOpen}
      />
      <ReaderSurface item={item} />
    </div>
  );
}

type ReaderControlsProps = {
  isOpen: boolean;
  item: LibraryItem;
  navigationItems: LibraryItem[];
  next: LibraryItem | null;
  previous: LibraryItem | null;
  onBack: () => void;
  onOpen: (relativePath: string) => void;
  onRefresh: () => void;
  onToggleOpen: (isOpen: boolean) => void;
};

function ReaderControls(props: ReaderControlsProps) {
  const prefersReducedMotion = useReducedMotion();
  const tooltip = useContext(HoverTooltipContext);
  const [viewport, setViewport] = useState(() => getViewportSize());
  const [ballPosition, setBallPosition] = useState(() => {
    const stored = readStoredReaderControlState();
    return clampReaderControlPosition(stored?.position ?? getDefaultReaderControlPosition(), getViewportSize());
  });
  const [panelPlacement, setPanelPlacement] = useState(() => {
    const initialViewport = getViewportSize();
    const stored = readStoredReaderControlState();
    const initialPosition = clampReaderControlPosition(stored?.position ?? getDefaultReaderControlPosition(initialViewport), initialViewport);
    return getReaderPanelPlacement(initialPosition, initialViewport);
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPosition: Point;
  } | null>(null);
  const didDragRef = useRef(false);

  useEffect(() => {
    const handleResize = () => {
      const nextViewport = getViewportSize();
      setViewport(nextViewport);
      setBallPosition((current) => {
        const next = clampReaderControlPosition(current, nextViewport);
        const nextPanelPlacement = getReaderPanelPlacement(next, nextViewport);
        setPanelPlacement(nextPanelPlacement);
        saveReaderControlState(next, nextPanelPlacement);
        return next;
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const dockTarget = getReaderControlTarget(ballPosition, props.isOpen, viewport, panelPlacement);
  const dockTransition: Transition = isDragging || prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 430, damping: 38, mass: 0.72 };
  const panelTransition: Transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.2, ease: MOTION_EASE_OUT, delay: props.isOpen ? 0.12 : 0 };
  const itemTransition: Transition = prefersReducedMotion ? { duration: 0 } : { duration: 0.18, ease: MOTION_EASE_OUT };
  const panelExitTransition: Transition = prefersReducedMotion ? { duration: 0 } : { duration: 0.08, ease: MOTION_EASE_OUT };
  const itemExitTransition: Transition = prefersReducedMotion ? { duration: 0 } : { duration: 0.07, ease: MOTION_EASE_OUT };
  const floatIconTransition: Transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.12, ease: MOTION_EASE_OUT };
  const controlItemInTransition: Transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.16, ease: MOTION_EASE_OUT };
  const actionListVariants = {
    open: {
      opacity: 1,
      transition: {
        delayChildren: prefersReducedMotion ? 0 : 0.13,
        staggerChildren: prefersReducedMotion ? 0 : 0.028,
        staggerDirection: -1
      }
    },
    closed: {
      opacity: 0,
      transition: {
        duration: prefersReducedMotion ? 0 : 0.06,
        staggerChildren: 0,
        staggerDirection: 1
      }
    }
  };
  const actionButtonVariants = {
    open: {
      opacity: 1,
      scale: 1,
      x: 0,
      transition: controlItemInTransition
    },
    closed: {
      opacity: 0,
      scale: 0.96,
      x: 8,
      transition: itemExitTransition
    }
  };
  const navigationOptions = useMemo<Array<SelectOption<string>>>(() => {
    const options = props.navigationItems.map((candidate) => ({
      value: candidate.relativePath,
      label: candidate.title
    }));
    if (options.some((option) => option.value === props.item.relativePath)) {
      return options;
    }
    return [{ value: props.item.relativePath, label: props.item.title }, ...options];
  }, [props.item.relativePath, props.item.title, props.navigationItems]);

  useEffect(() => {
    if (!props.isOpen) {
      tooltip.setAnchor(null);
      return;
    }

    tooltip.setAnchor({
      x: dockTarget.x,
      y: dockTarget.y,
      width: dockTarget.width,
      height: dockTarget.height,
      panelPlacement
    });

    return () => tooltip.setAnchor(null);
  }, [
    dockTarget.height,
    dockTarget.width,
    dockTarget.x,
    dockTarget.y,
    panelPlacement,
    props.isOpen,
    tooltip
  ]);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (props.isOpen || event.button !== 0) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: ballPosition
    };
    didDragRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (!didDragRef.current && Math.hypot(deltaX, deltaY) < READER_DRAG_THRESHOLD) {
      return;
    }

    didDragRef.current = true;
    setIsDragging(true);
    setBallPosition(clampReaderControlPosition({
      x: dragState.startPosition.x + deltaX,
      y: dragState.startPosition.y + deltaY
    }, viewport));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!didDragRef.current) {
      props.onToggleOpen(true);
      return;
    }

    const nextPosition = clampReaderControlPosition({
      x: dragState.startPosition.x + event.clientX - dragState.startX,
      y: dragState.startPosition.y + event.clientY - dragState.startY
    }, viewport);
    const nextPanelPlacement = getReaderPanelPlacement(nextPosition, viewport);
    setBallPosition(nextPosition);
    setPanelPlacement(nextPanelPlacement);
    saveReaderControlState(nextPosition, nextPanelPlacement);
  };

  const closePanel = () => {
    if (props.isOpen) {
      tooltip.hide();
      props.onToggleOpen(false);
    }
  };

  const closePanelFromLayer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (props.isOpen && event.target === event.currentTarget) {
      closePanel();
    }
  };

  return (
    <LazyMotion features={domMax}>
      <div
        className={props.isOpen ? "reader-control-layer active" : "reader-control-layer"}
        onPointerDown={closePanelFromLayer}
      >
        <m.div
          className={props.isOpen ? "reader-control-dock expanded" : "reader-control-dock compact"}
          animate={dockTarget}
          initial={false}
          transition={dockTransition}
          onPointerDown={beginDrag}
          onPointerMove={updateDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <m.button
            className="reader-float-button"
            type="button"
            aria-expanded={props.isOpen}
            aria-label={props.isOpen ? "收起阅读控制" : "展开阅读控制"}
            onClick={closePanel}
            whileTap={{ scale: 0.94 }}
          >
            <AnimatePresence initial={false} mode="wait">
              <m.span
                className="reader-float-icon"
                key={props.isOpen ? "close" : "menu"}
                initial={{ opacity: 0, scale: 0.86, rotate: props.isOpen ? -8 : 8 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.86, rotate: props.isOpen ? 8 : -8 }}
                transition={floatIconTransition}
              >
                {props.isOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
              </m.span>
            </AnimatePresence>
          </m.button>

          <AnimatePresence initial={false}>
            {props.isOpen ? (
              <m.div
                className="reader-control-panel"
                key="reader-control-panel"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: panelExitTransition }}
                transition={panelTransition}
              >
                <m.div
                  className="reader-control-header"
                  initial={{ opacity: 0, scale: 0.98, x: 14 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.98, x: 8, transition: itemExitTransition }}
                  transition={controlItemInTransition}
                >
                  <div>
                    <p>阅读控制</p>
                    <FullText text={props.item.title}>{props.item.title}</FullText>
                  </div>
                </m.div>

                <m.div
                  className="reader-control-actions"
                  initial="closed"
                  animate="open"
                  exit="closed"
                  variants={actionListVariants}
                >
                  <m.button
                    className="icon-button"
                    type="button"
                    title="返回文件列表"
                    aria-label="返回文件列表"
                    onClick={props.onBack}
                    variants={actionButtonVariants}
                  >
                    <Home aria-hidden="true" />
                  </m.button>
                  <m.button
                    className="icon-button"
                    type="button"
                    title="上一个文件"
                    aria-label="上一个文件"
                    disabled={!props.previous}
                    onClick={() => props.previous && props.onOpen(props.previous.relativePath)}
                    variants={actionButtonVariants}
                  >
                    <ArrowLeft aria-hidden="true" />
                  </m.button>
                  <m.button
                    className="icon-button"
                    type="button"
                    title="下一个文件"
                    aria-label="下一个文件"
                    disabled={!props.next}
                    onClick={() => props.next && props.onOpen(props.next.relativePath)}
                    variants={actionButtonVariants}
                  >
                    <ArrowRight aria-hidden="true" />
                  </m.button>
                  <m.button
                    className="icon-button"
                    type="button"
                    title="刷新索引"
                    aria-label="刷新索引"
                    onClick={props.onRefresh}
                    variants={actionButtonVariants}
                  >
                    <RefreshCw aria-hidden="true" />
                  </m.button>
                  <m.a
                    className="icon-button"
                    href={props.item.url}
                    target="_blank"
                    rel="noreferrer"
                    title="新标签打开"
                    aria-label="新标签打开"
                    variants={actionButtonVariants}
                  >
                    <ExternalLink aria-hidden="true" />
                  </m.a>
                </m.div>

                <m.div
                  className="reader-select-wrap"
                  initial={{ opacity: 0, scale: 0.98, x: 14 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.98, x: 8, transition: itemExitTransition }}
                  transition={controlItemInTransition}
                >
                  <MotionSelect
                    ariaLabel="切换文件"
                    className="reader-select-control"
                    maxVisibleItems={8}
                    options={navigationOptions}
                    value={props.item.relativePath}
                    onChange={props.onOpen}
                  />
                </m.div>
              </m.div>
            ) : null}
          </AnimatePresence>
        </m.div>
      </div>
    </LazyMotion>
  );
}

function ReaderSurface({ item }: { item: LibraryItem }) {
  if (item.kind === "html") {
    return (
      <iframe
        className="reader-frame"
        title={item.title}
        src={item.url}
        sandbox="allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts"
      />
    );
  }

  if (item.kind === "pdf") {
    return (
      <object
        className="reader-frame"
        data={item.url}
        type="application/pdf"
        aria-label={item.title}
      >
        <div className="unsupported-reader">
          <div>
            <p className="eyebrow">PDF</p>
            <h1>{item.title}</h1>
            <p>{item.relativePath}</p>
            <a className="button primary" href={item.url} target="_blank" rel="noreferrer">
              打开文件
            </a>
          </div>
        </div>
      </object>
    );
  }

  if (item.kind === "image") {
    return (
      <div className="reader-media">
        <img src={item.url} alt={item.title} decoding="async" />
      </div>
    );
  }

  if (item.kind === "markdown" || item.kind === "text") {
    return <TextPreview item={item} key={item.relativePath} />;
  }

  return (
    <div className="unsupported-reader">
      <div>
        <p className="eyebrow">File</p>
        <h1>{item.title}</h1>
        <p>{item.relativePath}</p>
        <a className="button primary" href={item.url} target="_blank" rel="noreferrer">
          打开文件
        </a>
      </div>
    </div>
  );
}

function TextPreview({ item }: { item: LibraryItem }) {
  const contentUrl = `${item.url}?v=${Math.round(item.mtimeMs)}`;

  return (
    <TextPreviewErrorBoundary resetKey={contentUrl}>
      <Suspense fallback={<article className="text-preview"><pre> </pre></article>}>
        <ResolvedTextPreview contentUrl={contentUrl} item={item} />
      </Suspense>
    </TextPreviewErrorBoundary>
  );
}

function ResolvedTextPreview({ contentUrl, item }: { contentUrl: string; item: LibraryItem }) {
  const content = use(loadTextContent(contentUrl));

  if (item.kind === "markdown") {
    return (
      <article className="text-preview markdown-preview">
        <MarkdownContent source={content} />
      </article>
    );
  }

  return (
    <article className="text-preview">
      <pre>{content}</pre>
    </article>
  );
}

function MarkdownContent({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);

  if (!blocks.length) {
    return <p> </p>;
  }

  return blocks.map((block) => {
    if (block.type === "ul") {
      return (
        <ul key={`ul-${block.items.join("|")}`}>
          {block.items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      );
    }

    const Tag = block.type;
    return <Tag key={`${block.type}-${block.text}`}>{block.text}</Tag>;
  });
}

export default App;
