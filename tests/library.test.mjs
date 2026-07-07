import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveLibraryFile, scanLibrary } from "../server/library.mjs";

let tempRoot;
let libraryDir;
let metaPath;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "document-gallery-"));
  libraryDir = path.join(tempRoot, "library");
  metaPath = path.join(tempRoot, "library.meta.json");
  await fs.mkdir(path.join(libraryDir, "S1", "子主题"), { recursive: true });
  await fs.writeFile(
    path.join(libraryDir, "S1", "s1-followup-plan.html"),
    "<!doctype html><title>S1 文档智能解析横评补充计划</title><h1>样例</h1>"
  );
  await fs.writeFile(path.join(libraryDir, "S1", "子主题", "说明.md"), "# Markdown 标题\n\n正文");
  await fs.writeFile(path.join(libraryDir, "S1", ".hidden.txt"), "hidden");
  await fs.writeFile(path.join(libraryDir, "misc.bin"), "raw");
  await fs.writeFile(metaPath, JSON.stringify({
    items: {
      "S1/子主题/说明.md": {
        title: "覆盖标题",
        tags: ["重点"],
        order: 1
      },
      "misc.bin": {
        hidden: true
      }
    }
  }));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("scanLibrary", () => {
  it("扫描目录、识别类型并应用 metadata", async () => {
    const result = await scanLibrary({ libraryDir, metaPath });

    expect(result.items).toHaveLength(2);
    expect(result.tree.count).toBe(2);
    expect(result.tree.children[0].name).toBe("S1");

    const html = result.items.find((item) => item.kind === "html");
    expect(html?.title).toBe("S1 文档智能解析横评补充计划");
    expect(html?.url).toBe("/files/S1/s1-followup-plan.html");

    const markdown = result.items.find((item) => item.kind === "markdown");
    expect(markdown?.title).toBe("覆盖标题");
    expect(markdown?.tags).toEqual(["重点"]);
    expect(markdown?.topicPath).toEqual(["S1", "子主题"]);
  });

  it("阻止 library 目录之外的路径访问", () => {
    expect(resolveLibraryFile("../DESIGN.md", libraryDir)).toBeNull();
    expect(resolveLibraryFile("S1/s1-followup-plan.html", libraryDir)).toBe(
      path.join(libraryDir, "S1", "s1-followup-plan.html")
    );
  });
});
