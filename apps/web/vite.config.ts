import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 受限环境（无子进程权限的沙箱）下 Vite 的 Windows realpath 优化会失败，
  // 设置 WR_PRESERVE_SYMLINKS=1 可跳过它；正常开发无需设置。
  resolve: {
    preserveSymlinks: process.env.WR_PRESERVE_SYMLINKS === "1",
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // 开发期同源代理：前端 5173 -> 接口 4000，避免跨域与 Cookie 问题
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
