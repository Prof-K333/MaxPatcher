import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { NODE_DEFS } from './nodeDefs'

it('has a createNode case for every NODE_DEFS key', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'factory.ts'), 'utf8')
  for (const type of Object.keys(NODE_DEFS)) {
    expect(src, `${type} missing from factory.ts`).toContain(`case '${type}':`)
  }
})
