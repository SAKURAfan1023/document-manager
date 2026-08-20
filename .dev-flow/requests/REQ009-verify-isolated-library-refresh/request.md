# REQ009 复验已集成的资料库刷新隔离

## 目标

在外部自动提交后的新 Git 基线上，确认资料库刷新隔离实现完整且可通过项目校验。

## 范围

- 只读核对 vite.config.ts、src/App.tsx 与 tests/viteConfig.test.ts，并运行既有测试与类型检查。

## 非目标

- 不新增功能、不修改页面视觉、不修改 library 或 server。

## 验收条件

- AC-1: 当前 HEAD 包含 library Vite watch 隔离和 Reader relativePath 依赖收窄；配置测试、全量单测和类型检查通过。

## 技术方案

- 从新 HEAD 建立独立冻结基线，核对提交内容并运行 Verify Driver。

## 重要决策

- 外部流程已将实现提交，后续只做新基线复验，不制造修复提交。
