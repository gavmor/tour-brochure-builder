import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { resolve, dirname } from "node:path";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set this to your GitHub repo name, e.g. '/tour-brochure-builder/'
// Override at build time: VITE_BASE=/my-repo/ pnpm build
const REPO_NAME = "tour-brochure-builder";
const base = process.env.VITE_BASE ?? `/${REPO_NAME}/`;

// Vite plugin: copy index.html → 404.html after build for GitHub Pages SPA fallback
function spaFallback() {
  return {
    name: "spa-fallback-404",
    closeBundle() {
      const outDir = resolve(__dirname, "dist");
      copyFileSync(
        resolve(outDir, "index.html"),
        resolve(outDir, "404.html"),
      );
      console.log("  ✓ Copied index.html → 404.html (GitHub Pages SPA fallback)");
    },
  };
}

export default defineConfig({
  base,
  plugins: [preact(), spaFallback()],
});
