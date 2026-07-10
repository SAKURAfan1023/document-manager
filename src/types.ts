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
  version?: number;
};

export type LibraryStatusResponse = {
  changed: boolean;
  version: number;
  changedAt: string | null;
};

export type LibraryContentResponse = {
  content: {
    relativePath: string;
    mtimeMs: number;
  };
  version: number;
};

export type LibraryUploadResponse = {
  uploaded: Array<{
    relativePath: string;
    title: string;
  }>;
  version: number;
};

export type LibraryMoveResponse = {
  moved: {
    relativePath: string;
    title: string;
    kind: "file" | "folder";
  };
  changed: boolean;
  version: number;
};

export type LibraryCreateFolderResponse = {
  folder: {
    relativePath: string;
    name: string;
  };
  version: number;
};

export type LibraryDeleteEntryResponse = {
  deleted: {
    relativePath: string;
    title: string;
    kind: "file" | "folder";
  };
  version: number;
};

export type LibraryRenameEntryResponse = {
  renamed: {
    previousRelativePath: string;
    relativePath: string;
    title: string;
    kind: "file" | "folder";
  };
  changed: boolean;
  version: number;
};

export type LibraryNativeOpenMode = "system" | "wps";

export type LibraryOpenResponse = {
  opened: {
    relativePath: string;
    mode: LibraryNativeOpenMode;
  };
};

export type LibraryRevealResponse = {
  revealed: {
    relativePath: string;
    kind: "file" | "folder";
  };
};

export type SortMode = "library" | "recent" | "title" | "type";
