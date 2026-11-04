import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = JSON.parse(await readFile(new URL('./SOURCE.json', import.meta.url)))
const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url)))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

test('the extracted tokenizer trio stays byte-identical to its recorded Barkpark source', async () => {
  assert.match(source.commit, /^[a-f0-9]{40}$/)
  for (const entry of source.sources) {
    const name = entry.path.split('/').at(-1)
    assert.equal(hash(await readFile(new URL(`./src/${name}`, import.meta.url))), entry.sha256, name)
  }
})

test('the staged package pins the tokenizer versions used by the Barkpark source', () => {
  assert.equal(manifest.name, '@portable-doc/code')
  assert.equal(manifest.version, '0.1.0-alpha.1')
  assert.equal(manifest.private, true)
  assert.deepEqual(manifest.dependencies, {
    'highlight.js': '11.12.0',
    lowlight: '3.3.0',
  })
})
