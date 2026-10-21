// electron-vite builds main as ES modules and inserts CommonJS shims
// (__dirname, require) right after the LAST text that its regex takes for
// a static import. A string such as "…PhotonBoard can import" followed by a
// quote matches, the shims land inside a string literal and the console
// never opens its window. Guard every main-process source file.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

// Same pattern as electron-vite (src/plugins/esm.ts, findStaticImports)
const ESMStaticImportRe = /(?<=\s|^|;)import\s*([\s"']*(?<imports>[\p{L}\p{M}\w\t\n\r $*,/{}@.]+)from\s*)?["']\s*(?<specifier>(?<="\s*)[^"]*[^\s"](?=\s*")|(?<='\s*)[^']*[^\s'](?=\s*'))\s*["'][\s;]*/gmu

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) out.push(p)
  }
  return out
}

describe('main process sources vs the ESM shim plugin', () => {
  it('no text outside import statements looks like an import', () => {
    const offenders: string[] = []
    for (const file of [...sources(join(__dirname)), ...sources(join(__dirname, '../shared'))]) {
      // Drop the real import / export-from statements (they may span lines)
      const code = readFileSync(file, 'utf8')
        .replace(/^import[\s\S]*?from\s*['"][^'"]+['"]\s*$/gm, '')
        .replace(/^import\s*['"][^'"]+['"]\s*$/gm, '')
        .replace(/^export\s[^\n]*from\s*['"][^'"]+['"]\s*$/gm, '')
      for (const m of code.matchAll(ESMStaticImportRe)) offenders.push(`${file}: ${m[0].slice(0, 60)}`)
    }
    expect(offenders).toEqual([])
  })
})
