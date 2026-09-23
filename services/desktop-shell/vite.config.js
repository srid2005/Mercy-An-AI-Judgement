import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: "",
  define: {
    "process.env.NODE_ENV": `"${mode}"`,
  },
  server: {
    port: 3000,
    host: true,
  },
  build: {
    outDir: "build",
    rollupOptions: {
      output: {
        // node_modules in their own chunk: a rebuild that only touches the
        // shell leaves the vendor hash alone, so a returning browser keeps
        // it cached. Vite adds the modulepreload link for it.
        manualChunks: (id) => (id.includes("node_modules") ? "vendor" : undefined),
      },
    },
  },
}));
