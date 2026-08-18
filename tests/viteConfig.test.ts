import { describe, expect, it } from "vitest";
import config, { libraryWatchIgnores } from "../vite.config";

describe("Vite library watch isolation", () => {
  it("keeps library content out of full-page reload monitoring", () => {
    expect(libraryWatchIgnores).toEqual(["**/library/**", "**/library.meta.json"]);
    expect(config.server?.watch?.ignored).toBe(libraryWatchIgnores);
  });
});
