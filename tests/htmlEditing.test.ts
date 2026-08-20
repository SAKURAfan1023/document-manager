import { describe, expect, it } from "vitest";
import { createEditableHtmlDocument, stripDocumentGalleryEditingState } from "../src/App";

describe("HTML editing bridge", () => {
  it("injects the editor bridge and focuses without changing scroll position", () => {
    const document = createEditableHtmlDocument(
      "<!doctype html><html><head></head><body><main>正文</main></body></html>",
      "/files/plan.html",
      "http://localhost"
    );

    expect(document).toContain('<base data-document-gallery-editor-base href="http://localhost/files/plan.html">');
    expect(document).toContain("root.contentEditable = editing ? 'true' : 'false'");
    expect(document).toContain("root.focus({ preventScroll: true })");
    expect(document).toContain("document-gallery-html-mode");
  });

  it("removes temporary editor state before saving", () => {
    const source = '<html><body><main contenteditable="true" spellcheck="true" data-document-gallery-editing>正文</main></body></html>';

    const cleaned = stripDocumentGalleryEditingState(source);

    expect(cleaned).toBe("<html><body><main>正文</main></body></html>");
  });
});
