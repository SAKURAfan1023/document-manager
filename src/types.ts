export type LibraryKind = "html" | "pdf" | "image" | "markdown" | "text" | "other";

export type LibraryItem = {
  id: string;
  title: string;
  relativePath: string;
  url: string;
  extension: string;
  kind: LibraryKind;
  topicPath: string[];
  size: number;
  mtimeMs: number;
  tags?: string[];
  order?: number;
};

export type LibraryNode = {
  name: string;
  path: string;
  count: number;
  children: LibraryNode[];
};

export type LibraryResponse = {
  generatedAt: string;
  root: string;
  tree: LibraryNode;
  items: LibraryItem[];
};

export type SortMode = "library" | "recent" | "title" | "type";
