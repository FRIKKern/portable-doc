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
  'dist/embed.cjs',
  'dist/embed.mjs',
  'dist/embed.d.cts',
  'dist/embed.d.ts',
  'dist/field-blocks.cjs',
  'dist/field-blocks.mjs',
  'dist/field-blocks.d.cts',
  'dist/field-blocks.d.ts',
  'dist/index.cjs',
  'dist/index.cjs.map',
  'dist/index.d.cts',
  'dist/index.d.ts',
  'dist/index.mjs',
  'dist/index.mjs.map',
  'dist/paper-surface.css',
  'package.json',
]

test('release pack verifier accepts the intended dependency-free public candidate', () => {
  assert.deepEqual(validatePackedManifest(manifest, files), [])
})

test('release pack verifier rejects a missing export, leaked source and unsafe release metadata', () => {
  const failures = validatePackedManifest(
    {
      ...manifest,
      version: '0.0.0',
      private: true,
      publishConfig: { access: 'restricted' },
      exports: { '.': './dist/missing.mjs' },
    },
    [...files, 'src/PortableDoc.tsx'],
  )
  assert(failures.some((failure) => failure.includes('differs from source')))
  assert(failures.some((failure) => failure.includes('must be 0.1.0-alpha.1')))
  assert(failures.some((failure) => failure.includes('must not set private')))
  assert(failures.some((failure) => failure.includes('must be public')))
  assert(failures.some((failure) => failure.includes('dist/missing.mjs')))
  assert(failures.some((failure) => failure.includes('leaks src/PortableDoc.tsx')))
})

test('release workflow defaults to dry-run and protects manual publishing', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/portable-doc-react-release.yml'), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /permissions:\n  contents: read/)
  assert.match(workflow, /publish:[\s\S]*type: boolean[\s\S]*default: false/)
  assert.match(workflow, /if: inputs\.publish && github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /environment: portable-doc-react-release/)
  assert.match(workflow, /PORTABLE_DOC_REACT_PUBLISH_ENABLED/)
  assert.match(workflow, /approved_sha256/)
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /npm publish portable-doc-react-\*\.tgz --access public --tag alpha --dry-run/)
  assert.match(workflow, /npm publish portable-doc-react-\*\.tgz --access public --tag alpha --provenance/)
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/)
  assert.match(workflow, /SHA256SUMS/)
  assert.match(workflow, /provenance\.json/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
})
