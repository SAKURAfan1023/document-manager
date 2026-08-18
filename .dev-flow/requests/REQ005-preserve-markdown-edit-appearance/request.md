# REQ005 保持 Markdown 编辑结构与视觉一致

## 目标

Markdown 进入所见即所得编辑态后继续保持阅读态的内容结构和排版视觉，并能安全修改包含围栏代码的文档。

## 范围

- src/MarkdownRichEditor.tsx、src/styles.css 及必要的代码级检查。

## 非目标

- 不改为源码编辑器；不修改保存接口和手动保存策略；不重做阅读器布局；不执行浏览器前端验收。

## 验收条件

- AC-1: Markdown 编辑正文复用阅读态的标题、段落、列表、引用、代码、表格和图片排版规则，切换编辑态时不再改变主体内容宽度和层级视觉。
- AC-2: 编辑器注册 fenced code block 支持，包含 mermaid 等语言标记的围栏代码能够进入编辑态并在保存时保留代码块结构。
- AC-3: 现有撤销重做、富文本工具栏、手动保存和预览切换行为保持不变。

## 技术方案

- 让 MDXEditor 的 contentEditable 同时使用 markdown-preview 样式类，并统一编辑外层与阅读态的留白；注册 codeBlockPlugin 与 CodeMirror 描述器保留 fenced code block。

## 重要决策

- 无
