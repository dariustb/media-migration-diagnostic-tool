import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  server: {
    open: "/app/templates/",
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
  build: {
    rollupOptions: {
      input: resolve(__dirname, "app/templates/index.html"),
    },
    outDir: "app/static/dist",
    emptyOutDir: true,
  },
});
