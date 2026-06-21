import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy API + SSE to the Express server during dev.
      "/api": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
});
