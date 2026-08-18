import { isValidElement, useEffect, useId, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type MarkdownPreProps = ComponentPropsWithoutRef<"pre"> & {
  node?: unknown;
};

let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;
let renderSequence = 0;

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
  const containerRef = useRef<HTMLDivElement>(null);
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isActive = true;
    const container = containerRef.current;
    renderSequence += 1;
    const renderId = `mermaid-${reactId}-${renderSequence}`;

    setHasError(false);
    container?.replaceChildren();

    void loadMermaid()
      .then((mermaid) => mermaid.render(renderId, source))
      .then(({ svg, bindFunctions }) => {
        if (!isActive || !containerRef.current) {
          return;
        }

        containerRef.current.innerHTML = svg;
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

  return <div ref={containerRef} className="mermaid-diagram" role="img" aria-label="Mermaid 图形" />;
}

export function MarkdownPre({ children, node: _node, ...props }: MarkdownPreProps) {
  const mermaidSource = getMermaidSource(children);

  if (mermaidSource !== null) {
    return <MermaidDiagram source={mermaidSource} />;
  }

  return <pre {...props}>{children}</pre>;
}
