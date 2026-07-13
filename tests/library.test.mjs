import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiHandler } from "../server/index.mjs";
import {
  createLibraryFolder,
  createLibraryIndexState,
  deleteLibraryEntry,
  moveLibraryEntry,
  openLibraryFile,
  renameLibraryEntry,
  revealLibraryPath,
  resolveLibraryFile,
  scanLibrary,
  updateLibraryDisplayName,
  uploadLibraryFiles,
  writeLibraryContent
} from "../server/library.mjs";

const PNG_SAMPLE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l5F0TAAAAABJRU5ErkJggg==",
  "base64"
);

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
      "S1/子主题": {
        title: "覆盖目录"
      },
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
    expect(html?.sourceName).toBe("s1-followup-plan.html");
    expect(html?.url).toBe("/files/S1/s1-followup-plan.html");

    const markdown = result.items.find((item) => item.kind === "markdown");
    expect(markdown?.title).toBe("覆盖标题");
    expect(markdown?.sourceName).toBe("说明.md");
    expect(markdown?.tags).toEqual(["重点"]);
    expect(markdown?.topicPath).toEqual(["S1", "子主题"]);

    expect(result.tree.children[0].children[0]).toMatchObject({
      name: "覆盖目录",
      sourceName: "子主题"
    });
  });

  it("保留空文件夹在目录树中", async () => {
    await fs.mkdir(path.join(libraryDir, "空目录"));

    const result = await scanLibrary({ libraryDir, metaPath });
    const emptyFolder = result.tree.children.find((node) => node.name === "空目录");

    expect(emptyFolder).toMatchObject({
      name: "空目录",
      path: "空目录",
      count: 0,
      children: []
    });
  });

  it("识别 PNG 图片并生成预览文件路径", async () => {
    await fs.writeFile(path.join(libraryDir, "S1", "reference.png"), PNG_SAMPLE);

    const result = await scanLibrary({ libraryDir, metaPath });
    const image = result.items.find((item) => item.relativePath === "S1/reference.png");

    expect(image).toMatchObject({
      extension: "png",
      kind: "image",
      title: "reference",
      url: "/files/S1/reference.png"
    });
  });

  it("阻止 library 目录之外的路径访问", () => {
    expect(resolveLibraryFile("../DESIGN.md", libraryDir)).toBeNull();
    expect(resolveLibraryFile("S1/s1-followup-plan.html", libraryDir)).toBe(
      path.join(libraryDir, "S1", "s1-followup-plan.html")
    );
  });
});

