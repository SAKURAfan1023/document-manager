import { Maximize2, X } from "lucide-react";
import { isValidElement, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type MarkdownPreProps = ComponentPropsWithoutRef<"pre"> & {
  node?: unknown;
};

let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;
let renderSequence = 0;
const MERMAID_PREVIEW_MIN_ZOOM = 0.5;
const MERMAID_PREVIEW_MAX_ZOOM = 3;
const MERMAID_PREVIEW_ZOOM_STEP = 0.1;

export function getNextMermaidPreviewZoom(currentZoom: number, deltaY: number) {
  if (deltaY === 0) {
    return currentZoom;
  }

  const direction = deltaY < 0 ? 1 : -1;
  const nextZoom = Number((currentZoom + direction * MERMAID_PREVIEW_ZOOM_STEP).toFixed(1));
  return Math.min(MERMAID_PREVIEW_MAX_ZOOM, Math.max(MERMAID_PREVIEW_MIN_ZOOM, nextZoom));
}

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict"
      });
      return mermaid;
    });
  }

  return mermaidPromise;
}

export function getMermaidSource(children: ReactNode) {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) {
    return null;
  }

  const classNames = children.props.className?.toLowerCase().split(/\s+/) ?? [];
  if (!classNames.includes("language-mermaid") || typeof children.props.children !== "string") {
    return null;
  }

  return children.props.children.replace(/\r?\n$/, "");
}

function MermaidDiagram({ source }: { source: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [hasError, setHasError] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [renderedSvg, setRenderedSvg] = useState("");

  useEffect(() => {
    let isActive = true;
    const container = containerRef.current;
    renderSequence += 1;
    const renderId = `mermaid-${reactId}-${renderSequence}`;

    setHasError(false);
    setIsPreviewOpen(false);
    setRenderedSvg("");
    container?.replaceChildren();

    void loadMermaid()
      .then((mermaid) => mermaid.render(renderId, source))
      .then(({ svg, bindFunctions }) => {
        if (!isActive || !containerRef.current) {
          return;
        }

        containerRef.current.innerHTML = svg;
        setRenderedSvg(svg);
        bindFunctions?.(containerRef.current);
      })
      .catch(() => {
        if (isActive) {
          setHasError(true);
        }
      });

    return () => {
      isActive = false;
    };
  }, [reactId, source]);

  if (hasError) {
    return (
      <pre className="mermaid-diagram-fallback">
        <code className="language-mermaid">{source}</code>
      </pre>
    );
  }

  return (
    <>
      <button
        className="mermaid-diagram"
        type="button"
        aria-haspopup="dialog"
        aria-label="放大预览 Mermaid 图形"
        disabled={!renderedSvg}
        title="点击放大预览"
        onClick={() => setIsPreviewOpen(true)}
      >
        <span ref={containerRef} className="mermaid-diagram-canvas" role="img" aria-label="Mermaid 图形" />
        {renderedSvg ? (
          <span className="mermaid-diagram-hint" aria-hidden="true">
            <Maximize2 />
            放大预览
          </span>
        ) : null}
      </button>
      {isPreviewOpen && renderedSvg ? (
        <MermaidPreviewDialog svg={renderedSvg} onClose={() => setIsPreviewOpen(false)} />
      ) : null}
    </>
  );
}

function MermaidPreviewDialog({ svg, onClose }: { svg: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomPercent = Math.round(zoom * 100);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="mermaid-preview-dialog"
      aria-label="Mermaid 图形放大预览"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <header className="mermaid-preview-toolbar">
        <span className="mermaid-preview-zoom-status" aria-live="polite">
          {zoomPercent}% · 滚轮缩放
        </span>
        <button
          className="mermaid-preview-close"
          type="button"
          aria-label="关闭图形预览"
          title="关闭"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <div
        className="mermaid-preview-stage"
        onWheel={(event) => {
          event.preventDefault();
          setZoom((currentZoom) => getNextMermaidPreviewZoom(currentZoom, event.deltaY));
        }}
      >
        <div
          className="mermaid-preview-canvas"
          role="img"
          aria-label={`Mermaid 图形放大视图，当前缩放 ${zoomPercent}%`}
          style={{ width: `${zoomPercent}%` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </dialog>,
    document.body
  );
}

export function MarkdownPre({ children, node: _node, ...props }: MarkdownPreProps) {
  const mermaidSource = getMermaidSource(children);

  if (mermaidSource !== null) {
    return <MermaidDiagram source={mermaidSource} />;
  }

  return <pre {...props}>{children}</pre>;
}
