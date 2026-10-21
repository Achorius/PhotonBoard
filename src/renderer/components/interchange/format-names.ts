// Display names of interchange formats (product / standard names: not translated).
// The registered formats carry their own name; these cover formats a guide
// suggests before their module is installed.

import type { InterchangeFormatList } from '@shared/photonboard-api'

const KNOWN: Record<string, string> = {
  photonboard: 'PhotonBoard (.pbshow)',
  mvr: 'MVR',
  gdtf: 'GDTF',
  'qlcplus-workspace': 'QLC+ workspace (.qxw)',
  'qlcplus-fixture': 'QLC+ fixture (.qxf)',
  'ofl-fixture': 'Open Fixture Library',
  'ma3-xml': 'grandMA3 XML',
  'ma2-xml': 'grandMA2 XML',
  'usitt-ascii': 'USITT ASCII',
  'csv-patch': 'CSV'
}

export function formatName(id: string, formats?: InterchangeFormatList | null): string {
  const reg = formats?.importers.find((f) => f.id === id) ?? formats?.exporters.find((f) => f.id === id)
  return reg?.name ?? KNOWN[id] ?? id
}
