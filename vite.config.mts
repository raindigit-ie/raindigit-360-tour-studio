import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  build: {
    emptyOutDir: false,
    minify: true,
    sourcemap: false,
    lib: {
      entry: "src/editor/walking-list/index.ts",
      name: "RainDigitWalkingButtonList",
      formats: ["iife"],
      fileName: () => "editor-walking-button-list.js"
    },
    outDir: "web-tour/js/generated"
  }
});
