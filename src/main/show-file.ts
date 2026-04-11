import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import type { ShowFile, FixtureDefinition } from '../shared/types'
import { DEFAULT_ROOM_CONFIG } from '../shared/types'
import { BUILTIN_FIXTURES } from './fixture-library'
import { parseFixtureFile } from './fixture-parsers'

export class ShowFileManager {
  private userDataPath: string
  private documentsShowsPath: string
  private currentFilePath: string | null = null
  private recentFiles: string[] = []
  private fixtureCache: Map<string, FixtureDefinition> = new Map()

  constructor(userDataPath: string) {
    this.userDataPath = userDataPath
    this.documentsShowsPath = join(homedir(), 'Documents', 'PhotonBoard')
    this.ensureDirectories()
    this.loadRecentFiles()
    this.loadBuiltinFixtures()
  }

  private ensureDirectories(): void {
    const dirs = [
      join(this.userDataPath, 'fixtures'),
      join(this.userDataPath, 'config'),
      this.documentsShowsPath
    ]
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
  }

  getDefaultShowsDir(): string {
    return this.documentsShowsPath
  }

  /** Try to load the most recent show file at startup */
  loadLastShow(): { success: boolean; show?: ShowFile; path?: string } {
    // Try recent files first
    const recentFiles = this.getRecent()
    for (const filePath of recentFiles) {
      const result = this.load(filePath)
      if (result.success && result.show && result.show.patch && result.show.patch.length > 0) {
        console.log('[Main] Auto-loaded last show:', filePath, 'patch:', result.show.patch.length)
        return { success: true, show: result.show, path: filePath }
      }
    }

    // Fallback: scan Documents/PhotonBoard and userData/shows for any .pbshow files
    const dirs = [this.documentsShowsPath, join(this.userDataPath, 'shows')]
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      try {
        const files = readdirSync(dir).filter(f => f.endsWith('.pbshow'))
        for (const file of files) {
          const filePath = join(dir, file)
          const result = this.load(filePath)
          if (result.success && result.show && result.show.patch && result.show.patch.length > 0) {
            console.log('[Main] Auto-loaded show from scan:', filePath, 'patch:', result.show.patch.length)
            return { success: true, show: result.show, path: filePath }
          }
        }
      } catch { /* skip */ }
    }

