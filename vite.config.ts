import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Pinned to this file's folder so the server can be launched from any cwd.
const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  server: {
    port: 4319,
    // Vite's default binds IPv6 loopback only, and a browser that resolves
    // "localhost" to 127.0.0.1 then gets connection refused. Listening on
    // every interface covers both stacks (and lets other devices on the
    // network reach it, which is how you'd open it on a phone).
    host: true,
  },
})
