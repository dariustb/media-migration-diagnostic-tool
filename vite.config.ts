import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    open: "/",
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
  build: {
    outDir: "app/static/dist",
    emptyOutDir: true,
  },
});
