# REQ008 隔离资料库刷新与当前阅读状态

## 目标

library 文件新增或更新时只刷新目录索引，不整页重载，也不让正在阅读的其他文件跳回顶部。

## 范围

- .dev-flow/config.json、vite.config.ts、src/App.tsx 以及对应测试；保持现有服务端状态轮询机制。

## 非目标

- 不修改 library 内容、不修改 server 实现、不调整页面结构或视觉样式、不增加持久化滚动位置功能。

## 验收条件

- AC-1: library 和 library.meta.json 被排除出 Vite 文件监听；索引状态轮询继续有效；Reader pane 初始化 effect 仅随当前 relativePath 变化；测试与类型检查通过。

## 技术方案

- 在 Vite server.watch.ignored 中排除资料库路径；将 Reader pane 同步 effect 的对象依赖缩小为 relativePath；增加配置级回归测试。

## 重要决策

- 刷新隔离分为开发服务器层与 React 状态层：前者阻止 full-reload，后者避免无关索引对象更新触发 pane 同步。
