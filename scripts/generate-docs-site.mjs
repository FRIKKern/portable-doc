import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultOutput = path.join(root, 'dist', 'docs-site');
const markerName = '.portable-doc-docs-site.json';
const variants = [
  ['light-en', 'Light · English'],
  ['dark-en', 'Dark · English'],
  ['light-nb-NO', 'Light · Norsk bokmål'],
  ['dark-nb-NO', 'Dark · Norsk bokmål'],
];
const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function page(title, stamp, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="portable-doc-pack-stamp" content="${stamp}"><title>${escapeHtml(title)} · PortableDoc</title>
<style>
  :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f6faf9; color: #18302a; }
  * { box-sizing: border-box; } body { margin: 0; } a { color: #08735d; } code, pre { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  header, main { width: min(1120px, calc(100% - 32px)); margin: auto; }
  header { padding: 28px 0 14px; display: flex; gap: 20px; align-items: baseline; flex-wrap: wrap; }
  header a { font-weight: 750; text-decoration: none; } nav { display: flex; gap: 14px; flex-wrap: wrap; } main { padding: 12px 0 64px; }
  h1 { font-size: clamp(2rem, 5vw, 4.5rem); line-height: .98; letter-spacing: -.05em; max-width: 850px; } h2 { margin-top: 42px; }
  .lede { max-width: 760px; font-size: 1.16rem; line-height: 1.6; } .stamp { overflow-wrap: anywhere; font-size: .86rem; color: #536b65; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
  .card { border: 1px solid #bcd0cb; border-radius: 14px; padding: 18px; background: #fff; } .card h3 { margin-top: 0; }
  .shots { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } img { width: 100%; height: auto; border-radius: 8px; border: 1px solid #d5e0dd; }
  .spec { white-space: pre-wrap; overflow-wrap: anywhere; padding: 20px; border: 1px solid #bcd0cb; border-radius: 12px; background: #fff; line-height: 1.55; }
  @media (prefers-color-scheme: dark) { :root { background: #101715; color: #e7f2ef; } a { color: #74d4bd; } .card, .spec { background: #17211f; border-color: #38534c; } .stamp { color: #a8bdb7; } img { border-color: #38534c; } }
</style>
</head>
<body>
  <header><a href="index.html">PortableDoc</a><nav><a href="spec.html">Spec</a><a href="index.html#fixtures">Golden pages</a><a href="index.html#hosts">Host gallery</a></nav></header>
  <main>${body}</main>
</body>
</html>\n`;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function rejectSymlinkPath(target) {
  const parsed = path.parse(target);
  let current = parsed.root;
  for (const part of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`refusing symlinked output path ${current}`);
  }
}

function safeOutput(output) {
  const resolved = path.resolve(output);
  if (resolved === path.parse(resolved).root || isWithin(resolved, root)) throw new Error(`refusing output that contains the repository: ${resolved}`);
  if (isWithin(root, resolved) && resolved !== defaultOutput) throw new Error(`repository output must be ${defaultOutput}`);
  rejectSymlinkPath(resolved);
  return resolved;
}

function filesIn(directory, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`refusing symlink in generated output: ${name}`);
    if (entry.isDirectory()) files.push(...filesIn(directory, name));
    else if (entry.isFile()) files.push(name.split(path.sep).join('/'));
    else throw new Error(`refusing special file in generated output: ${name}`);
  }
  return files.sort();
}

function writeMarker(directory) {
  const files = Object.fromEntries(filesIn(directory).map((file) => [file, sha256(path.join(directory, file))]));
  fs.writeFileSync(path.join(directory, markerName), `${JSON.stringify({ schema: 1, generator: 'scripts/generate-docs-site.mjs', files }, null, 2)}\n`);
}

function verifyOwnedOutput(out) {
  if (!fs.existsSync(out)) return;
  const stat = fs.lstatSync(out);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`output exists but is not a real directory: ${out}`);
  if (fs.readdirSync(out).length === 0) return;
  const markerFile = path.join(out, markerName);
  if (!fs.existsSync(markerFile) || fs.lstatSync(markerFile).isSymbolicLink()) throw new Error(`refusing nonempty output without an ownership marker: ${out}`);
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  } catch (error) {
    throw new Error(`invalid ownership marker in ${out}: ${error.message}`);
  }
  if (marker.schema !== 1 || marker.generator !== 'scripts/generate-docs-site.mjs' || !marker.files || Array.isArray(marker.files)) throw new Error(`invalid ownership marker in ${out}`);
  const actual = filesIn(out).filter((file) => file !== markerName);
  const expected = Object.keys(marker.files).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`generated output has unowned or missing files: ${out}`);
  for (const file of expected) {
    if (sha256(path.join(out, file)) !== marker.files[file]) throw new Error(`generated output was modified: ${file}`);
  }
}

function installGeneratedOutput(staging, out) {
  verifyOwnedOutput(out);
  if (!fs.existsSync(out)) {
    fs.renameSync(staging, out);
    return;
  }
  const backup = `${out}.previous-${process.pid}`;
  if (fs.existsSync(backup)) throw new Error(`refusing existing backup path ${backup}`);
  fs.renameSync(out, backup);
  try {
    fs.renameSync(staging, out);
  } catch (error) {
    fs.renameSync(backup, out);
    throw error;
  }
  fs.rmSync(backup, { recursive: true, force: true });
}

function localReferences(html) {
  const references = new Set();
  for (const pattern of [/(?:href|src)="(\/[^"]+)"/g, /url\((?:["']?)(\/[^)"']+)/g]) {
    for (const match of html.matchAll(pattern)) references.add(match[1]);
  }
  return [...references].sort();
}

export function generateDocsSite(output = defaultOutput) {
  const out = safeOutput(output);
  const stamp = sha256(path.join(root, 'goldens', 'stamp.json'));
  const source = JSON.parse(fs.readFileSync(path.join(root, 'SOURCE.json'), 'utf8'));
  const hostManifestFile = path.join(root, 'docs', 'images', 'hosts', 'manifest.json');
  const hosts = JSON.parse(fs.readFileSync(hostManifestFile, 'utf8')).hosts;
  for (const host of hosts) {
    for (const variant of ['desktop-light', 'desktop-dark']) {
      const sourceFile = path.join(root, 'docs', 'images', 'hosts', `${host.id}--${variant}.png`);
      if (!fs.existsSync(sourceFile)) throw new Error(`${host.id}: missing ${path.basename(sourceFile)}`);
    }
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(out), '.portable-doc-docs-site-'));
  fs.mkdirSync(path.join(staging, 'fixtures'));
  fs.mkdirSync(path.join(staging, 'hosts'));

  const fixtureFiles = [];
  for (const [id] of variants) {
    const sourceFile = path.join(root, 'goldens', 'pages', `${id}.html`);
    const outputFile = path.join(staging, 'fixtures', `${id}.html`);
    const html = fs.readFileSync(sourceFile, 'utf8');
    fs.copyFileSync(sourceFile, outputFile);
    fixtureFiles.push({ file: `fixtures/${id}.html`, sha256: sha256(sourceFile), unresolvedLocalReferences: localReferences(html) });
  }
  const hostCards = hosts.map((host) => {
    const shots = ['desktop-light', 'desktop-dark'].map((variant) => {
      const name = `${host.id}--${variant}.png`;
      const sourceFile = path.join(root, 'docs', 'images', 'hosts', name);
      fs.copyFileSync(sourceFile, path.join(staging, 'hosts', name));
      return `<a href="hosts/${name}"><img src="hosts/${name}" alt="${escapeHtml(host.title)} in ${variant.replace('-', ' ')}"></a>`;
    }).join('');
    return `<article class="card"><h3>${escapeHtml(host.title)}</h3><p>Manifest state: ${escapeHtml(host.state)}</p><p class="stamp"><code>${escapeHtml(host.source)}</code></p><div class="shots">${shots}</div></article>`;
  }).join('\n');
  const fixtureCards = variants.map(([id, label]) => `<article class="card"><h3>${escapeHtml(label)}</h3><p>Exact synced HTML snapshot. Barkpark-local assets are inventoried in the build manifest.</p><a href="fixtures/${id}.html" download>Download HTML snapshot</a></article>`).join('\n');
  const indexBody = `<h1>PortableDoc reference</h1><p class="lede">Browse the canonical format, exact golden HTML snapshots, and recorded synthetic host fixture captures from the existing manifest.</p><p class="stamp">Pack stamp <code>${stamp}</code><br>Synced from Barkpark <code>${escapeHtml(source.commit)}</code><br><a href="build-manifest.json">Build manifest and unresolved fixture references</a></p><h2 id="fixtures">Golden HTML snapshots</h2><section class="grid">${fixtureCards}</section><h2 id="hosts">Recorded host fixtures</h2><section class="grid">${hostCards}</section>`;
  fs.writeFileSync(path.join(staging, 'index.html'), page('Docs', stamp, indexBody));
  const spec = escapeHtml(fs.readFileSync(path.join(root, 'SPEC.md'), 'utf8'));
  fs.writeFileSync(path.join(staging, 'spec.html'), page('Specification', stamp, `<h1>PortableDoc specification</h1><p class="stamp">Pack stamp <code>${stamp}</code></p><pre class="spec">${spec}</pre>`));
  const buildManifest = {
    schema: 1,
    packStamp: stamp,
    source: { repo: source.repo, path: source.path, commit: source.commit },
    fixtures: fixtureFiles,
    hostManifest: { file: 'docs/images/hosts/manifest.json', sha256: sha256(hostManifestFile) },
    hosts: hosts.map(({ id, title, state, source: hostSource }) => ({ id, title, state, source: hostSource })),
  };
  fs.writeFileSync(path.join(staging, 'build-manifest.json'), `${JSON.stringify(buildManifest, null, 2)}\n`);
  writeMarker(staging);
  try {
    installGeneratedOutput(staging, out);
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
  console.log(`wrote ${path.relative(root, out)}: ${variants.length} golden pages, ${hosts.length} hosts, pack ${stamp.slice(0, 12)}`);
  return { out, stamp, hosts: hosts.length, fixtures: variants.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const flag = process.argv.indexOf('--out');
  if (flag !== -1 && !process.argv[flag + 1]) throw new Error('--out needs a directory');
  generateDocsSite(flag === -1 ? undefined : process.argv[flag + 1]);
}
