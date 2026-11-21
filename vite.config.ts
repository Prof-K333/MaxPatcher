import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { build as bundleWorklet } from 'rolldown'

// Pinned to this file's folder so the server can be launched from any cwd.
const root = dirname(fileURLToPath(import.meta.url))

/** Bundle the Chimera AudioWorklet into public/, so AudioWorklet can load one file. */
function chimeraWorklet(): Plugin {
  const write = async () => {
    await bundleWorklet({
      input: resolve(root, 'src/audio/vocal/chimera/worklet/processor.ts'),
      platform: 'browser',
      output: {
        file: resolve(root, 'public/chimera-processor.js'),
        format: 'es',
        codeSplitting: false,
      },
    })
  }
  return {
    name: 'chimera-worklet',
    async buildStart() {
      await write()
    },
  }
}


export default defineConfig({
  root,
  // Pages is built with VITE_BASE=/MaxPatcher/. Local dev and the default
  // production build keep serving at `/` so port 4319 is unchanged.
  base: process.env.VITE_BASE || '/',
  plugins: [chimeraWorklet(), react(), tailwindcss()],
  assetsInclude: ['**/*.wasm'],
  server: {
    port: 4319,
    // Vite's default binds IPv6 loopback only, and a browser that resolves
    // "localhost" to 127.0.0.1 then gets connection refused. Listening on
    // every interface covers both stacks (and lets other devices on the
    // network reach it, which is how you'd open it on a phone).
    host: true,
  },
})
