import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { getMermaidSource, MarkdownPre } from "../src/MermaidDiagram";

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
      { components: { pre: MarkdownPre } },
      "```mermaid\nflowchart LR\nA --> B\n```"
    );

    expect(renderToStaticMarkup(markdown)).toContain("class=\"mermaid-diagram\"");
  });

  it("keeps non-Mermaid code blocks on the default path", () => {
    const code = createElement("code", { className: "language-typescript" }, "const value = 1;\n");

    expect(getMermaidSource(code)).toBeNull();
  });
});
