import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Browsers we build for: Safari/iOS 15+ (2021) and evergreen Chromium/Firefox.
const TARGETS = ['es2020', 'safari15', 'ios15', 'chrome100', 'edge100', 'firefox100'];

export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    plugins: [react()],
    // The standalone build is a self-contained page (in-browser database), so it
    // uses relative asset URLs and a single bundle that can be inlined.
    base: standalone ? './' : '/',
    server: {
      port: 5173,
      proxy: {
        '/api': `http://localhost:${process.env.PORT ?? 3001}`,
      },
    },
    build: {
      target: TARGETS,
      cssTarget: ['safari15', 'ios15', 'chrome100', 'edge100', 'firefox100'],
      outDir: standalone ? 'dist-standalone' : 'dist',
      chunkSizeWarningLimit: standalone ? 4000 : 900,
      cssCodeSplit: !standalone,
      rollupOptions: standalone ? { output: { inlineDynamicImports: true } } : undefined,
    },
  };
});
