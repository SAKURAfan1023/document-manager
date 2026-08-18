/// <reference types="vitest" />

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export const libraryWatchIgnores = ["**/library/**", "**/library.meta.json"];

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    watch: {
      ignored: libraryWatchIgnores
    }
  },
  preview: {
    host: "127.0.0.1"
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,mjs}"]
  }
});
