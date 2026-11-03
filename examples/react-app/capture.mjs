import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const candidateSha256 = 'db6de8019ba132a2a6eeb8676e7ffd87ae6cb016081ed99720e12cbf13da6293'
const here = dirname(fileURLToPath(import.meta.url))
const spec = process.env.PORTABLE_DOC_REACT_SPEC || '@portable-doc/react@1.0.0'
const output = resolve(process.env.F05_OUTPUT_DIR || join(here, '../../docs/images/f05'))
const chrome = process.env.F05_CHROME || join(homedir(), '.cache/puppeteer/chrome-headless-shell/mac_arm-148.0.7778.167/chrome-headless-shell-mac-arm64/chrome-headless-shell')
const ffmpeg = process.env.F05_FFMPEG || 'ffmpeg'
const candidate = spec.endsWith('.tgz')

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' })
  if (result.status !== 0) throw new Error(`${command} failed with ${result.status}`)
  return capture ? result.stdout.trim() : ''
}

async function freePort() {
  const server = createServer()
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok))
  const { port } = server.address()
  await new Promise((ok) => server.close(ok))
  return port
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((ok) => setTimeout(ok, 100))
  }
  throw new Error(`Vite did not answer at ${url}`)
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((ok) => child.once('exit', () => ok(true))),
    new Promise((ok) => setTimeout(() => ok(false), 2000)),
  ])
  if (!exited) {
    child.kill('SIGKILL')
    await new Promise((ok) => child.once('exit', ok))
  }
}

async function captureChrome(url, profile, screenshot) {
  const browser = spawn(chrome, [
    '--headless=new',
    '--hide-scrollbars',
    '--disable-background-networking',
    '--disable-component-update',
    '--no-first-run',
    '--virtual-time-budget=3000',
    '--window-size=1000,700',
    `--user-data-dir=${profile}`,
    `--screenshot=${screenshot}`,
    url,
  ], { stdio: 'ignore' })
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      if ((await stat(screenshot)).size > 0) {
        await stop(browser)
        return
      }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 100))
  }
  await stop(browser)
  throw new Error('Chrome did not write the browser screenshot')
}

async function renderedDom(url, profile) {
  const browser = spawn(chrome, [
    '--headless=new',
    '--disable-background-networking',
    '--disable-component-update',
    '--no-first-run',
    '--virtual-time-budget=3000',
    `--user-data-dir=${profile}`,
    '--dump-dom',
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let html = ''
  let errors = ''
  browser.stdout.setEncoding('utf8')
  browser.stderr.setEncoding('utf8')
  browser.stdout.on('data', (chunk) => { html += chunk })
  browser.stderr.on('data', (chunk) => { errors += chunk })
  for (let attempt = 0; attempt < 200 && !html.includes('</html>'); attempt += 1) {
    await new Promise((ok) => setTimeout(ok, 100))
  }
  await stop(browser)
  if (!html.includes('Hello PortableDoc')) throw new Error(`browser did not render the document: ${errors.slice(-1000)}\n${html.slice(-500)}`)
}

const work = await mkdtemp(join(tmpdir(), 'portable-doc-f05-'))
const app = join(work, 'app')
const profile = join(work, 'chrome')
const inspectProfile = join(work, 'chrome-inspect')
const screenshot = join(work, 'browser.png')
const gif = join(output, 'react-one-install.gif')
let vite

try {
  await mkdir(join(app, 'src'), { recursive: true })
  await copyFile(join(here, 'index.html'), join(app, 'index.html'))
  await copyFile(join(here, 'src/main.jsx'), join(app, 'src/main.jsx'))
  const installSpec = candidate ? resolve(spec) : spec
  if (candidate) {
    const digest = createHash('sha256').update(await readFile(installSpec)).digest('hex')
    if (digest !== candidateSha256) throw new Error(`candidate digest ${digest} is not ${candidateSha256}`)
  }
  await writeFile(join(app, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`)
  run('npm', ['install', installSpec, 'react@19.2.0', 'react-dom@19.2.0', 'vite@8.3.5'], app)
  run('npm', ['exec', 'vite', 'build'], app)

  const port = await freePort()
  vite = spawn('npm', ['exec', 'vite', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: app, stdio: 'inherit' })
  const url = `http://127.0.0.1:${port}`
  await waitFor(url)
  await renderedDom(url, inspectProfile)
  await captureChrome(url, profile, screenshot)

  await mkdir(output, { recursive: true })
  run(ffmpeg, ['-y', '-loop', '1', '-framerate', '10', '-i', screenshot, '-vf', 'fps=10,scale=960:-2:flags=lanczos', '-frames:v', '20', gif], app)
  const sourceLines = (await readFile(join(here, 'src/main.jsx'), 'utf8')).trimEnd().split('\n').length
  const manifest = {
    journey: 'F05',
    status: candidate ? 'candidate-dry-run' : 'registry-install',
    package: '@portable-doc/react@1.0.0',
    package_spec: spec,
    tarball_sha256: candidate ? candidateSha256 : null,
    gif_sha256: createHash('sha256').update(await readFile(gif)).digest('hex'),
    react_source_sha: process.env.F05_REACT_SOURCE_SHA || run('git', ['rev-parse', 'HEAD'], here, true),
    source_lines: sourceLines,
    install_commands: 1,
    chrome: run(chrome, ['--version'], app, true),
    ffmpeg: run(ffmpeg, ['-version'], app, true).split('\n')[0],
  }
  if (sourceLines > 10) throw new Error(`src/main.jsx has ${sourceLines} lines, not at most 10`)
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`wrote ${output}`)
} finally {
  if (vite) await stop(vite)
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(work, { recursive: true, force: true })
      break
    } catch (error) {
      if (attempt === 9) console.warn(`could not remove ${work}: ${error.message}`)
      else await new Promise((ok) => setTimeout(ok, 250))
    }
  }
}
