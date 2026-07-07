import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ExternalLink,
  File,
  FileText,
  Folder,
  Home,
  Image,
  ListFilter,
  RefreshCw,
  Search
} from "lucide-react";
import {
  Component,
  Suspense,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  useSyncExternalStore
} from "react";
import type { LibraryItem, LibraryKind, LibraryNode, LibraryResponse, SortMode } from "./types";

type TopicOption = {
  path: string;
  name: string;
  count: number;
  depth: number;
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
const EMPTY_ITEMS: LibraryItem[] = [];
const EMPTY_TOPICS: TopicOption[] = [];
const LOCATION_CHANGE_EVENT = "document-gallery-location-change";
const DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});
const TEXT_CONTENT_CACHE = new Map<string, Promise<string>>();

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

function useLibrary() {
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/library?t=${Date.now()}`);
      if (!response.ok) {
        throw new Error(`索引读取失败：${response.status}`);
      }
      setLibrary(await response.json() as LibraryResponse);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "索引读取失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { library, isLoading, error, refresh };
}

function App() {
  const { library, isLoading, error, refresh } = useLibrary();
  const [query, setQuery] = useState("");
  const [activeKind, setActiveKind] = useState<LibraryKind | "all">("all");
  const [activeTopic, setActiveTopic] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("library");
  const selectedPath = useSyncExternalStore(subscribeSelectedPath, getSelectedPathFromLocation, () => null);

  const items = library?.items ?? EMPTY_ITEMS;
  const topics = useMemo(() => library ? flattenTopics(library.tree) : EMPTY_TOPICS, [library]);
  const filteredItems = useMemo(() => {
    const filtered = items.filter((item) => {
      const kindMatches = activeKind === "all" || item.kind === activeKind;
      return kindMatches && isTopicMatch(item, activeTopic) && matchesQuery(item, query);
    });
    return sortItems(filtered, sortMode);
  }, [activeKind, activeTopic, items, query, sortMode]);

  const selectedItem = useMemo(
    () => items.find((item) => item.relativePath === selectedPath) ?? null,
    [items, selectedPath]
  );

  const openItem = useCallback((relativePath: string) => {
    setSelectedPathInLocation(relativePath);
  }, []);

  const returnToLibrary = useCallback(() => {
    setSelectedPathInLocation(null);
  }, []);

  if (selectedPath && selectedItem) {
    return (
      <Reader
        item={selectedItem}
        navigationItems={filteredItems.length ? filteredItems : items}
        onBack={returnToLibrary}
        onOpen={openItem}
        onRefresh={refresh}
      />
    );
  }

  return (
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
      topics={topics}
      onClearMissing={returnToLibrary}
      onKindChange={setActiveKind}
      onOpen={openItem}
      onQueryChange={setQuery}
      onRefresh={refresh}
      onSortChange={setSortMode}
      onTopicChange={setActiveTopic}
    />
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
  sortMode: SortMode;
  topics: TopicOption[];
  onClearMissing: () => void;
  onKindChange: (kind: LibraryKind | "all") => void;
  onOpen: (relativePath: string) => void;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
  onSortChange: (sortMode: SortMode) => void;
  onTopicChange: (topic: string) => void;
};

function LibraryHome(props: LibraryHomeProps) {
  const readableCount = props.items.filter((item) => item.kind !== "other").length;
  const topicName = props.topics.find((topic) => topic.path === props.activeTopic)?.name ?? "全部主题";

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
            <Folder aria-hidden="true" />
            <span>主题</span>
          </div>
          <div className="topic-list">
            {props.topics.map((topic) => (
              <button
                className={topic.path === props.activeTopic ? "topic-button active" : "topic-button"}
                key={topic.path || "root"}
                style={{ paddingLeft: `${14 + topic.depth * 14}px` }}
                type="button"
                onClick={() => props.onTopicChange(topic.path)}
              >
                <span>{topic.name}</span>
                <span>{topic.count}</span>
              </button>
            ))}
          </div>
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

            <label className="select-field">
              <ListFilter aria-hidden="true" />
              <select value={props.sortMode} onChange={(event) => props.onSortChange(event.target.value as SortMode)}>
                <option value="library">目录顺序</option>
                <option value="recent">最近更新</option>
                <option value="title">标题排序</option>
                <option value="type">类型排序</option>
              </select>
            </label>
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

function FileCard({ item, onOpen }: { item: LibraryItem; onOpen: (relativePath: string) => void }) {
  return (
    <article className="file-card">
      <button className="file-card-button" type="button" onClick={() => onOpen(item.relativePath)}>
        <span className="file-icon">{kindIcon(item.kind)}</span>
        <span className="file-main">
          <span className="file-title">{item.title}</span>
          <span className="file-path">{item.relativePath}</span>
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
  const [controlsVisible, setControlsVisible] = useState(true);
  const currentIndex = navigationItems.findIndex((candidate) => candidate.relativePath === item.relativePath);
  const previous = currentIndex > 0 ? navigationItems[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < navigationItems.length - 1 ? navigationItems[currentIndex + 1] : null;
  const handleReaderKey = useEffectEvent((event: KeyboardEvent) => {
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
    const timeout = window.setTimeout(() => setControlsVisible(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [item.relativePath]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (event.clientY <= 36) {
        setControlsVisible(true);
      }
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      handleReaderKey(event);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="reader-shell">
      <div className="reader-edge" onPointerEnter={() => setControlsVisible(true)} />
      <div
        className={controlsVisible ? "reader-toolbar visible" : "reader-toolbar"}
        onMouseEnter={() => setControlsVisible(true)}
        onMouseLeave={() => setControlsVisible(false)}
      >
        <button className="icon-button" type="button" title="返回文件列表" aria-label="返回文件列表" onClick={onBack}>
          <Home aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          title="上一个文件"
          aria-label="上一个文件"
          disabled={!previous}
          onClick={() => previous && onOpen(previous.relativePath)}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          title="下一个文件"
          aria-label="下一个文件"
          disabled={!next}
          onClick={() => next && onOpen(next.relativePath)}
        >
          <ArrowRight aria-hidden="true" />
        </button>

        <select
          className="reader-select"
          value={item.relativePath}
          aria-label="切换文件"
          onChange={(event) => onOpen(event.target.value)}
        >
          {navigationItems.map((candidate) => (
            <option key={candidate.id} value={candidate.relativePath}>
              {candidate.title}
            </option>
          ))}
        </select>

        <button className="icon-button" type="button" title="刷新索引" aria-label="刷新索引" onClick={onRefresh}>
          <RefreshCw aria-hidden="true" />
        </button>
        <a className="icon-button" href={item.url} target="_blank" rel="noreferrer" title="新标签打开" aria-label="新标签打开">
          <ExternalLink aria-hidden="true" />
        </a>
      </div>
      <ReaderSurface item={item} />
    </div>
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
