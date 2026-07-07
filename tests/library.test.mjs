import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiHandler } from "../server/index.mjs";
import {
  createLibraryIndexState,
  resolveLibraryFile,
  scanLibrary,
  uploadLibraryFiles
} from "../server/library.mjs";

let tempRoot;
let libraryDir;
let metaPath;

async function createTestServer(handler) {
  const server = http.createServer(async (req, res) => {
    try {
      if (await handler(req, res)) {
        return;
      }
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(error instanceof Error ? error.message : "Internal error");
    }
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

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

describe("createLibraryIndexState", () => {
  it("记录变更并只清理对应扫描版本", () => {
    const state = createLibraryIndexState();

    expect(state.getStatus()).toMatchObject({ changed: false, version: 0, changedAt: null });

    const firstChange = state.markChanged();
    expect(firstChange.changed).toBe(true);
    expect(firstChange.version).toBe(1);
    expect(firstChange.changedAt).toEqual(expect.any(String));

    state.markChanged();
    state.markScanned(firstChange.version);
    expect(state.getStatus()).toMatchObject({ changed: true, version: 2 });

    state.markScanned(2);
    expect(state.getStatus()).toMatchObject({ changed: false, version: 2, changedAt: null });
  });
});

describe("uploadLibraryFiles", () => {
  it("上传到目标目录、跳过隐藏文件并避免覆盖同名文件", async () => {
    const result = await uploadLibraryFiles({
      libraryDir,
      targetPath: "S1",
      files: [
        {
          name: "s1-followup-plan.html",
          content: Buffer.from("<!doctype html><title>新版</title>")
        },
        {
          name: ".DS_Store",
          content: Buffer.from("hidden")
        }
      ]
    });

    expect(result.uploaded).toEqual([
      {
        relativePath: "S1/s1-followup-plan 2.html",
        title: "s1 followup plan 2"
      }
    ]);

    const scanned = await scanLibrary({ libraryDir, metaPath });
    expect(scanned.items.some((item) => item.relativePath.endsWith(".DS_Store"))).toBe(false);
    expect(scanned.items.some((item) => item.relativePath === "S1/s1-followup-plan 2.html")).toBe(true);
  });

  it("阻止上传目录逃出 library", async () => {
    await expect(uploadLibraryFiles({
      libraryDir,
      targetPath: "../outside",
      files: [{ name: "x.txt", content: Buffer.from("x") }]
    })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("library API", () => {
  it("读取 status 不触发扫描或创建 library 目录", async () => {
    const unscannedLibraryDir = path.join(tempRoot, "unscanned-library");
    const server = await createTestServer(createApiHandler({
      libraryDir: unscannedLibraryDir,
      metaPath
    }));

    try {
      const response = await fetch(`${server.baseUrl}/api/library/status`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ changed: false, version: 0, changedAt: null });
      await expect(fs.stat(unscannedLibraryDir)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await server.close();
    }
  });

  it("上传后 status 变更，完整索引读取后清理标记", async () => {
    const server = await createTestServer(createApiHandler({ libraryDir, metaPath }));

    try {
      const formData = new FormData();
      formData.set("targetPath", "S1");
      formData.append("files", new Blob(["hello"], { type: "text/plain" }), "api-note.txt");

      const uploadResponse = await fetch(`${server.baseUrl}/api/library/upload`, {
        method: "POST",
        body: formData
      });
      expect(uploadResponse.status).toBe(200);
      expect(await uploadResponse.json()).toMatchObject({
        uploaded: [{ relativePath: "S1/api-note.txt", title: "api note" }],
        version: 1
      });

      const dirtyStatus = await fetch(`${server.baseUrl}/api/library/status`);
      expect(await dirtyStatus.json()).toMatchObject({ changed: true, version: 1 });

      const libraryResponse = await fetch(`${server.baseUrl}/api/library`);
      const library = await libraryResponse.json();
      expect(library.items.some((item) => item.relativePath === "S1/api-note.txt")).toBe(true);

      const cleanStatus = await fetch(`${server.baseUrl}/api/library/status`);
      expect(await cleanStatus.json()).toMatchObject({ changed: false, version: 1, changedAt: null });
    } finally {
      await server.close();
    }
  });
});
