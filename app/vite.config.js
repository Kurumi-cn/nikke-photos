import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base 用相对路径：GitHub Pages 部署在任意子路径下都能直接工作
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
})