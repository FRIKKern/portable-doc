#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = join(root, 'packages/code')
const packageManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const source = JSON.parse(readFileSync(join(packageRoot, 'SOURCE.json'), 'utf8'))
const releaseVersion = '0.1.0-alpha.1'
const releaseFilename = `portable-doc-code-${releaseVersion}.tgz`

const requiredFiles = [
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

function exportedTargets(manifest) {
  const targets = new Set()
  const walk = (value) => {
    if (typeof value === 'string') targets.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(manifest.exports)
  return [...targets].map((target) => target.replace(/^\.\//, ''))
}

export function validatePackedManifest(manifest, files) {
  const failures = []
  const fileSet = new Set(files)
  const fail = (message) => failures.push(message)
  if (manifest.name !== '@portable-doc/code') fail(`package name is ${manifest.name}`)
  if (manifest.version !== packageManifest.version) {
    fail(`packed version ${manifest.version} differs from source ${packageManifest.version}`)
  }
  if (manifest.version !== releaseVersion) {
    fail(`release candidate version must be ${releaseVersion}, got ${manifest.version}`)
  }
  if (manifest.private != null) fail('release candidate must not set private')
  if (manifest.publishConfig?.access !== 'public') fail('release candidate publishConfig.access must be public')
  if (manifest.dependencies?.['highlight.js'] !== '11.12.0') fail('highlight.js must remain pinned to 11.12.0')
  if (manifest.dependencies?.lowlight !== '3.3.0') fail('lowlight must remain pinned to 3.3.0')
  if (Object.keys(manifest.dependencies || {}).length !== 2) fail('release candidate must have exactly two runtime dependencies')
  for (const file of requiredFiles) if (!fileSet.has(file)) fail(`tarball is missing ${file}`)
  for (const target of exportedTargets(manifest)) {
    if (!fileSet.has(target)) fail(`package.json points at ${target}, which the tarball does not hold`)
  }
  for (const file of files) {
    if (/^(tests|node_modules)\//.test(file) || /(^|\/)__.*test\.mjs$/.test(file) || file.endsWith('.tgz')) {
      fail(`tarball leaks ${file}`)
    }
  }
  return failures
}

function run(command, args, cwd = root, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', options.capture ? 'pipe' : 'inherit', 'inherit'],
  })?.trim()
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function packCodeRelease(outputArgument) {
  assert(outputArgument, 'usage: npm run code:pack -- <empty-output-directory>')
  const outputDir = resolve(outputArgument)
  assert.notEqual(outputDir, root, 'output directory must not be the repository root')
  if (existsSync(outputDir)) assert.deepEqual(readdirSync(outputDir), [], 'output directory must be empty')
  else mkdirSync(outputDir, { recursive: true })

  run('npm', ['run', 'test', '--workspace', '@portable-doc/code'])
  run('npm', ['run', 'build', '--workspace', '@portable-doc/code'])
  assert.equal(sha256(join(packageRoot, 'dist/bp-paper-code.js')), source.asset.sha256, 'built asset differs from SOURCE.json')

  const scratch = mkdtempSync(join(tmpdir(), 'portable-doc-code-pack-'))
  try {
    const packed = JSON.parse(
      run(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--workspace', '@portable-doc/code', '--pack-destination', scratch],
        root,
        { capture: true },
      ),
    )[0]
    assert.equal(packed.filename, releaseFilename, 'npm produced an unexpected tarball filename')
    const tarball = join(scratch, basename(packed.filename))
    const unpack = join(scratch, 'unpacked')
    mkdirSync(unpack)
    run('tar', ['-xzf', tarball, '-C', unpack])
    const unpackedRoot = join(unpack, 'package')
    const packedManifest = JSON.parse(readFileSync(join(unpackedRoot, 'package.json'), 'utf8'))
    const files = packed.files.map(({ path }) => path).sort()
    const failures = validatePackedManifest(packedManifest, files)
    if (sha256(join(unpackedRoot, 'dist/bp-paper-code.js')) !== source.asset.sha256) {
      failures.push('packed browser asset differs from the approved Barkpark baseline')
    }
    if (failures.length) throw new Error(failures.join('\n'))

    const commit = run('git', ['rev-parse', 'HEAD'], root, { capture: true })
    if (process.env.GITHUB_SHA) assert.equal(commit, process.env.GITHUB_SHA, 'GITHUB_SHA differs from checkout HEAD')
    const destination = join(outputDir, releaseFilename)
    copyFileSync(tarball, destination)
    const digest = sha256(destination)
    writeFileSync(join(outputDir, 'SHA256SUMS'), `${digest}  ${releaseFilename}\n`)
    const provenance = {
      schemaVersion: 1,
      source: {
        repository: 'FRIKKern/portable-doc',
        commit,
        ref: process.env.GITHUB_REF || null,
        canonicalCode: source,
      },
      package: {
        name: packedManifest.name,
        version: packedManifest.version,
        access: packedManifest.publishConfig.access,
      },
      artifact: {
        filename: releaseFilename,
        sha256: digest,
        size: statSync(destination).size,
        entryCount: packed.entryCount,
        unpackedSize: packed.unpackedSize,
        browserAssetSha256: source.asset.sha256,
      },
    }
    writeFileSync(join(outputDir, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`)
    assert.equal(sha256(destination), digest)
    console.log(`${packedManifest.name}@${packedManifest.version} ${releaseFilename}`)
    console.log(`sha256 ${digest}`)
    console.log(`browser asset sha256 ${source.asset.sha256}`)
    console.log(`files ${packed.entryCount}, packed ${packed.size} bytes, unpacked ${packed.unpackedSize} bytes`)
    return provenance
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  packCodeRelease(process.argv[2])
}
