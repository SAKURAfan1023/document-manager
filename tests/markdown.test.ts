import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { markdownHighlightOptions, rehypeHighlight } from "../src/markdownHighlighting";
import {
  getMermaidPreviewScrollPosition,
  getMermaidSource,
  getNextMermaidPreviewZoom,
  MarkdownPre
} from "../src/MermaidDiagram";

describe("getMermaidPreviewScrollPosition", () => {
  it("moves the scroll position in the opposite direction of the pointer", () => {
    expect(getMermaidPreviewScrollPosition(300, 200, 40, -30)).toEqual({
      scrollLeft: 260,
      scrollTop: 230
    });
  });
});

describe("getNextMermaidPreviewZoom", () => {
  it("zooms in and out by one step from the latest value", () => {
    expect(getNextMermaidPreviewZoom(1, -1)).toBe(1.1);
    expect(getNextMermaidPreviewZoom(1.1, 1)).toBe(1);
  });

  it("clamps zoom between 50% and 300%", () => {
    expect(getNextMermaidPreviewZoom(3, -1)).toBe(3);
    expect(getNextMermaidPreviewZoom(0.5, 1)).toBe(0.5);
  });
});

describe("getMermaidSource", () => {
  it("extracts source from a Mermaid fenced code block", () => {
    const code = createElement(
      "code",
      { className: "language-mermaid" },
      "flowchart LR\nA --> B\n"
    );

    expect(getMermaidSource(code)).toBe("flowchart LR\nA --> B");
  });

  it("routes a Mermaid fence through the diagram component", () => {
    const markdown = createElement(
      ReactMarkdown,
      {
        components: { pre: MarkdownPre },
        rehypePlugins: [[rehypeHighlight, markdownHighlightOptions]]
      },
      "```mermaid\nflowchart LR\nA --> B\n```"
    );

    const markup = renderToStaticMarkup(markdown);

    expect(markup).toContain("class=\"mermaid-diagram\"");
    expect(markup).toContain("aria-haspopup=\"dialog\"");
  });

  it("keeps non-Mermaid code blocks on the default path", () => {
    const code = createElement("code", { className: "language-typescript" }, "const value = 1;\n");

    expect(getMermaidSource(code)).toBeNull();
  });
});

describe("Markdown code highlighting", () => {
  it("marks diff additions and deletions with semantic highlight classes", () => {
    const markdown = createElement(
      ReactMarkdown,
      { rehypePlugins: [[rehypeHighlight, markdownHighlightOptions]] },
      '```diff\n+  "available": true\n-  "available": false\n```'
    );

    const markup = renderToStaticMarkup(markdown);

    expect(markup).toContain('class="hljs language-diff"');
    expect(markup).toContain('class="hljs-addition"');
    expect(markup).toContain('class="hljs-deletion"');
  });

  it("adds syntax token classes to JSON code blocks", () => {
    const markdown = createElement(
      ReactMarkdown,
      { rehypePlugins: [[rehypeHighlight, markdownHighlightOptions]] },
      '```json\n{"available": true, "remaining_pages": 120}\n```'
    );

    const markup = renderToStaticMarkup(markdown);

    expect(markup).toContain('class="hljs language-json"');
    expect(markup).toContain('class="hljs-attr"');
    expect(markup).toContain('class="hljs-literal"');
    expect(markup).toContain('class="hljs-number"');
  });
});