    console.log('[Main] No existing show found to auto-load')
    return { success: false }
  }

  private loadRecentFiles(): void {
    const recentPath = join(this.userDataPath, 'config', 'recent.json')
    if (existsSync(recentPath)) {
      try {
        this.recentFiles = JSON.parse(readFileSync(recentPath, 'utf-8'))
      } catch {
        this.recentFiles = []
      }
    }
  }

  private saveRecentFiles(): void {
    const recentPath = join(this.userDataPath, 'config', 'recent.json')
    writeFileSync(recentPath, JSON.stringify(this.recentFiles.slice(0, 10)))
  }

  private addToRecent(filePath: string): void {
    this.recentFiles = [filePath, ...this.recentFiles.filter((f) => f !== filePath)].slice(0, 10)
    this.saveRecentFiles()
  }

  private loadBuiltinFixtures(): void {
    for (const fixture of BUILTIN_FIXTURES) {
      this.fixtureCache.set(fixture.id, { ...fixture, source: 'builtin' as const })
    }
  }

  private _legacyLoadBuiltinFixtures_UNUSED(): void {
    // REPLACED BY fixture-library.ts
    const generics: FixtureDefinition[] = [
      {
        id: 'generic/dimmer',
        name: 'Generic Dimmer',
        manufacturer: 'Generic',
        categories: ['Dimmer'],
        channels: {
          Intensity: {
            name: 'Intensity',
            type: 'intensity',
            defaultValue: 0,
            highlightValue: 255,
            precedence: 'HTP',
            capabilities: [{ dmxRange: [0, 255], type: 'Intensity', label: '0-100%' }]
          }
        },
        modes: [{ name: 'Default', channels: ['Intensity'], channelCount: 1 }]
      },
      {
        id: 'generic/rgb',
        name: 'Generic RGB',
        manufacturer: 'Generic',
        categories: ['Color Changer'],
        channels: {
          Red: { name: 'Red', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Red 0-100%', color: '#ff0000' }] },
          Green: { name: 'Green', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Green 0-100%', color: '#00ff00' }] },
          Blue: { name: 'Blue', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Blue 0-100%', color: '#0000ff' }] }
        },
        modes: [{ name: '3ch', channels: ['Red', 'Green', 'Blue'], channelCount: 3 }]
      },
      {
        id: 'generic/rgbw',
        name: 'Generic RGBW',
        manufacturer: 'Generic',
        categories: ['Color Changer'],
        channels: {
          Red: { name: 'Red', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Red', color: '#ff0000' }] },
          Green: { name: 'Green', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Green', color: '#00ff00' }] },
          Blue: { name: 'Blue', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Blue', color: '#0000ff' }] },
          White: { name: 'White', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'White', color: '#ffffff' }] }
        },
        modes: [{ name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 }]
      },
      {
        id: 'generic/rgbwau',
        name: 'Generic RGBWAU',
        manufacturer: 'Generic',
        categories: ['Color Changer'],
        channels: {
          Red: { name: 'Red', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Red', color: '#ff0000' }] },
          Green: { name: 'Green', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Green', color: '#00ff00' }] },
          Blue: { name: 'Blue', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Blue', color: '#0000ff' }] },
          White: { name: 'White', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'White', color: '#ffffff' }] },
          Amber: { name: 'Amber', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Amber', color: '#ffaa00' }] },
          UV: { name: 'UV', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'UV', color: '#7700ff' }] }
        },
        modes: [{ name: '6ch', channels: ['Red', 'Green', 'Blue', 'White', 'Amber', 'UV'], channelCount: 6 }]
      },
      {
        id: 'generic/moving-head-wash',
        name: 'Generic Moving Head Wash',
        manufacturer: 'Generic',
        categories: ['Moving Head'],
        channels: {
          Pan: { name: 'Pan', type: 'pan', defaultValue: 128, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'Pan', label: 'Pan 0-540°' }] },
          'Pan Fine': { name: 'Pan Fine', type: 'pan', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'PanFine', label: 'Pan Fine' }] },
          Tilt: { name: 'Tilt', type: 'tilt', defaultValue: 128, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'Tilt', label: 'Tilt 0-270°' }] },
          'Tilt Fine': { name: 'Tilt Fine', type: 'tilt', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'TiltFine', label: 'Tilt Fine' }] },
          Dimmer: { name: 'Dimmer', type: 'intensity', defaultValue: 0, highlightValue: 255, precedence: 'HTP', capabilities: [{ dmxRange: [0, 255], type: 'Intensity', label: 'Dimmer' }] },
          Red: { name: 'Red', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Red', color: '#ff0000' }] },
          Green: { name: 'Green', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Green', color: '#00ff00' }] },
          Blue: { name: 'Blue', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Blue', color: '#0000ff' }] },
          White: { name: 'White', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'White', color: '#ffffff' }] },
          Shutter: { name: 'Shutter', type: 'shutter', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 19], type: 'ShutterClose', label: 'Closed' }, { dmxRange: [20, 24], type: 'ShutterOpen', label: 'Open' }, { dmxRange: [25, 255], type: 'StrobeSpeed', label: 'Strobe slow-fast' }] },
          Speed: { name: 'Speed', type: 'speed', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'PanTiltSpeed', label: 'Pan/Tilt Speed fast-slow' }] }
        },
        modes: [
          { name: '11ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Red', 'Green', 'Blue', 'White', 'Shutter', 'Speed'], channelCount: 11 }
        ]
      }
    ]

    for (const fixture of generics) {
      this.fixtureCache.set(fixture.id, fixture)
    }
  }

  newShow(): ShowFile {
    this.currentFilePath = null
    return {
      version: '1.0.0',
      name: 'New Show',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      artnetConfig: [
        { host: '255.255.255.255', port: 6454, universe: 0, subnet: 0, net: 0 },
        { host: '255.255.255.255', port: 6454, universe: 1, subnet: 0, net: 0 },
        { host: '255.255.255.255', port: 6454, universe: 2, subnet: 0, net: 0 }
      ],
      patch: [],
      groups: [],
      presets: [],
      cuelists: [],
      chases: [],
      effects: [],
      midiMappings: [],
      stageLayout: { width: 1200, height: 600, fixtures: [] },
      roomConfig: { ...DEFAULT_ROOM_CONFIG }
    }
  }

  save(show: ShowFile): { success: boolean; path?: string; error?: string; needsSaveAs?: boolean } {
    if (!this.currentFilePath) {
      // No file path yet — tell renderer to open a Save As dialog
      return { success: false, needsSaveAs: true }
    }
    return this.saveAs(show, this.currentFilePath)
  }

  saveAs(show: ShowFile, filePath: string): { success: boolean; path?: string; error?: string } {
    try {
      show.modifiedAt = new Date().toISOString()
      writeFileSync(filePath, JSON.stringify(show, null, 2), 'utf-8')
      this.currentFilePath = filePath
      this.addToRecent(filePath)
      return { success: true, path: filePath }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }

  load(filePath: string): { success: boolean; show?: ShowFile; error?: string } {
    try {
      const data = readFileSync(filePath, 'utf-8')
      const show = JSON.parse(data) as ShowFile
      this.currentFilePath = filePath
      this.addToRecent(filePath)
      return { success: true, show }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }

  getRecent(): string[] {
    return this.recentFiles.filter((f) => existsSync(f))
  }

  scanFixtures(dir: string): FixtureDefinition[] {
    if (!existsSync(dir)) return []
    const files: FixtureDefinition[] = []
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          try {
            const raw = readFileSync(join(dir, entry.name), 'utf-8')
            const fixture = JSON.parse(raw) as FixtureDefinition
            if (fixture.name && fixture.channels) {
              this.fixtureCache.set(fixture.id, fixture)
              files.push(fixture)
            }
          } catch { /* skip invalid files */ }
        }
      }
    } catch { /* dir not readable */ }
    return files
  }

  getAllFixtures(): FixtureDefinition[] {
    return Array.from(this.fixtureCache.values())
  }

  getCurrentPath(): string | null {
    return this.currentFilePath
  }

  getFixturesDir(): string {
    return join(this.userDataPath, 'fixtures')
  }

  saveUserFixture(fixture: FixtureDefinition): { success: boolean; error?: string } {
    try {
      if (!fixture.source) fixture.source = 'user'
      fixture.lastModified = new Date().toISOString()
      const destDir = join(this.userDataPath, 'fixtures')
      const destPath = join(destDir, `${fixture.id.replace(/\//g, '_')}.json`)
      writeFileSync(destPath, JSON.stringify(fixture, null, 2), 'utf-8')
      this.fixtureCache.set(fixture.id, fixture)
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }

  deleteUserFixture(fixtureId: string): { success: boolean; error?: string } {
    try {
      const fixture = this.fixtureCache.get(fixtureId)
      if (!fixture) return { success: false, error: 'Fixture not found' }
      // Don't allow deleting built-in fixtures
      if (fixture.source === 'builtin' || !fixture.source) {
        return { success: false, error: 'Cannot delete built-in fixtures' }
      }
      const destPath = join(this.userDataPath, 'fixtures', `${fixtureId.replace(/\//g, '_')}.json`)
      if (existsSync(destPath)) {
        const { unlinkSync } = require('fs')
        unlinkSync(destPath)
      }
      this.fixtureCache.delete(fixtureId)
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }

  importFixtureFile(sourcePath: string): { success: boolean; fixture?: FixtureDefinition; error?: string } {
    try {
      // Use universal parser — supports OFL, GDTF, QLC+, Avolites, GrandMA, CSV, native JSON
      const fixture = parseFixtureFile(sourcePath)

      // Ensure source is set
      if (!fixture.source) fixture.source = 'user'

      // Save to user fixtures directory
      const destDir = this.getFixturesDir()
      const destPath = join(destDir, `${fixture.id.replace(/\//g, '_')}.json`)
      writeFileSync(destPath, JSON.stringify(fixture, null, 2), 'utf-8')

      // Add to cache
      this.fixtureCache.set(fixture.id, fixture)

      return { success: true, fixture }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }

  private convertOFLToNative(ofl: any, manufacturer: string): FixtureDefinition {
    const id = `${manufacturer.toLowerCase().replace(/\s+/g, '-')}/${(ofl.name || 'unknown').toLowerCase().replace(/\s+/g, '-')}`
    const channels: Record<string, any> = {}

    // Parse OFL availableChannels
    if (ofl.availableChannels) {
      for (const [name, chDef] of Object.entries(ofl.availableChannels) as any) {
        const type = this.inferChannelType(name, chDef)
        channels[name] = {
          name,
          type,
          defaultValue: chDef?.defaultValue ?? (type === 'pan' || type === 'tilt' ? 128 : 0),
          precedence: type === 'intensity' ? 'HTP' : 'LTP',
          capabilities: (chDef?.capabilities || []).map((cap: any) => ({
            dmxRange: cap.dmxRange || [0, 255],
            type: cap.type || 'Generic',
            label: cap.comment || cap.type || name
          }))
        }
      }
    }

    // Parse modes
    const modes = (ofl.modes || []).map((mode: any) => ({
      name: mode.name || 'Default',
      shortName: mode.shortName,
      channels: mode.channels || [],
      channelCount: (mode.channels || []).length
    }))

    if (modes.length === 0) {
      modes.push({
        name: 'Default',
        channels: Object.keys(channels),
        channelCount: Object.keys(channels).length
      })
    }

    const categories: string[] = ofl.categories || ['Other']

    return {
      id,
      name: ofl.name || 'Unknown Fixture',
      manufacturer,
      categories,
      channels,
      modes,
      physical: ofl.physical ? {
        dimensions: ofl.physical.dimensions,
        weight: ofl.physical.weight,
        power: ofl.physical.power,
        bulb: ofl.physical.bulb,
        lens: ofl.physical.lens ? {
          degreesMinMax: ofl.physical.lens.degreesMinMax
        } : undefined
      } : undefined
    }
  }

  private inferChannelType(name: string, _chDef: any): string {
    const n = name.toLowerCase()
    if (n.includes('dimmer') || n.includes('intensity') || n.includes('brightness')) return 'intensity'
    if (n.includes('red') || n.includes('green') || n.includes('blue') || n.includes('white') ||
        n.includes('amber') || n.includes('uv') || n.includes('cyan') || n.includes('magenta') ||
        n.includes('yellow') || n.includes('color')) return 'color'
    if (n === 'pan' || n.includes('pan fine')) return 'pan'
    if (n === 'tilt' || n.includes('tilt fine')) return 'tilt'
    if (n.includes('gobo')) return 'gobo'
    if (n.includes('shutter') || n.includes('strobe')) return 'shutter'
    if (n.includes('prism')) return 'prism'
    if (n.includes('speed')) return 'speed'
    if (n.includes('focus')) return 'generic'
    if (n.includes('zoom')) return 'generic'
    return 'generic'
  }
}
