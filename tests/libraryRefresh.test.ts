import { describe, expect, it } from "vitest";
import { mergeLibraryResponse } from "../src/libraryRefresh";
import type { LibraryItem, LibraryNode, LibraryResponse } from "../src/types";

function createItem(relativePath: string, mtimeMs: number): LibraryItem {
  const sourceName = relativePath.split("/").at(-1) ?? relativePath;
  return {
    id: relativePath,
    title: sourceName,
    sourceName,
    relativePath,
    url: `/files/${relativePath}`,
    extension: "md",
    kind: "markdown",
    topicPath: relativePath.split("/").slice(0, -1),
    size: 10,
    mtimeMs,
    tags: ["文档"]
  };
}

function createNode(path: string, count: number, children: LibraryNode[] = []): LibraryNode {
  const sourceName = path.split("/").at(-1) ?? "";
  return { name: sourceName || "全部主题", sourceName, path, count, children };
}

function createResponse(items: LibraryItem[], tree: LibraryNode, version: number): LibraryResponse {
  return {
    generatedAt: `2026-08-18T00:00:0${version}.000Z`,
    root: "/library",
    tree,
    items,
    version
  };
}

describe("mergeLibraryResponse", () => {
  it("reuses unchanged files and tree branches while applying changed index data", () => {
    const current = createItem("A/current.md", 100);
    const changed = createItem("A/changed.md", 100);
    const untouchedBranch = createNode("B", 1);
    const previous = createResponse(
      [current, changed],
      createNode("", 2, [createNode("A", 2), untouchedBranch]),
      1
    );
    const nextCurrent = createItem("A/current.md", 100);
    const nextChanged = createItem("A/changed.md", 200);
    const added = createItem("A/added.md", 300);
    const next = createResponse(
      [added, nextChanged, nextCurrent],
      createNode("", 3, [createNode("A", 3), createNode("B", 1)]),
      2
    );

    const merged = mergeLibraryResponse(previous, next);

    expect(merged.items[2]).toBe(current);
    expect(merged.items[1]).toBe(nextChanged);
    expect(merged.items[0]).toBe(added);
    expect(merged.tree.children[1]).toBe(untouchedBranch);
    expect(merged.tree.children[0]).toBe(next.tree.children[0]);
    expect(merged.generatedAt).toBe(next.generatedAt);
    expect(merged.version).toBe(2);
  });

  it("returns the new response unchanged when the library root changes", () => {
    const previous = createResponse([], createNode("", 0), 1);
    const next = { ...createResponse([], createNode("", 0), 2), root: "/other-library" };

    expect(mergeLibraryResponse(previous, next)).toBe(next);
  });
});
