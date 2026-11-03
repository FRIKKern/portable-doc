import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { validatePackedManifest } from './pack-react-release.mjs'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'packages/react/package.json'), 'utf8'))
const files = [
  'LICENSE',
  'README.md',
  'SOURCE.json',
  'dist/index.cjs',
  'dist/index.cjs.map',
  'dist/index.d.cts',
  'dist/index.d.ts',
  'dist/index.mjs',
  'dist/index.mjs.map',
  'dist/paper-surface.css',
  'package.json',
]

test('release pack verifier accepts the intended dependency-free private package', () => {
  assert.deepEqual(validatePackedManifest(manifest, files), [])
})

test('release pack verifier rejects a missing export, leaked source and a publishable manifest', () => {
  const failures = validatePackedManifest(
    { ...manifest, private: false, exports: { '.': './dist/missing.mjs' } },
    [...files, 'src/PortableDoc.tsx'],
  )
  assert(failures.some((failure) => failure.includes('must remain private')))
  assert(failures.some((failure) => failure.includes('dist/missing.mjs')))
  assert(failures.some((failure) => failure.includes('leaks src/PortableDoc.tsx')))
})

test('release workflow is dispatch-only and carries no publish authority', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/portable-doc-react-release.yml'), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /permissions:\n  contents: read/)
  assert.doesNotMatch(workflow, /npm publish|id-token|environment:|registry-url|NODE_AUTH_TOKEN|NPM_TOKEN/)
  assert.match(workflow, /SHA256SUMS/)
  assert.match(workflow, /provenance\.json/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
})
