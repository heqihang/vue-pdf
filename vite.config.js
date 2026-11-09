import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  base: '/vue-pdf/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  optimizeDeps: { include: ['pdfjs-dist/build/pdf.js', 'pdfjs-dist/web/pdf_viewer.js', 'pdf-lib'] },
  build: {
    target: 'es2022',
    rollupOptions: { output: { manualChunks: { vue: ['vue'], pdf: ['pdfjs-dist/build/pdf.js', 'pdfjs-dist/web/pdf_viewer.js'], 'pdf-lib': ['pdf-lib'] } } },
    outDir: 'docs',
  },
})
