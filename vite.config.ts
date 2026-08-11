/// <reference types="node" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base は GitHub Pages のサブパス配信を想定して環境変数で差し替える。
// 例: BASE_PATH=/denko2-companion/ npm run build
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: {
        name: '電工二種 合格伴走盤',
        short_name: '電工二種',
        description: '第二種電気工事士 2026年度下期 独学伴走ツール',
        lang: 'ja',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#0f1115',
        theme_color: '#0f1115',
        // Android のホーム画面追加は PNG のほうが確実に通る。SVG は補助として残す。
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // 学習データは IndexedDB。ここでキャッシュするのはアプリシェルだけ。
        globPatterns: ['**/*.{js,css,html,svg,json}'],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
