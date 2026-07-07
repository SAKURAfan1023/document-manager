import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ExternalLink,
  File,
  FileText,
  Folder,
  Home,
  Image,
  ListFilter,
  Menu,
  RefreshCw,
  Search,
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
import type { Transition } from "framer-motion";
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react";
import type {
  LibraryItem,
  LibraryKind,
  LibraryNode,
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
  status: "idle" | "dragging" | "uploading" | "success" | "error";
  targetPath: string;
  message: string;
};

type TreeDisplayMode = "folders" | "all";

type SelectOption<TValue extends string> = {
  value: TValue;
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
const EMPTY_ITEMS: LibraryItem[] = [];
const EMPTY_TOPICS: TopicOption[] = [];
const LOCATION_CHANGE_EVENT = "document-gallery-location-change";
const LIBRARY_REFRESH_INTERVAL_MS = 30_000;
const DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});
const TEXT_CONTENT_CACHE = new Map<string, Promise<string>>();
const READER_CONTROLS_STORAGE_KEY = "document-gallery-reader-controls-position";
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

function isTopicMatch(item: LibraryItem, activeTopic: string) {
  if (!activeTopic) {
    return true;
  }
  const itemTopic = item.topicPath.join("/");
  return itemTopic === activeTopic || itemTopic.startsWith(`${activeTopic}/`);
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

function kindIcon(kind: LibraryKind) {
  if (kind === "image") {
    return <Image aria-hidden="true" />;
  }
  if (kind === "markdown" || kind === "text" || kind === "pdf") {
    return <FileText aria-hidden="true" />;
  }
  return <File aria-hidden="true" />;
}

function treeFileIcon(kind: LibraryKind) {
  if (kind === "image") {
    return <Image aria-hidden="true" />;
  }
  if (kind === "html") {
    return <File aria-hidden="true" />;
  }
  return <FileText aria-hidden="true" />;
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

  return { library, isLoading, error, refresh, uploadFiles };
}

function App() {
  const { library, isLoading, error, refresh, uploadFiles } = useLibrary();
  const [query, setQuery] = useState("");
  const [activeKind, setActiveKind] = useState<LibraryKind | "all">("all");
  const [activeTopic, setActiveTopic] = useState("");
  const [treeMode, setTreeMode] = useState<TreeDisplayMode>("folders");
  const [selectedTreeFilePath, setSelectedTreeFilePath] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("library");
  const selectedPath = useSyncExternalStore(subscribeSelectedPath, getSelectedPathFromLocation, () => null);

  const items = library?.items ?? EMPTY_ITEMS;
  const topics = useMemo(() => library ? flattenTopics(library.tree) : EMPTY_TOPICS, [library]);
  const selectedTreeFile = useMemo(
    () => selectedTreeFilePath ? items.find((item) => item.relativePath === selectedTreeFilePath) ?? null : null,
    [items, selectedTreeFilePath]
  );
  const effectiveSelectedTreeFilePath = selectedTreeFile ? selectedTreeFilePath : null;

  const filteredItems = useMemo(() => {
    if (selectedTreeFile) {
      return [selectedTreeFile];
    }

    const filtered = items.filter((item) => {
      const kindMatches = activeKind === "all" || item.kind === activeKind;
      return kindMatches && isTopicMatch(item, activeTopic) && matchesQuery(item, query);
    });
    return sortItems(filtered, sortMode);
  }, [activeKind, activeTopic, items, query, selectedTreeFile, sortMode]);

  const selectedItem = useMemo(
    () => items.find((item) => item.relativePath === selectedPath) ?? null,
    [items, selectedPath]
  );

  const openItem = useCallback((relativePath: string) => {
    setSelectedPathInLocation(relativePath);
  }, []);

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
        filteredItems={filteredItems}
        generatedAt={library?.generatedAt ?? null}
        isLoading={isLoading}
        items={items}
        missingPath={selectedPath}
        query={query}
        sortMode={sortMode}
        tree={library?.tree ?? null}
        treeMode={treeMode}
        topics={topics}
        selectedTreeFile={selectedTreeFile}
        selectedTreeFilePath={effectiveSelectedTreeFilePath}
        onClearMissing={returnToLibrary}
        onKindChange={setActiveKind}
        onOpen={openItem}
        onQueryChange={setQuery}
        onRefresh={refresh}
        onSelectTreeFile={selectTreeFile}
        onSortChange={setSortMode}
        onTopicChange={selectTopic}
        onTreeModeChange={changeTreeMode}
        onUploadFiles={uploadFiles}
      />
    </HoverTooltipProvider>
  );
}

