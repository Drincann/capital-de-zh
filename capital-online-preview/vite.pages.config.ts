import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const basePath = process.env.GITHUB_PAGES_BASE_PATH || "/capital-de-zh/";

export default defineConfig({
  base: basePath.endsWith("/") ? basePath : `${basePath}/`,
  root: path.join(appRoot, "pages"),
  publicDir: path.join(appRoot, ".pages-public"),
  plugins: [react()],
  resolve: {
    alias: {
      "@": appRoot,
    },
  },
  build: {
    emptyOutDir: true,
    outDir: path.join(appRoot, "pages-dist"),
  },
});
