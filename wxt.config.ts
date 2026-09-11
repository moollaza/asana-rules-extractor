import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  outDir: ".output",
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: "Asana Rules Extractor",
    description: "Read Asana automation rules out of the UI and save them as JSON for AI agents.",
    permissions: ["scripting", "activeTab", "downloads", "storage"],
    host_permissions: ["https://app.asana.com/*"],
    action: {
      default_title: "Asana Rules Extractor",
      // Chrome falls back to top-level `icons` for the toolbar button only
      // sometimes; after a reload it can show the puzzle-piece placeholder.
      default_icon: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png" },
    },
  },
});
