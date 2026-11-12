import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
const appVersion = pkg.version ? (pkg.version.startsWith('v') ? pkg.version : `v${pkg.version}`) : 'v1.0.0'
const githubRepo = {
  owner: pkg.build?.publish?.owner || 'ttienzy',
  repo: pkg.build?.publish?.repo || 'ytb_v1-source',
}

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve('electron/main.ts'),
      },
    },
    plugins: [externalizeDepsPlugin()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __GITHUB_REPO__: JSON.stringify(githubRepo),
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('electron/preload.ts'),
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          inlineDynamicImports: true,
        },
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
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __GITHUB_REPO__: JSON.stringify(githubRepo),
    },
    plugins: [react(), tailwindcss()],
  },
})
