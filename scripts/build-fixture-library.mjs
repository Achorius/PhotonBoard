#!/usr/bin/env node
// ============================================================
// PhotonBoard — builds the offline fixture catalog
// (resources/fixture-library) from pinned revisions of
//   - Open Fixture Library  (MIT)        fixtures/**.json
//   - QLC+ fixture defs     (Apache-2.0) resources/fixtures/**.qxf
//
//   npm run fixtures:build    rebuild from the revisions recorded in
//                             resources/fixture-library/manifest.json
//   npm run fixtures:update   pin both sources to their latest commit,
//                             then rebuild
//
// Options:
//   --update               resolve the latest commit of each source
//   --ofl-rev <sha>        pin OFL to this commit
//   --qlc-rev <sha>        pin QLC+ to this commit
//   --src <dir>            where the sparse checkouts live
//                          (default node_modules/.cache/photonboard-fixture-sources)
//   --out <dir>            output folder (default resources/fixture-library)
//
// Needs git and network access to github.com (only this script —
// the app and packaging use the committed bundle). The conversion
// itself lives in src/main/fixture-catalog-build.ts (bundled here
// with esbuild, which ships with vite).
// ============================================================

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync, gunzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SOURCES = {
  ofl: {
    repo: 'https://github.com/OpenLightingProject/open-fixture-library.git',
    sparse: ['fixtures'],
    license: 'LICENSE',
    licenseOut: 'open-fixture-library-LICENSE.txt'
  },
  qlcplus: {
    repo: 'https://github.com/mcallegari/qlcplus.git',
    sparse: ['resources/fixtures'],
    license: 'COPYING',
    licenseOut: 'qlcplus-COPYING.txt'
  }
}

