import type { LibraryItem } from "./types";

export function compareItemsByModifiedTime(first: LibraryItem, second: LibraryItem) {
  const modifiedCompare = second.mtimeMs - first.mtimeMs;
  if (modifiedCompare !== 0) {
    return modifiedCompare;
  }

  const titleCompare = first.title.localeCompare(second.title, "zh-CN");
  return titleCompare || first.relativePath.localeCompare(second.relativePath, "zh-CN");
}

export function groupItemsByTopic(items: LibraryItem[]) {
  const groups = new Map<string, LibraryItem[]>();

  for (const item of items) {
    const topicPath = item.topicPath.join("/");
    const group = groups.get(topicPath);
    if (group) {
      group.push(item);
    } else {
      groups.set(topicPath, [item]);
    }
  }

  for (const group of groups.values()) {
    group.sort(compareItemsByModifiedTime);
  }

  return groups;
}
