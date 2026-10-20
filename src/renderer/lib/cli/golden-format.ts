// ============================================================
// PhotonBoard — Command line: compact AST text (golden tests, debugging)
//
//   "Fixture 1 Thru 4 + 7 At 0 Thru 100 Fade 2" → "sel fixture[1>4 +7] @0>100 f2"
// ============================================================

import type { CliAst, CliIdRange, CliObjectRef, CliParseResult } from './ast'

function range(r: CliIdRange): string {
  const from = r.from.text ?? String(r.from.major)
  if (r.to === undefined) return from
  if (r.to === 'end') return `${from}>end`
  return `${r.from.text === undefined ? '' : from}>${r.to.text ?? r.to.major}`
}

export function formatRef(ref: CliObjectRef): string {
  const ids = ref.ids.map((x, i) => (i === 0 && x.op === '+' ? '' : x.op) + range(x.range)).join(' ')
  const own = `${ref.kind}${ref.implicit ? '*' : ''}[${ids}]`
  return ref.parent ? `${own}<${formatRef(ref.parent)}` : own
}

export function formatAst(ast: CliAst): string {
  const parts: string[] = [ast.action ?? 'sel']
  if (ast.objects) {
    const items = ast.objects.items.map((it, i) => (i === 0 && it.op === '+' && !ast.objects!.relative ? '' : it.op) + formatRef(it.object))
    if (items.length) parts.push(items.join(' '))
    if (ast.objects.condition) parts.push(`if ${formatRef(ast.objects.condition)}`)
  }
  if (ast.target) parts.push(`=> ${formatRef(ast.target)}`)
  if (ast.value) {
    const v = ast.value.value
    let s = v.kind === 'preset' ? `@P${v.id.text ?? v.id.major}` : `@${v.from}${v.to === undefined ? '' : `>${v.to}`}`
    if (ast.value.fade !== undefined) s += ` f${ast.value.fade}`
    if (ast.value.delay !== undefined) s += ` d${ast.value.delay}`
    parts.push(s)
  }
  if (ast.amount !== undefined) parts.push(`#${ast.amount}`)
  if (ast.text !== undefined) parts.push(`"${ast.text}"`)
  for (const o of ast.options) parts.push(`/${o.name}${o.value === undefined ? '' : `=${o.value}`}`)
  return parts.join(' ')
}

/** "sel fixture[1>4] @50" or "ERR expectedNumber@9" */
export function formatParse(res: CliParseResult): string {
  if (res.error) return `ERR ${res.error.code}@${res.error.at}${res.error.token ? `:${res.error.token}` : ''}`
  return res.ast ? formatAst(res.ast) : '(empty)'
}
