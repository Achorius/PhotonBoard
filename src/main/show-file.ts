import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import type { ShowFile, FixtureDefinition } from '../shared/types'
import { DEFAULT_ROOM_CONFIG } from '../shared/types'
import { BUILTIN_FIXTURES } from './fixture-library'

export class ShowFileManager {
  private userDataPath: string
  private currentFilePath: string | null = null
  private recentFiles: string[] = []
  private fixtureCache: Map<string, FixtureDefinition> = new Map()

  constructor(userDataPath: string) {
    this.userDataPath = userDataPath
    this.ensureDirectories()
    this.loadRecentFiles()
    this.loadBuiltinFixtures()
  }

  private ensureDirectories(): void {
    const dirs = [
      join(this.userDataPath, 'fixtures'),
      join(this.userDataPath, 'shows'),
      join(this.userDataPath, 'config')
    ]
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
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
      this.fixtureCache.set(fixture.id, fixture)
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

  save(show: ShowFile): { success: boolean; path?: string; error?: string } {
    if (!this.currentFilePath) {
      // Save to default location
      const showsDir = join(this.userDataPath, 'shows')
      this.currentFilePath = join(showsDir, `${show.name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.pbshow`)
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
}
