/// <reference types="vitest/config" />
import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [preact()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    // Keeps the map views from calling the public routing endpoints when a
    // test merely renders them — see the file for why.
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
