import assert from 'node:assert/strict'
import { access, cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(join(tmpdir(), 'portable-doc-react-smoke-'))
const app = join(scratch, 'app')

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

try {
  let tarball = process.argv[2] ? resolve(process.argv[2]) : null
  let packed
  if (tarball) {
    await access(tarball)
    packed = { filename: basename(tarball), size: (await stat(tarball)).size }
  } else {
    run('npm', ['run', 'build', '--workspace', '@portable-doc/react'], root)
    packed = JSON.parse(
      run(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--workspace', '@portable-doc/react', '--pack-destination', scratch],
        root,
      ),
    )[0]
    tarball = join(scratch, basename(packed.filename))
  }
  await cp(join(root, 'examples/react-app'), app, { recursive: true })
  const manifestPath = join(app, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.dependencies['@portable-doc/react'] = `file:${tarball}`
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], app)
  const installedManifest = JSON.parse(
    await readFile(join(app, 'node_modules/@portable-doc/react/package.json'), 'utf8'),
  )
  assert.equal(installedManifest.dependencies, undefined)
  const html = run('npm', ['start', '--silent'], app)
  assert.match(html, /^<div class="bp-paper-surface"><h1>Hello PortableDoc<\/h1><\/div>$/)
  await access(join(app, 'node_modules/@portable-doc/react/dist/paper-surface.css'))
  console.log(`react tarball smoke ok: ${packed.filename} (${packed.size} bytes)`)
} finally {
  await rm(scratch, { recursive: true, force: true })
}
