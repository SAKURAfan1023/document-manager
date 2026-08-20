# REQ011 恢复 HTML 编辑并稳定编辑保存体验

## 目标

恢复 HTML 点击编辑后的原位编辑能力，并确保进入编辑和保存后 iframe、滚动位置与页面布局不发生明显刷新跳动。

## 范围

- src/App.tsx 与对应 HTML 编辑回归测试；保留既有索引结构共享、Vite 监听隔离和手动保存接口。

## 非目标

- 不修改 server 或 library；不改变 Markdown 编辑器；不改变工具栏视觉结构；不增加自动保存。

## 验收条件

- AC-1: HTML 编辑模式切换可靠触发 iframe 桥接并以 preventScroll 聚焦；索引 mtime/size 变化不进入 HtmlRichPreview 文档输入；保存后继续复用原 iframe/srcDoc；单测和类型检查通过。

## 技术方案

- 撤回交互式 HtmlRichPreview 的通用 memo；将 item 对象入参收窄为 fileUrl/title；桥接启用编辑时调用 focus preventScroll；增加源码级回归断言。

## 重要决策

- ReaderSurface 保持 memo 以隔离非编辑预览，HtmlRichPreview 恢复普通交互组件生命周期，并通过稳定原始 props 与 useMemo 保持 iframe 文档不重建。
