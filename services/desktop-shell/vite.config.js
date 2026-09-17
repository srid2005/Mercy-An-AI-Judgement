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
        manualChunks: () => "vendor",
      },
    },
  },
}));