type LibraryHomeProps = {
  activeKind: LibraryKind | "all";
  activeTopic: string;
  error: string | null;
  filteredItems: LibraryItem[];
  generatedAt: string | null;
  isLoading: boolean;
  items: LibraryItem[];
  missingPath: string | null;
  query: string;
  selectedTreeFile: LibraryItem | null;
  selectedTreeFilePath: string | null;
  sortMode: SortMode;
  tree: LibraryNode | null;
  treeMode: TreeDisplayMode;
  topics: TopicOption[];
  onClearMissing: () => void;
  onKindChange: (kind: LibraryKind | "all") => void;
  onOpen: (relativePath: string) => void;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
  onSelectTreeFile: (relativePath: string) => void;
  onSortChange: (sortMode: SortMode) => void;
  onTopicChange: (topic: string) => void;
  onTreeModeChange: (mode: TreeDisplayMode) => void;
  onUploadFiles: (targetPath: string, files: File[]) => Promise<LibraryUploadResponse>;
};

function LibraryHome(props: LibraryHomeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({
    status: "idle",
    targetPath: "",
    message: "选择或拖入文件"
  });
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
      const result = await props.onUploadFiles(targetPath, visibleFiles);
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
  }, [props.onUploadFiles]);

  const dropFilesToTopic = useCallback((targetPath: string, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragTarget(null);

    if (hasDirectoryItems(event.dataTransfer)) {
      setUploadState({
        status: "error",
        targetPath,
        message: "暂不支持拖入文件夹"
      });
      return;
    }

    void uploadToTopic(targetPath, event.dataTransfer.files);
  }, [uploadToTopic]);

  const markDragTarget = useCallback((targetPath: string, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragTarget(targetPath);
    setUploadState((current) => current.status === "uploading"
      ? current
      : {
        status: "dragging",
        targetPath,
        message: targetPath ? `添加到 ${targetPath}` : "添加到根目录"
      });
  }, []);

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

  return (
    <div className="app-shell">
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

      <main className="catalog-layout">
        <aside className="sidebar-panel" aria-label="主题目录">
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
            data-active={dragTarget === "" ? "true" : undefined}
            onDragOver={(event) => markDragTarget("", event)}
            onDragLeave={clearDragTarget}
            onDrop={(event) => dropFilesToTopic("", event)}
          >
            <Upload aria-hidden="true" />
            <span>{uploadState.message}</span>
          </div>
          {props.tree ? (
            <TopicTree
              activeTopic={props.activeTopic}
              dragTarget={dragTarget}
              filesByTopic={filesByTopic}
              mode={props.treeMode}
              root={props.tree}
              selectedFilePath={props.selectedTreeFilePath}
              onDragLeave={clearDragTarget}
              onDragTarget={markDragTarget}
              onDropFiles={dropFilesToTopic}
              onFileSelect={props.onSelectTreeFile}
              onTopicChange={props.onTopicChange}
            />
          ) : (
            <div className="topic-list empty">等待索引</div>
          )}
        </aside>

        <section className="library-content" aria-label="文件列表">
          <div className="library-hero">
            <div>
              <p className="eyebrow">Library</p>
              <h1>所有文件，一个入口。</h1>
            </div>
            <p>
              HTML 在平台内全屏打开，PDF、图片、Markdown 和文本直接预览，其余文件保留打开入口。
            </p>
          </div>

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

          {props.isLoading ? (
            <div className="file-grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="file-card skeleton" key={index} />
              ))}
            </div>
          ) : props.filteredItems.length ? (
            <div className="file-grid">
              {props.filteredItems.map((item) => (
                <FileCard item={item} key={item.id} onOpen={props.onOpen} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h2>这里暂时没有匹配文件</h2>
              <p>调整搜索、主题或文件类型后，列表会立即更新。</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

type TopicTreeProps = {
  activeTopic: string;
  dragTarget: string | null;
  filesByTopic: Map<string, LibraryItem[]>;
  mode: TreeDisplayMode;
  root: LibraryNode;
  selectedFilePath: string | null;
  onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  onDragTarget: (targetPath: string, event: ReactDragEvent<HTMLElement>) => void;
  onDropFiles: (targetPath: string, event: ReactDragEvent<HTMLElement>) => void;
  onFileSelect: (relativePath: string) => void;
  onTopicChange: (topic: string) => void;
};

function TopicTree(props: TopicTreeProps) {
  return (
    <div
      className="topic-list"
      onDragOver={(event) => props.onDragTarget("", event)}
      onDragLeave={props.onDragLeave}
      onDrop={(event) => props.onDropFiles("", event)}
    >
      <TopicTreeNode
        activeTopic={props.activeTopic}
        dragTarget={props.dragTarget}
        filesByTopic={props.filesByTopic}
        mode={props.mode}
        node={props.root}
        depth={0}
        selectedFilePath={props.selectedFilePath}
        onDragLeave={props.onDragLeave}
        onDragTarget={props.onDragTarget}
        onDropFiles={props.onDropFiles}
        onFileSelect={props.onFileSelect}
        onTopicChange={props.onTopicChange}
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
  dragTarget,
  filesByTopic,
  mode,
  node,
  depth,
  selectedFilePath,
  onDragLeave,
  onDragTarget,
  onDropFiles,
  onFileSelect,
  onTopicChange
}: TopicTreeNodeProps) {
  const isRoot = node.path === "";
  const isActive = node.path === activeTopic;
  const isDropTarget = dragTarget === node.path;
  const files = mode === "all" ? filesByTopic.get(node.path) ?? EMPTY_ITEMS : EMPTY_ITEMS;

  return (
    <div className="topic-node">
      <button
        className={[
          "topic-button",
          isActive ? "active" : "",
          isDropTarget ? "drop-target" : ""
        ].filter(Boolean).join(" ")}
        style={{ "--topic-depth": depth } as React.CSSProperties}
        type="button"
        onClick={() => onTopicChange(node.path)}
        onDragOver={(event) => onDragTarget(node.path, event)}
        onDragLeave={onDragLeave}
        onDrop={(event) => onDropFiles(node.path, event)}
      >
        <span className="topic-main">
          <Folder aria-hidden="true" />
          <span className="topic-name">{isRoot ? "全部主题" : node.name}</span>
        </span>
        <span className="topic-count">{node.count}</span>
      </button>
      {node.children.length ? (
        <div className="topic-children">
          {node.children.map((child) => (
            <TopicTreeNode
              activeTopic={activeTopic}
              dragTarget={dragTarget}
              filesByTopic={filesByTopic}
              key={child.path}
              mode={mode}
              node={child}
              depth={depth + 1}
              selectedFilePath={selectedFilePath}
              onDragLeave={onDragLeave}
              onDragTarget={onDragTarget}
              onDropFiles={onDropFiles}
              onFileSelect={onFileSelect}
              onTopicChange={onTopicChange}
            />
          ))}
        </div>
      ) : null}
      {files.length ? (
        <div className="topic-files">
          {files.map((item) => (
            <button
              className={[
                "topic-button",
                "file-node",
                item.relativePath === selectedFilePath ? "active" : ""
              ].filter(Boolean).join(" ")}
              key={item.id}
              style={{ "--topic-depth": depth + 1 } as React.CSSProperties}
              type="button"
              onClick={() => onFileSelect(item.relativePath)}
            >
              <span className="topic-main">
                {treeFileIcon(item.kind)}
                <span className="topic-name">{item.title}</span>
              </span>
              <span className="topic-file-kind">{KIND_LABELS[item.kind]}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FileCard({ item, onOpen }: { item: LibraryItem; onOpen: (relativePath: string) => void }) {
  return (
    <article className="file-card">
      <button className="file-card-button" type="button" onClick={() => onOpen(item.relativePath)}>
        <span className="file-icon">{kindIcon(item.kind)}</span>
        <span className="file-main">
          <FullText className="file-title" text={item.title}>{item.title}</FullText>
          <FullText className="file-path" text={item.relativePath}>{item.relativePath}</FullText>
        </span>
      </button>
      <div className="file-meta">
        <span>{KIND_LABELS[item.kind]}</span>
        <span>{topicLabel(item.topicPath)}</span>
        <span>{formatSize(item.size)}</span>
        <span>{formatDate(item.mtimeMs)}</span>
      </div>
      {item.tags?.length ? (
        <div className="tag-row">
          {item.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      ) : null}
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
  if (item.kind === "html" || item.kind === "pdf") {
    return (
      <iframe
        className="reader-frame"
        title={item.title}
        src={item.url}
        sandbox="allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts"
      />
    );
  }

  if (item.kind === "image") {
    return (
      <div className="reader-media">
        <img src={item.url} alt={item.title} />
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
