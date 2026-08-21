import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve('electron/main.ts'),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('electron/preload.ts'),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve('.'),
    build: {
      rollupOptions: {
        input: resolve('index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve('src'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
})
