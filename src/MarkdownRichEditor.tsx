import "@mdxeditor/editor/style.css";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  headingsPlugin,
  imagePlugin,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  StrikeThroughSupSubToggles,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo
} from "@mdxeditor/editor";
import { useMemo } from "react";

export default function MarkdownRichEditor({
  fileUrl,
  markdown,
  onChange
}: {
  fileUrl: string;
  markdown: string;
  onChange: (markdown: string) => void;
}) {
  const plugins = useMemo(() => [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    imagePlugin({
      imagePreviewHandler: async (source) => new URL(source, new URL(fileUrl, window.location.origin)).href
    }),
    tablePlugin(),
    markdownShortcutPlugin(),
    toolbarPlugin({
      toolbarContents: () => (
        <>
          <UndoRedo />
          <BlockTypeSelect />
          <BoldItalicUnderlineToggles />
          <StrikeThroughSupSubToggles />
          <CodeToggle />
          <ListsToggle />
          <CreateLink />
          <InsertImage />
          <InsertTable />
          <InsertThematicBreak />
        </>
      )
    })
  ], [fileUrl]);

  return (
    <MDXEditor
      autoFocus
      className="markdown-rich-editor"
      contentEditableClassName="markdown-rich-editor-content"
      markdown={markdown}
      plugins={plugins}
      onChange={(nextMarkdown, initialized) => {
        if (!initialized) {
          onChange(nextMarkdown);
        }
      }}
    />
  );
}
