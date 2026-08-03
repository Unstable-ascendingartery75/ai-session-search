import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 3410,
    proxy: {
      "/api": "http://localhost:3411",
    },
  },
});
