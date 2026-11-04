import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'portable-doc-code-smoke-'))
const app = join(scratch, 'app')
const approvedAssetSha256 = '1cb902e40797ebedc061cea8d4989419c32ae3b1841f31b943752858713942dc'

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

try {
  const tarball = process.argv[2] ? resolve(process.argv[2]) : null
  assert(tarball, 'usage: npm run code:smoke -- <portable-doc-code-0.1.0-alpha.1.tgz>')
  await access(tarball)
  assert.equal(basename(tarball), 'portable-doc-code-0.1.0-alpha.1.tgz')
  await mkdir(app)
  await writeFile(join(app, 'package.json'), `${JSON.stringify({
    private: true,
    type: 'module',
    dependencies: { '@portable-doc/code': `file:${tarball}` },
  }, null, 2)}\n`)
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], app)

  const installedRoot = join(app, 'node_modules/@portable-doc/code')
  const manifest = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@portable-doc/code')
  assert.equal(manifest.version, '0.1.0-alpha.1')
  assert.equal(manifest.exports['./highlight'], './src/code-highlight.js')
  assert.equal(manifest.exports['./tabs'], './src/reader-tabs.js')
  assert.equal(manifest.exports['./bp-paper-code.js'], './dist/bp-paper-code.js')
  const asset = await readFile(join(installedRoot, 'dist/bp-paper-code.js'))
  assert.equal(sha256(asset), approvedAssetSha256)

  const output = run('node', ['--input-type=module', '-e', `
    import root from '@portable-doc/code'
    import { highlightHtml, resolveLang } from '@portable-doc/code/highlight'
    import { TAB_KINDS, wireAllTabs } from '@portable-doc/code/tabs'
    if (resolveLang('js') !== 'javascript') throw new Error('JavaScript alias changed')
    if (!highlightHtml('const answer = 42', 'js').includes('hljs-keyword')) throw new Error('highlight export failed')
    if (typeof root.highlightHtml !== 'function') throw new Error('root export failed')
    if (TAB_KINDS.length !== 2 || typeof wireAllTabs !== 'function') throw new Error('tabs export failed')
    console.log('package exports ok')
  `], app)
  assert.equal(output, 'package exports ok')
  console.log(`code tarball smoke ok: ${basename(tarball)} (${(await stat(tarball)).size} bytes)`)
  console.log(`browser asset sha256 ${approvedAssetSha256}`)
} finally {
  await rm(scratch, { recursive: true, force: true })
}