function parseArgs(argv) {
  const args = { update: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--update') args.update = true
    else if (a === '--ofl-rev') args.oflRev = argv[++i]
    else if (a === '--qlc-rev') args.qlcRev = argv[++i]
    else if (a === '--src') args.src = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '-h' || a === '--help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 26).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0) }
    else throw new Error(`Unknown argument: ${a}`)
  }
  return args
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function latestRevision(repo) {
  const out = execFileSync('git', ['ls-remote', repo, 'HEAD'], { encoding: 'utf8' }).trim()
  const sha = out.split(/\s+/)[0]
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Could not resolve HEAD of ${repo}`)
  return sha
}

/** Shallow, blob-filtered, sparse checkout of one commit (reused when already there) */
function checkout(dir, source, revision) {
  if (existsSync(join(dir, '.git'))) {
    try {
      if (git(dir, 'rev-parse', 'HEAD') === revision) return
    } catch { /* fall through and refetch */ }
  } else {
    mkdirSync(dir, { recursive: true })
    git(dir, 'init', '-q')
    git(dir, 'remote', 'add', 'origin', source.repo)
  }
  git(dir, 'sparse-checkout', 'set', ...source.sparse)
  console.log(`  fetching ${source.repo} @ ${revision.slice(0, 12)}…`)
  git(dir, 'fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', revision)
  git(dir, 'checkout', '-q', '--force', 'FETCH_HEAD')
  const head = git(dir, 'rev-parse', 'HEAD')
  if (head !== revision) throw new Error(`Checked out ${head}, expected ${revision}`)
}

function walk(dir, filter, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, filter, out)
    else if (filter(p)) out.push(p)
  }
  return out
}

function readFiles(repoDir, subdir, filter) {
  return walk(join(repoDir, subdir), filter).map((p) => ({
    path: relative(repoDir, p).split(sep).join('/'),
    content: readFileSync(p, 'utf8')
  }))
}

/** Bundle the TypeScript converter so plain node can run it */
async function loadBuilder() {
  const { build } = await import('esbuild')
  const outDir = join(ROOT, 'node_modules', '.cache', 'photonboard-fixture-build')
  mkdirSync(outDir, { recursive: true })
  const outfile = join(outDir, 'fixture-catalog-build.mjs')
  await build({
    entryPoints: [join(ROOT, 'src', 'main', 'fixture-catalog-build.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    logLevel: 'warning'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

/** gzip with a fixed header (mtime 0, OS = Unix) so output does not depend on the build machine */
function gzip(text) {
  const buf = gzipSync(Buffer.from(text, 'utf8'), { level: 9 })
  buf[9] = 3
  return buf
}

/** Write a gz file only when its decompressed content changed (stable bytes in git across zlib versions) */
function writeGz(path, text) {
  if (existsSync(path)) {
    try {
      if (gunzipSync(readFileSync(path)).toString('utf8') === text) return false
    } catch { /* rewrite */ }
  }
  writeFileSync(path, gzip(text))
  return true
}

/** Attribution + modification notice shipped with the bundle (MIT / Apache-2.0 §4) */
function notice(m, oflLicense) {
  const ofl = m.sources.find((s) => s.id === 'ofl')
  const qlc = m.sources.find((s) => s.id === 'qlcplus')
  const oflCopyright = (oflLicense.split('\n').find((l) => /^Copyright/i.test(l.trim())) ?? '').trim()
  return [
    'PhotonBoard offline fixture library',
    '===================================',
    '',
    `${m.fixtureCount} fixture definitions from ${m.manufacturerCount} manufacturers, generated by`,
    'scripts/build-fixture-library.mjs from:',
    '',
    `- ${ofl.name} (${ofl.fixtureCount} fixtures)`,
    `  ${ofl.repository} — commit ${ofl.revision} (${ofl.date})`,
    `  ${ofl.license} License, see ${ofl.licenseFile}${oflCopyright ? `\n  ${oflCopyright} and the Open Fixture Library contributors` : ''}`,
    '',
    `- ${qlc.name} (${qlc.fixtureCount} fixtures)`,
    `  ${qlc.repository} (resources/fixtures) — commit ${qlc.revision} (${qlc.date})`,
    `  Apache License 2.0, see ${qlc.licenseFile}`,
    '  Copyright the QLC+ authors and fixture definition contributors',
    '',
    'MODIFICATIONS: every definition was converted from its original format (OFL JSON,',
    'QLC+ .qxf XML) into PhotonBoard\'s fixture JSON: channel types and capabilities',
    'mapped, DMX ranges scaled to 8 bit, 16-bit channels paired, matrix channels expanded,',
    'manufacturer names unified. The original file, commit, license and authors of each',
    'definition are recorded in its "catalog" field. The originals are available at the',
    'repositories above.',
    '',
    `Duplicates: ${m.dedupePolicy}`,
    '',
    'Updating: `npm run fixtures:update` pins both sources to their latest commit and',
    'rebuilds this folder; `npm run fixtures:build` rebuilds it from the commits recorded',
    'in manifest.json (deterministic). Both need git + network; app builds do not.',
    ''
  ].join('\n')
}

function human(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = resolve(ROOT, args.out ?? 'resources/fixture-library')
  const srcDir = resolve(ROOT, args.src ?? 'node_modules/.cache/photonboard-fixture-sources')
  const manifestPath = join(outDir, 'manifest.json')
  // Pins: the output's manifest, else the committed one
  const pinPath = [manifestPath, join(ROOT, 'resources', 'fixture-library', 'manifest.json')].find((p) => existsSync(p))
  const previous = pinPath ? JSON.parse(readFileSync(pinPath, 'utf8')) : null
  const pinned = Object.fromEntries((previous?.sources ?? []).map((s) => [s.id, s.revision]))

  const revisions = {
    ofl: args.oflRev ?? (args.update ? latestRevision(SOURCES.ofl.repo) : pinned.ofl),
    qlcplus: args.qlcRev ?? (args.update ? latestRevision(SOURCES.qlcplus.repo) : pinned.qlcplus)
  }
  for (const [id, rev] of Object.entries(revisions)) {
    if (!rev) throw new Error(`No pinned revision for ${id}: run with --update (or --${id === 'ofl' ? 'ofl' : 'qlc'}-rev <sha>)`)
    if (!/^[0-9a-f]{40}$/.test(rev)) throw new Error(`Revision of ${id} must be a full commit SHA, got "${rev}"`)
  }

  console.log('Fixture sources:')
  const dirs = {}
  const dates = {}
  for (const id of Object.keys(SOURCES)) {
    dirs[id] = join(srcDir, id)
    checkout(dirs[id], SOURCES[id], revisions[id])
    dates[id] = git(dirs[id], 'log', '-1', '--format=%cI')
    console.log(`  ${id.padEnd(8)} ${revisions[id]} (${dates[id]})`)
  }

  const { buildCatalogBundle } = await loadBuilder()
  const t0 = Date.now()
  const bundle = buildCatalogBundle({
    ofl: {
      revision: revisions.ofl,
      date: dates.ofl,
      manufacturers: JSON.parse(readFileSync(join(dirs.ofl, 'fixtures', 'manufacturers.json'), 'utf8')),
      files: readFiles(dirs.ofl, 'fixtures', (p) => p.endsWith('.json') && !p.endsWith(`${sep}manufacturers.json`))
    },
    qlcplus: {
      revision: revisions.qlcplus,
      date: dates.qlcplus,
      files: readFiles(dirs.qlcplus, join('resources', 'fixtures'), (p) => p.endsWith('.qxf'))
    }
  })
  console.log(`Converted in ${((Date.now() - t0) / 1000).toFixed(1)} s`)

  // ---- write ----
  mkdirSync(join(outDir, 'fixtures'), { recursive: true })
  mkdirSync(join(outDir, 'LICENSES'), { recursive: true })
  const keep = new Set()
  let changed = 0
  for (const name of [...bundle.shards.keys()].sort()) {
    const file = `${name}.json.gz`
    keep.add(file)
    if (writeGz(join(outDir, 'fixtures', file), JSON.stringify(bundle.shards.get(name)))) changed++
  }
  for (const file of readdirSync(join(outDir, 'fixtures'))) {
    if (!keep.has(file)) { rmSync(join(outDir, 'fixtures', file)); changed++ }
  }
  if (writeGz(join(outDir, 'index.json.gz'), JSON.stringify(bundle.index))) changed++
  writeFileSync(manifestPath, `${JSON.stringify(bundle.manifest, null, 2)}\n`)
  for (const [id, s] of Object.entries(SOURCES)) copyFileSync(join(dirs[id], s.license), join(outDir, 'LICENSES', s.licenseOut))
  writeFileSync(join(outDir, 'NOTICE.txt'), notice(bundle.manifest, readFileSync(join(dirs.ofl, SOURCES.ofl.license), 'utf8')))

  // ---- report ----
  const size = walk(outDir, () => true).reduce((n, p) => n + statSync(p).size, 0)
  const m = bundle.manifest
  console.log('')
  for (const s of m.sources) {
    console.log(`${s.name}: ${s.files} files → ${s.converted} converted, ${s.fixtureCount} in catalog (${s.license}, ${s.revision.slice(0, 12)})`)
  }
  console.log(`QLC+ duplicates of OFL fixtures dropped: ${m.duplicates}`)
  const reasons = new Map()
  for (const s of m.skipped) {
    const r = s.reason.replace(/^redirect to .*/, 'redirect (alias kept)').replace(/^invalid (JSON|XML).*/, 'invalid $1')
    reasons.set(`${s.source}: ${r}`, (reasons.get(`${s.source}: ${r}`) ?? 0) + 1)
  }
  console.log(`Skipped: ${m.skipped.length}${m.skipped.length ? ` (${[...reasons.entries()].map(([r, n]) => `${n}× ${r}`).join('; ')})` : ''}`)
  console.log(`Catalog: ${m.fixtureCount} fixtures, ${m.manufacturerCount} manufacturers, ${bundle.shards.size} shards, ${human(size)} on disk (${changed} file(s) changed)`)
  console.log(`Written to ${relative(ROOT, outDir) || outDir}`)
}

main().catch((e) => {
  console.error(`build-fixture-library: ${e.stack || e.message || e}`)
  process.exit(1)
})
