# REQ004 增加 Mermaid 预览拖拽平移

## 目标

让放大后的 Mermaid 预览支持按住图形拖拽，以横向和纵向查看超出视口的内容。

## 范围

- src/MermaidDiagram.tsx、src/styles.css、tests/markdown.test.ts 与对应任务记录。

## 非目标

- 不改普通 Markdown 文档拖拽；不增加触控手势缩放；不执行浏览器前端验收。

## 验收条件

- AC-1: 主指针在预览图形区域按下并移动时，预览容器按相反方向同步横向和纵向滚动，Pointer Capture 保证移出区域后仍可继续拖动。
- AC-2: pointerup、pointercancel 或捕获丢失后结束拖动并恢复抓取光标；现有滚轮缩放和关闭行为保持不变。

## 技术方案

- 用 ref 保存拖动起点和初始滚动位置；pointermove 直接更新 dialog.scrollLeft/scrollTop，React state 仅控制抓取光标，避免逐帧重渲染。

## 重要决策

- 无
