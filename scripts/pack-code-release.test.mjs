import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { validatePackedManifest } from './pack-code-release.mjs'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'packages/code/package.json'), 'utf8'))
const files = [
  'LICENSE',
  'README.md',
  'RELEASING.md',
  'SOURCE.json',
  'dist/bp-paper-code.js',
  'package.json',
  'src/code-highlight.js',
  'src/reader-code.js',
  'src/reader-tabs.js',
]

test('code release pack verifier accepts the intended public alpha candidate', () => {
  assert.deepEqual(validatePackedManifest(manifest, files), [])
})

test('code release pack verifier rejects missing exports, leaked tests and unsafe metadata', () => {
  const failures = validatePackedManifest(
    {
      ...manifest,
      version: '0.0.0',
      private: true,
      publishConfig: { access: 'restricted' },
      dependencies: { lowlight: '^3.3.0', extra: '1.0.0', another: '1.0.0' },
      exports: { '.': './dist/missing.js' },
    },
    [...files, 'src/__code_highlight.test.mjs'],
  )
  assert(failures.some((failure) => failure.includes('differs from source')))
  assert(failures.some((failure) => failure.includes('must be 0.1.0-alpha.1')))
  assert(failures.some((failure) => failure.includes('must not set private')))
  assert(failures.some((failure) => failure.includes('must be public')))
  assert(failures.some((failure) => failure.includes('highlight.js must remain pinned')))
  assert(failures.some((failure) => failure.includes('lowlight must remain pinned')))
  assert(failures.some((failure) => failure.includes('exactly two runtime dependencies')))
  assert(failures.some((failure) => failure.includes('dist/missing.js')))
  assert(failures.some((failure) => failure.includes('leaks src/__code_highlight.test.mjs')))
})

test('code release workflow defaults to dry-run and protects exact manual publishing', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/portable-doc-code-release.yml'), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /permissions:\n  contents: read/)
  assert.match(workflow, /publish:[\s\S]*type: boolean[\s\S]*default: false/)
  assert.match(workflow, /if: inputs\.publish && github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /environment: portable-doc-code-release/)
  assert.match(workflow, /PORTABLE_DOC_CODE_PUBLISH_ENABLED/)
  assert.match(workflow, /approved_sha256/)
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /npm publish portable-doc-code-0\.1\.0-alpha\.1\.tgz --access public --tag alpha --dry-run/)
  assert.match(workflow, /npm publish portable-doc-code-0\.1\.0-alpha\.1\.tgz --access public --tag alpha --provenance/)
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/)
  assert.match(workflow, /1cb902e40797ebedc061cea8d4989419c32ae3b1841f31b943752858713942dc/)
  assert.match(workflow, /SHA256SUMS/)
  assert.match(workflow, /provenance\.json/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
})

test('first publish stages exact bytes only to bootstrap protected OIDC publishing', () => {
  const guide = readFileSync(resolve(root, 'packages/code/RELEASING.md'), 'utf8')
  assert.match(
    guide,
    /npm stage publish \/path\/to\/portable-doc-code-0\.1\.0-alpha\.1\.tgz --access public --tag alpha/,
  )
  assert.match(guide, /npm stage reject <stage-id>/)
  assert.match(guide, /stage list is\s+empty/)
  assert.match(guide, /package placeholder and trusted-publisher settings still\s+exist/)
  assert.match(guide, /Never approve this bootstrap entry/)
  assert.doesNotMatch(guide, /npm stage approve/)
})
