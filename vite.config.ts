import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: { host: '127.0.0.1', port: 5186, strictPort: true, proxy: { '/api': {
    target: 'http://127.0.0.1:8175', changeOrigin: true,
    configure(proxy) { proxy.on('proxyReq', (request, incoming) => {
      if (incoming.headers.origin === 'http://127.0.0.1:5186') request.setHeader('Origin', 'http://127.0.0.1:8175');
    }); },
  } } },
  build: { outDir: 'dist' },
});
