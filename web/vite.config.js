import { defineConfig } from "vite";
import { resolve } from "node:path";

// index.html: the main app on Supabase. live.html: the Foveated live-drawing page.
export default defineConfig({
  build: { rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html"), live: resolve(import.meta.dirname, "live.html") } } },
});
