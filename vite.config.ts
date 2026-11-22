import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// base "./" so the build works from GitHub Pages subpaths or a plain folder.
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: { globals: true },
});