describe("writeLibraryContent", () => {
  it("仅写回 library 内的 HTML 与 Markdown 文件", async () => {
    const result = await writeLibraryContent({
      libraryDir,
      relativePath: "S1/子主题/说明.md",
      content: "# 已更新\n\n新正文"
    });

    expect(result.content.relativePath).toBe("S1/子主题/说明.md");
    expect(result.content.mtimeMs).toBeTypeOf("number");
    expect(await fs.readFile(path.join(libraryDir, "S1", "子主题", "说明.md"), "utf8")).toBe("# 已更新\n\n新正文");
  });

  it("拒绝 library 外路径、非编辑类型与目录", async () => {
    await expect(writeLibraryContent({
      libraryDir,
      relativePath: "../DESIGN.md",
      content: "nope"
    })).rejects.toMatchObject({ statusCode: 403 });

    await expect(writeLibraryContent({
      libraryDir,
      relativePath: "misc.bin",
      content: "nope"
    })).rejects.toMatchObject({ statusCode: 400 });

    await expect(writeLibraryContent({
      libraryDir,
      relativePath: "S1",
      content: "nope"
    })).rejects.toMatchObject({ statusCode: 400 });
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

describe("createLibraryFolder", () => {
  it("在目标目录创建文件夹并避免覆盖同名目录", async () => {
    const result = await createLibraryFolder({
      libraryDir,
      parentPath: "S1",
      name: "子主题"
    });

    expect(result).toEqual({
      folder: {
        relativePath: "S1/子主题 2",
        name: "子主题 2"
      }
    });
    await expect(fs.stat(path.join(libraryDir, "S1", "子主题 2"))).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
  });

  it("拒绝非法名称和 library 外路径", async () => {
    await expect(createLibraryFolder({
      libraryDir,
      parentPath: "../outside",
      name: "新目录"
    })).rejects.toMatchObject({ statusCode: 403 });

    await expect(createLibraryFolder({
      libraryDir,
      parentPath: "S1",
      name: ".hidden"
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("moveLibraryEntry", () => {
  it("移动文件并迁移 metadata", async () => {
    const result = await moveLibraryEntry({
      libraryDir,
      metaPath,
      sourcePath: "S1/子主题/说明.md",
      targetPath: ""
    });

    expect(result).toEqual({
      moved: {
        relativePath: "说明.md",
        title: "说明",
        kind: "file"
      },
      changed: true
    });

    await expect(fs.stat(path.join(libraryDir, "S1", "子主题", "说明.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(libraryDir, "说明.md"))).resolves.toMatchObject({ isFile: expect.any(Function) });

    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    expect(meta.items["说明.md"]).toMatchObject({
      title: "覆盖标题",
      tags: ["重点"],
      order: 1
    });
    expect(meta.items["S1/子主题/说明.md"]).toBeUndefined();

    const scanned = await scanLibrary({ libraryDir, metaPath });
    const moved = scanned.items.find((item) => item.relativePath === "说明.md");
    expect(moved?.title).toBe("覆盖标题");
  });

  it("移动到已有同名文件的目录时自动改名", async () => {
    await fs.writeFile(path.join(libraryDir, "S1", "说明.md"), "# 已存在");

    const result = await moveLibraryEntry({
      libraryDir,
      metaPath,
      sourcePath: "S1/子主题/说明.md",
      targetPath: "S1"
    });

    expect(result).toEqual({
      moved: {
        relativePath: "S1/说明 2.md",
        title: "说明 2",
        kind: "file"
      },
      changed: true
    });

    await expect(fs.stat(path.join(libraryDir, "S1", "说明.md"))).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expect(fs.stat(path.join(libraryDir, "S1", "说明 2.md"))).resolves.toMatchObject({ isFile: expect.any(Function) });

    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    expect(meta.items["S1/说明 2.md"]).toMatchObject({ title: "覆盖标题" });
    expect(meta.items["S1/子主题/说明.md"]).toBeUndefined();
  });

  it("同目录移动视为无操作", async () => {
    const result = await moveLibraryEntry({
      libraryDir,
      metaPath,
      sourcePath: "S1/子主题/说明.md",
      targetPath: "S1/子主题"
    });

    expect(result).toEqual({
      moved: {
        relativePath: "S1/子主题/说明.md",
        title: "说明",
        kind: "file"
      },
      changed: false
    });
    await expect(fs.stat(path.join(libraryDir, "S1", "子主题", "说明.md"))).resolves.toMatchObject({
      isFile: expect.any(Function)
    });
  });

  it("阻止移动路径逃出 library", async () => {
    await expect(moveLibraryEntry({
      libraryDir,
      metaPath,
      sourcePath: "../DESIGN.md",
      targetPath: "S1"
    })).rejects.toMatchObject({ statusCode: 403 });

    await expect(moveLibraryEntry({
      libraryDir,
      metaPath,
      sourcePath: "S1/子主题/说明.md",
      targetPath: "../outside"
    })).rejects.toMatchObject({ statusCode: 403 });
  });

  it("移动文件夹并迁移其中 metadata", async () => {
    const result = await moveLibraryEntry({
      libraryDir,
      metaPath,
      sourcePath: "S1/子主题",
      targetPath: ""
    });

    expect(result).toEqual({
      moved: {
        relativePath: "子主题",
        title: "子主题",
        kind: "folder"
      },
      changed: true
    });
    await expect(fs.stat(path.join(libraryDir, "子主题", "说明.md"))).resolves.toMatchObject({
      isFile: expect.any(Function)
    });
    await expect(fs.stat(path.join(libraryDir, "S1", "子主题"))).rejects.toMatchObject({ code: "ENOENT" });

    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    expect(meta.items["子主题/说明.md"]).toMatchObject({ title: "覆盖标题" });
    expect(meta.items["S1/子主题/说明.md"]).toBeUndefined();
  });

  it("拒绝缺失源文件、根目录和移动到自身子目录", async () => {
    await expect(moveLibraryEntry({
      libraryDir,
      metaPath,
      sourcePath: "S1/missing.md",
      targetPath: ""
    })).rejects.toMatchObject({ statusCode: 404 });

    await expect(moveLibraryEntry({
      libraryDir,
      metaPath,
      sourcePath: "",
      targetPath: ""
    })).rejects.toMatchObject({ statusCode: 400 });

    await expect(moveLibraryEntry({
      libraryDir,
      metaPath,
      sourcePath: "S1",
      targetPath: "S1/子主题"
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("renameLibraryEntry", () => {
  it("重命名文件并迁移 metadata", async () => {
    const result = await renameLibraryEntry({
      libraryDir,
      metaPath,
      relativePath: "S1/子主题/说明.md",
      name: "更新说明.md"
    });

    expect(result).toEqual({
      renamed: {
        previousRelativePath: "S1/子主题/说明.md",
        relativePath: "S1/子主题/更新说明.md",
        title: "更新说明",
        kind: "file"
      },
      changed: true
    });
    await expect(fs.stat(path.join(libraryDir, "S1", "子主题", "更新说明.md"))).resolves.toMatchObject({
      isFile: expect.any(Function)
    });

    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    expect(meta.items["S1/子主题/更新说明.md"]).toMatchObject({ title: "覆盖标题" });
    expect(meta.items["S1/子主题/说明.md"]).toBeUndefined();
  });

  it("重命名文件夹并迁移其中 metadata", async () => {
    const result = await renameLibraryEntry({
      libraryDir,
      metaPath,
      relativePath: "S1/子主题",
      name: "已整理"
    });

    expect(result).toEqual({
      renamed: {
        previousRelativePath: "S1/子主题",
        relativePath: "S1/已整理",
        title: "已整理",
        kind: "folder"
      },
      changed: true
    });
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    expect(meta.items["S1/已整理/说明.md"]).toMatchObject({ title: "覆盖标题" });
    expect(meta.items["S1/子主题/说明.md"]).toBeUndefined();
  });

  it("拒绝非法名称与同级重名", async () => {
    await fs.writeFile(path.join(libraryDir, "S1", "子主题", "同名.md"), "已存在");

    await expect(renameLibraryEntry({
      libraryDir,
      metaPath,
      relativePath: "S1/子主题/说明.md",
      name: "同名.md"
    })).rejects.toMatchObject({ statusCode: 409 });
    await expect(renameLibraryEntry({
      libraryDir,
      metaPath,
      relativePath: "S1/子主题/说明.md",
      name: "..."
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("updateLibraryDisplayName", () => {
  it("只更新 JSON 展示名，不改变本地文件名", async () => {
    const result = await updateLibraryDisplayName({
      libraryDir,
      metaPath,
      relativePath: "S1/子主题/说明.md",
      title: "人工标注说明"
    });

    expect(result).toEqual({
      displayName: {
        relativePath: "S1/子主题/说明.md",
        title: "人工标注说明",
        kind: "file"
      },
      changed: true
    });
    await expect(fs.stat(path.join(libraryDir, "S1", "子主题", "说明.md"))).resolves.toMatchObject({
      isFile: expect.any(Function)
    });

    const scanned = await scanLibrary({ libraryDir, metaPath });
    expect(scanned.items.find((item) => item.relativePath === "S1/子主题/说明.md")).toMatchObject({
      title: "人工标注说明",
      sourceName: "说明.md"
    });
  });

  it("支持为文件夹设置展示名", async () => {
    const result = await updateLibraryDisplayName({
      libraryDir,
      metaPath,
      relativePath: "S1/子主题",
      title: "待评估材料"
    });

    expect(result.displayName).toEqual({
      relativePath: "S1/子主题",
      title: "待评估材料",
      kind: "folder"
    });

    const scanned = await scanLibrary({ libraryDir, metaPath });
    expect(scanned.tree.children[0].children[0]).toMatchObject({
      name: "待评估材料",
      sourceName: "子主题"
    });
  });
});

describe("deleteLibraryEntry", () => {
  it("删除文件并清理 metadata", async () => {
    const result = await deleteLibraryEntry({
      libraryDir,
      metaPath,
      relativePath: "S1/子主题/说明.md"
    });

    expect(result).toEqual({
      deleted: {
        relativePath: "S1/子主题/说明.md",
        title: "说明",
        kind: "file"
      }
    });
    await expect(fs.stat(path.join(libraryDir, "S1", "子主题", "说明.md"))).rejects.toMatchObject({ code: "ENOENT" });

    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    expect(meta.items["S1/子主题/说明.md"]).toBeUndefined();
  });

  it("删除文件夹并清理其中 metadata", async () => {
    const result = await deleteLibraryEntry({
      libraryDir,
      metaPath,
      relativePath: "S1/子主题"
    });

    expect(result).toEqual({
      deleted: {
        relativePath: "S1/子主题",
        title: "子主题",
        kind: "folder"
      }
    });
    await expect(fs.stat(path.join(libraryDir, "S1", "子主题"))).rejects.toMatchObject({ code: "ENOENT" });

    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    expect(meta.items["S1/子主题/说明.md"]).toBeUndefined();
  });

  it("拒绝 library 外路径和根目录目标", async () => {
    await expect(deleteLibraryEntry({
      libraryDir,
      metaPath,
      relativePath: "../DESIGN.md"
    })).rejects.toMatchObject({ statusCode: 403 });

    await expect(deleteLibraryEntry({
      libraryDir,
      metaPath,
      relativePath: ""
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("revealLibraryPath", () => {
  it("解析文件和文件夹并调用资源管理器打开动作", async () => {
    const calls = [];
    const reveal = (absolutePath, kind) => calls.push({ absolutePath, kind });

    await expect(revealLibraryPath({
      libraryDir,
      relativePath: "S1/子主题/说明.md",
      kind: "file",
      reveal
    })).resolves.toEqual({
      revealed: {
        relativePath: "S1/子主题/说明.md",
        kind: "file"
      }
    });

    await expect(revealLibraryPath({
      libraryDir,
      relativePath: "S1/子主题",
      kind: "folder",
      reveal
    })).resolves.toEqual({
      revealed: {
        relativePath: "S1/子主题",
        kind: "folder"
      }
    });

    expect(calls).toEqual([
      {
        absolutePath: path.join(libraryDir, "S1", "子主题", "说明.md"),
        kind: "file"
      },
      {
        absolutePath: path.join(libraryDir, "S1", "子主题"),
        kind: "folder"
      }
    ]);
  });

  it("阻止打开 library 外路径并校验目标类型", async () => {
    const reveal = () => {
      throw new Error("不应调用资源管理器");
    };

    await expect(revealLibraryPath({
      libraryDir,
      relativePath: "../DESIGN.md",
      kind: "file",
      reveal
    })).rejects.toMatchObject({ statusCode: 403 });

    await expect(revealLibraryPath({
      libraryDir,
      relativePath: "S1/missing.md",
      kind: "file",
      reveal
    })).rejects.toMatchObject({ statusCode: 404 });

    await expect(revealLibraryPath({
      libraryDir,
      relativePath: "S1/子主题",
      kind: "file",
      reveal
    })).rejects.toMatchObject({ statusCode: 400 });

    await expect(revealLibraryPath({
      libraryDir,
      relativePath: "S1/子主题/说明.md",
      kind: "folder",
      reveal
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("openLibraryFile", () => {
  it("使用系统默认应用或 WPS 打开 library 内文件", async () => {
    await fs.writeFile(path.join(libraryDir, "S1", "demo.docx"), "docx");
    const calls = [];
    const open = (absolutePath, mode) => calls.push({ absolutePath, mode });

    await expect(openLibraryFile({
      libraryDir,
      relativePath: "S1/demo.docx",
      mode: "system",
      open
    })).resolves.toEqual({
      opened: {
        relativePath: "S1/demo.docx",
        mode: "system"
      }
    });

    await expect(openLibraryFile({
      libraryDir,
      relativePath: "S1/demo.docx",
      mode: "wps",
      open
    })).resolves.toEqual({
      opened: {
        relativePath: "S1/demo.docx",
        mode: "wps"
      }
    });

    expect(calls).toEqual([
      {
        absolutePath: path.join(libraryDir, "S1", "demo.docx"),
        mode: "system"
      },
      {
        absolutePath: path.join(libraryDir, "S1", "demo.docx"),
        mode: "wps"
      }
    ]);
  });

  it("拒绝 library 外路径、目录目标、非法方式和非 Office WPS 打开", async () => {
    const open = () => {
      throw new Error("不应调用打开动作");
    };

    await expect(openLibraryFile({
      libraryDir,
      relativePath: "../DESIGN.md",
      mode: "system",
      open
    })).rejects.toMatchObject({ statusCode: 403 });

    await expect(openLibraryFile({
      libraryDir,
      relativePath: "S1/子主题",
      mode: "system",
      open
    })).rejects.toMatchObject({ statusCode: 400 });

    await expect(openLibraryFile({
      libraryDir,
      relativePath: "S1/s1-followup-plan.html",
      mode: "bad",
      open
    })).rejects.toMatchObject({ statusCode: 400 });

    await expect(openLibraryFile({
      libraryDir,
      relativePath: "S1/s1-followup-plan.html",
      mode: "wps",
      open
    })).rejects.toMatchObject({ statusCode: 400 });
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

  it("返回 PNG 文件时使用 image/png 内容类型", async () => {
    await fs.writeFile(path.join(libraryDir, "S1", "reference.png"), PNG_SAMPLE);
    const server = await createTestServer(createApiHandler({ libraryDir, metaPath }));

    try {
      const response = await fetch(`${server.baseUrl}/files/S1/reference.png`);
      const body = Buffer.from(await response.arrayBuffer());

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(body).toEqual(PNG_SAMPLE);
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

  it("写回 HTML 内容后 status 变更并返回新的修改时间", async () => {
    const server = await createTestServer(createApiHandler({ libraryDir, metaPath }));

    try {
      const response = await fetch(`${server.baseUrl}/api/library/content`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relativePath: "S1/s1-followup-plan.html",
          content: "<!doctype html><title>已更新</title><h1>新内容</h1>"
        })
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        content: {
          relativePath: "S1/s1-followup-plan.html",
          mtimeMs: expect.any(Number)
        },
        version: 1
      });
      expect(await fs.readFile(path.join(libraryDir, "S1", "s1-followup-plan.html"), "utf8")).toContain("新内容");

      const dirtyStatus = await fetch(`${server.baseUrl}/api/library/status`);
      expect(await dirtyStatus.json()).toMatchObject({ changed: true, version: 1 });
    } finally {
      await server.close();
    }
  });

  it("移动后 status 变更，完整索引读取后清理标记", async () => {
    const server = await createTestServer(createApiHandler({ libraryDir, metaPath }));

    try {
      const moveResponse = await fetch(`${server.baseUrl}/api/library/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourcePath: "S1/子主题/说明.md",
          targetPath: ""
        })
      });

      expect(moveResponse.status).toBe(200);
      expect(await moveResponse.json()).toMatchObject({
        moved: { relativePath: "说明.md", title: "说明", kind: "file" },
        changed: true,
        version: 1
      });

      const dirtyStatus = await fetch(`${server.baseUrl}/api/library/status`);
      expect(await dirtyStatus.json()).toMatchObject({ changed: true, version: 1 });

      const libraryResponse = await fetch(`${server.baseUrl}/api/library`);
      const library = await libraryResponse.json();
      expect(library.items.some((item) => item.relativePath === "说明.md")).toBe(true);
      expect(library.items.some((item) => item.relativePath === "S1/子主题/说明.md")).toBe(false);

      const cleanStatus = await fetch(`${server.baseUrl}/api/library/status`);
      expect(await cleanStatus.json()).toMatchObject({ changed: false, version: 1, changedAt: null });
    } finally {
      await server.close();
    }
  });

  it("重命名后 status 变更并返回新路径", async () => {
    const server = await createTestServer(createApiHandler({ libraryDir, metaPath }));

    try {
      const response = await fetch(`${server.baseUrl}/api/library/rename`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relativePath: "S1/子主题/说明.md",
          name: "更新说明.md"
        })
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        renamed: {
          previousRelativePath: "S1/子主题/说明.md",
          relativePath: "S1/子主题/更新说明.md",
          title: "更新说明",
          kind: "file"
        },
        changed: true,
        version: 1
      });

      const status = await fetch(`${server.baseUrl}/api/library/status`);
      expect(await status.json()).toMatchObject({ changed: true, version: 1 });
    } finally {
      await server.close();
    }
  });

  it("修改展示名后 status 变更，本地文件名保持不变", async () => {
    const server = await createTestServer(createApiHandler({ libraryDir, metaPath }));

    try {
      const response = await fetch(`${server.baseUrl}/api/library/display-name`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relativePath: "S1/子主题/说明.md",
          title: "人工标注说明"
        })
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        displayName: {
          relativePath: "S1/子主题/说明.md",
          title: "人工标注说明",
          kind: "file"
        },
        changed: true,
        version: 1
      });

      await expect(fs.stat(path.join(libraryDir, "S1", "子主题", "说明.md"))).resolves.toMatchObject({
        isFile: expect.any(Function)
      });

      const status = await fetch(`${server.baseUrl}/api/library/status`);
      expect(await status.json()).toMatchObject({ changed: true, version: 1 });
    } finally {
      await server.close();
    }
  });

  it("新建文件夹和删除文件后 status 变更", async () => {
    const server = await createTestServer(createApiHandler({ libraryDir, metaPath }));

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/library/folder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parentPath: "S1",
          name: "新文件夹"
        })
      });

      expect(createResponse.status).toBe(200);
      expect(await createResponse.json()).toMatchObject({
        folder: { relativePath: "S1/新文件夹", name: "新文件夹" },
        version: 1
      });

      const deleteResponse = await fetch(`${server.baseUrl}/api/library/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relativePath: "S1/子主题/说明.md"
        })
      });

      expect(deleteResponse.status).toBe(200);
      expect(await deleteResponse.json()).toMatchObject({
        deleted: { relativePath: "S1/子主题/说明.md", title: "说明" },
        version: 2
      });

      const dirtyStatus = await fetch(`${server.baseUrl}/api/library/status`);
      expect(await dirtyStatus.json()).toMatchObject({ changed: true, version: 2 });

      const libraryResponse = await fetch(`${server.baseUrl}/api/library`);
      const library = await libraryResponse.json();
      const s1Node = library.tree.children.find((node) => node.path === "S1");
      expect(s1Node?.children.some((node) => node.path === "S1/新文件夹")).toBe(true);
      expect(library.items.some((item) => item.relativePath === "S1/子主题/说明.md")).toBe(false);

      const cleanStatus = await fetch(`${server.baseUrl}/api/library/status`);
      expect(await cleanStatus.json()).toMatchObject({ changed: false, version: 2, changedAt: null });
    } finally {
      await server.close();
    }
  });

  it("打开资源管理器接口转发相对路径和类型", async () => {
    const calls = [];
    const server = await createTestServer(createApiHandler({
      libraryDir,
      metaPath,
      revealLibraryPath: async (payload) => {
        calls.push(payload);
        return {
          revealed: {
            relativePath: payload.relativePath,
            kind: payload.kind
          }
        };
      }
    }));

    try {
      const response = await fetch(`${server.baseUrl}/api/library/reveal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relativePath: "S1/子主题",
          kind: "folder"
        })
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        revealed: {
          relativePath: "S1/子主题",
          kind: "folder"
        }
      });
      expect(calls).toEqual([
        {
          relativePath: "S1/子主题",
          kind: "folder",
          libraryDir
        }
      ]);
    } finally {
      await server.close();
    }
  });

  it("外部打开接口转发相对路径和打开方式", async () => {
    const calls = [];
    const server = await createTestServer(createApiHandler({
      libraryDir,
      metaPath,
      openLibraryFile: async (payload) => {
        calls.push(payload);
        return {
          opened: {
            relativePath: payload.relativePath,
            mode: payload.mode
          }
        };
      }
    }));

    try {
      const response = await fetch(`${server.baseUrl}/api/library/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relativePath: "S1/s1-followup-plan.html",
          mode: "system"
        })
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        opened: {
          relativePath: "S1/s1-followup-plan.html",
          mode: "system"
        }
      });
      expect(calls).toEqual([
        {
          relativePath: "S1/s1-followup-plan.html",
          mode: "system",
          libraryDir
        }
      ]);
    } finally {
      await server.close();
    }
  });
});
