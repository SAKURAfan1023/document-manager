import type { LibraryItem, LibraryNode, LibraryResponse } from "./types";

function equalStrings(first: string[] | undefined, second: string[] | undefined) {
  if (first === second) {
    return true;
  }
  if (!first || !second || first.length !== second.length) {
    return false;
  }
  return first.every((value, index) => value === second[index]);
}

function equalLibraryItems(first: LibraryItem, second: LibraryItem) {
  return first.id === second.id
    && first.title === second.title
    && first.sourceName === second.sourceName
    && first.relativePath === second.relativePath
    && first.url === second.url
    && first.extension === second.extension
    && first.kind === second.kind
    && equalStrings(first.topicPath, second.topicPath)
    && first.size === second.size
    && first.mtimeMs === second.mtimeMs
    && equalStrings(first.tags, second.tags)
    && first.order === second.order;
}

function indexNodes(node: LibraryNode, nodes: Map<string, LibraryNode>) {
  nodes.set(node.path, node);
  node.children.forEach((child) => indexNodes(child, nodes));
}

function reuseNode(next: LibraryNode, previousNodes: Map<string, LibraryNode>): LibraryNode {
  const children = next.children.map((child) => reuseNode(child, previousNodes));
  const previous = previousNodes.get(next.path);
  if (
    previous
    && previous.name === next.name
    && previous.sourceName === next.sourceName
    && previous.count === next.count
    && previous.children.length === children.length
    && children.every((child, index) => child === previous.children[index])
  ) {
    return previous;
  }
  return children.every((child, index) => child === next.children[index])
    ? next
    : { ...next, children };
}

export function mergeLibraryResponse(previous: LibraryResponse | null, next: LibraryResponse) {
  if (!previous || previous.root !== next.root) {
    return next;
  }

  const previousItems = new Map(previous.items.map((item) => [item.relativePath, item]));
  const items = next.items.map((item) => {
    const previousItem = previousItems.get(item.relativePath);
    return previousItem && equalLibraryItems(previousItem, item) ? previousItem : item;
  });

  const previousNodes = new Map<string, LibraryNode>();
  indexNodes(previous.tree, previousNodes);

  return {
    ...next,
    items,
    tree: reuseNode(next.tree, previousNodes)
  };
}
