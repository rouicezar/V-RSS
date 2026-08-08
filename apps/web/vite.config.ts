import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const projectRootDir = resolve(__dirname);

const isProd = process.env.NODE_ENV === 'production';

console.log('process.env.NODE_ENV: ', process.env.NODE_ENV);

// https://vitejs.dev/config/
export default defineConfig({
  base: '/dash',
  plugins: [
    react(),
    !isProd
      ? null
      : {
          name: 'renameIndex',
          enforce: 'post',
          generateBundle(options, bundle) {
            const indexHtml = bundle['index.html'];
            indexHtml.fileName = 'index.hbs';
          },
        },
  ],
  resolve: {
    alias: [
      {
        find: '@server',
        replacement: resolve(projectRootDir, '../apps/server/src'),
      },
      {
        find: '@web',
        replacement: resolve(projectRootDir, './src'),
      },
    ],
  },
  build: {
    emptyOutDir: true,
    outDir: resolve(projectRootDir, '..', 'server', 'client'),
    rollupOptions: {
      output: {
        // 代码分割：按依赖域分包，避免单一巨型 bundle
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // React 生态
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|react-router-config|@remix-run|history|scheduler|@types\/react)[\\/]/.test(
              id,
            )
          ) {
            return 'react-vendor';
          }
          // 数据链路（tRPC + React Query）
          if (
            /[\\/]node_modules[\\/](@trpc|@tanstack|superjson|zod)[\\/]/.test(
              id,
            )
          ) {
            return 'data-vendor';
          }
          // UI 组件库（NextUI + React Aria + framer-motion）
          if (
            /[\\/]node_modules[\\/](@nextui-org|@react-aria|@react-stately|@react-types|framer-motion|@internationalized|tailwind-variants|clsx)[\\/]/.test(
              id,
            )
          ) {
            return 'ui-vendor';
          }
          // 图标
          if (/[\\/]node_modules[\\/](lucide-react|@iconify)[\\/]/.test(id)) {
            return 'icons';
          }
          return 'misc-vendor';
        },
      },
    },
  },
});
