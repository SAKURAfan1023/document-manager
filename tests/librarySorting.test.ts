import { describe, expect, it } from "vitest";
import { compareItemsByModifiedTime, groupItemsByTopic } from "../src/librarySorting";
import type { LibraryItem } from "../src/types";

function createItem(relativePath: string, topicPath: string[], mtimeMs: number, title = relativePath): LibraryItem {
  return {
    id: relativePath,
    title,
    sourceName: relativePath.split("/").at(-1) ?? relativePath,
    relativePath,
    url: `/files/${relativePath}`,
    extension: "md",
    kind: "markdown",
    topicPath,
    size: 1,
    mtimeMs
  };
}

describe("compareItemsByModifiedTime", () => {
  it("sorts newer files first and uses title for equal timestamps", () => {
    const items = [
      createItem("旧.md", [], 100),
      createItem("乙.md", [], 200, "B"),
      createItem("甲.md", [], 200, "A")
    ];

    expect(items.sort(compareItemsByModifiedTime).map((item) => item.relativePath)).toEqual([
      "甲.md",
      "乙.md",
      "旧.md"
    ]);
  });
});

describe("groupItemsByTopic", () => {
  it("sorts files independently in the root and every nested folder", () => {
    const groups = groupItemsByTopic([
      createItem("根目录旧.md", [], 100),
      createItem("S1/子目录/旧.md", ["S1", "子目录"], 100),
      createItem("根目录新.md", [], 300),
      createItem("S1/子目录/新.md", ["S1", "子目录"], 300)
    ]);

    expect(groups.get("")?.map((item) => item.relativePath)).toEqual(["根目录新.md", "根目录旧.md"]);
    expect(groups.get("S1/子目录")?.map((item) => item.relativePath)).toEqual([
      "S1/子目录/新.md",
      "S1/子目录/旧.md"
    ]);
  });
});
