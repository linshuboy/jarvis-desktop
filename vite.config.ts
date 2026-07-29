import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig(() => ({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    fs: {
      allow: [fileURLToPath(new URL('../..', import.meta.url))],
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4174,
  },
}))
