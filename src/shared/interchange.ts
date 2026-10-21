// ============================================================
// PhotonBoard — Show / fixture interchange contracts
// Importers turn a foreign file (MVR, GDTF, QLC+ workspace,
// grandMA2/3 XML exports, USITT ASCII, CSV…) into a fragment of a
// PhotonBoard show; exporters write a show out to an open format.
// Importers and exporters run in the main process (file access,
// zip, XML) and are registered in src/main/interchange/registry.ts.
// The renderer previews the fragment and merges it into the current
// show, or opens it as a new show.
// ============================================================

import type {
  Chase,
  Cuelist,
  Effect,
  FixtureDefinition,
  Group,
  MidiMapping,
  PatchEntry,
  Preset,
  RoomConfig,
  ShowExecutorLayout,
  ShowFile,
  ShowTimeline,
  Macro
} from './types'

/** Stable importer / exporter ids */
export type InterchangeFormatId =
  | 'photonboard'
  | 'mvr'
  | 'gdtf'
  | 'qlcplus-workspace'
  | 'qlcplus-fixture'
  | 'ofl-fixture'
  | 'ma3-xml'
  | 'ma2-xml'
  | 'usitt-ascii'
  | 'csv-patch'
  | (string & {})

/** What a format can carry, for the UI ("Patch, positions, groups…") */
export type InterchangeContent =
  | 'fixtures'
  | 'patch'
  | 'positions'
  | 'groups'
  | 'presets'
  | 'cues'
  | 'chases'
  | 'effects'
  | 'timeline'
  | 'executors'
  | 'midi'
  | 'macros'

export interface InterchangeFormatInfo {
  id: InterchangeFormatId
  /** Human name, not translated ("MVR (My Virtual Rig)", "QLC+ workspace") */
  name: string
  /** Lower-case extensions without dot, e.g. ['mvr'] */
  extensions: string[]
  /** What import / export carries for this format */
  imports: InterchangeContent[]
  exports: InterchangeContent[]
  /** Applications that produce / read it (shown as hints) */
  apps: string[]
}

export type ImportWarningLevel = 'info' | 'warning' | 'error'

export interface ImportWarning {
  level: ImportWarningLevel
  /** i18n key under `interchange.warnings.*` when possible; otherwise plain English */
  code: string
  /** Interpolation params for the i18n key / free text */
  params?: Record<string, string | number>
  /** Free text fallback (English) */
  message?: string
}

/**
 * A partial show produced by an importer. Ids are importer-local and
 * unique within the fragment; the merge step remaps them. Fixture types
 * used by `patch` are either in `fixtures` (embedded definitions, e.g.
 * from GDTF/QXF inside the file) or resolved by id against the library
 * and offline catalog (`patch[i].fixtureDefId`).
 */
export interface ImportedShowFragment {
  format: InterchangeFormatId
  /** Name of the source show / file */
  name: string
  /** Producing application and version when known ("grandMA3 2.1", "QLC+ 4.13.1") */
  sourceApp?: string
  fixtures: FixtureDefinition[]
  patch: PatchEntry[]
  groups: Group[]
  presets: Preset[]
  cuelists: Cuelist[]
  chases: Chase[]
  effects: Effect[]
  macros: Macro[]
  midiMappings: MidiMapping[]
  timeline?: ShowTimeline
  executor?: ShowExecutorLayout
  roomConfig?: RoomConfig
  warnings: ImportWarning[]
}

export interface ImportRequest {
  /** Absolute path chosen by the user (main process reads it) */
  path: string
  /** Force a format instead of auto-detection */
  format?: InterchangeFormatId
}

export type ImportResult =
  | { success: true; fragment: ImportedShowFragment }
  | { success: false; canceled?: boolean; error?: string; errorCode?: string; detectedFormat?: string; guidance?: UnsupportedFormatGuidance }

/**
 * A recognised but closed / binary format (grandMA3 .show, MagicQ .shw,
 * Avolites .d4, Eos .esf…): explain how to get the data out of the
 * original console into an open format PhotonBoard reads.
 */
export interface UnsupportedFormatGuidance {
  /** i18n key under `interchange.guidance.*` */
  key: string
  /** Application name ("grandMA3") */
  app: string
  /** Formats to export from that console, in order of usefulness */
  suggestedFormats: InterchangeFormatId[]
}

export interface ExportRequest {
  format: InterchangeFormatId
  show: ShowFile
  /** Definitions of every fixture type used by the show */
  fixtures: FixtureDefinition[]
  /** Destination path; when omitted the main process asks with a save dialog */
  path?: string
}

export type ExportResult =
  | { success: true; path: string; warnings: ImportWarning[] }
  | { success: false; canceled?: boolean; error?: string }

/** Options of the merge step in the renderer */
export interface MergeOptions {
  /** 'new' = replace the current show; 'merge' = add into it */
  mode: 'new' | 'merge'
  /** Which parts of the fragment to bring in */
  include: Partial<Record<InterchangeContent, boolean>>
  /** Address conflicts: shift imported fixtures to free addresses, keep as-is (overlap), or skip them */
  addressConflicts: 'shift' | 'keep' | 'skip'
  /** Universe offset added to imported universes (0-based) */
  universeOffset: number
}

// ---- Main-process plug-in contracts (implemented in src/main/interchange) ----

/** Lookup helpers the importers get from the host */
export interface ImportContext {
  /** Resolve a fixture type by manufacturer + model (+ optional mode channel count) in the library/catalog */
  findFixture(manufacturer: string, model: string, channelCount?: number): Promise<FixtureDefinition | null>
  /** Parse an embedded GDTF archive (bytes) into a definition */
  parseGdtf(bytes: Uint8Array, fileName: string): Promise<FixtureDefinition | null>
  /** Parse an embedded QLC+ fixture definition (XML text) */
  parseQxf(xml: string, fileName: string): Promise<FixtureDefinition | null>
}

export interface Importer {
  info: InterchangeFormatInfo
  /** 0 = not this format, 1 = certain. `head` = first 64 KiB of the file */
  detect(fileName: string, head: Uint8Array): number
  parse(bytes: Uint8Array, fileName: string, ctx: ImportContext): Promise<ImportedShowFragment>
}

export interface Exporter {
  info: InterchangeFormatInfo
  /** Returns the file bytes and any warnings (e.g. "effects are not representable in USITT ASCII") */
  write(show: ShowFile, fixtures: FixtureDefinition[]): Promise<{ bytes: Uint8Array; warnings: ImportWarning[] }>
  /**
   * Optional (additive): export ONE fixture type, for formats that describe a
   * fixture (GDTF, QLC+ .qxf, OFL…). The fixture wizard / library offers
   * "Export fixture as …" for every exporter that implements it.
   * `fileName` is the recommended file name (e.g. GDTF's
   * "Manufacturer@Model@Comment.gdtf"); the host may use it as the default
   * name of the save dialog.
   */
  writeFixture?(def: FixtureDefinition): Promise<{ bytes: Uint8Array; warnings: ImportWarning[]; fileName?: string }>
}

/** An empty fragment, convenient for importers */
export function emptyFragment(format: InterchangeFormatId, name: string): ImportedShowFragment {
  return {
    format, name, fixtures: [], patch: [], groups: [], presets: [], cuelists: [], chases: [],
    effects: [], macros: [], midiMappings: [], warnings: []
  }
}
