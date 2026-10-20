// ============================================================
// PhotonBoard — Fake Web MIDI for tests (never imported by the app)
//
//   const access = new FakeMidiAccess()
//   const apc = access.addDevice('APC mini mk2 Control')
//   installFakeWebMidi(access)          // navigator.requestMIDIAccess
//   apc.input.emit([0x90, 56, 127])     // a pad press
//   apc.output.take()                   // LED messages sent since last take
//   access.unplug('APC mini mk2 Control')
// ============================================================

import { vi } from 'vitest'

let nextId = 1

export class FakeMidiPort {
  id = `fake-${nextId++}`
  manufacturer = 'Fake'
  state: 'connected' | 'disconnected' = 'connected'
  connection = 'open'
  constructor(public name: string, public type: 'input' | 'output') {}
}

export class FakeMidiInput extends FakeMidiPort {
  onmidimessage: ((e: { data: Uint8Array }) => void) | null = null
  constructor(name: string) { super(name, 'input') }
  emit(bytes: number[]): void {
    this.onmidimessage?.({ data: new Uint8Array(bytes) })
  }
}

export class FakeMidiOutput extends FakeMidiPort {
  sent: number[][] = []
  constructor(name: string) { super(name, 'output') }
  send(data: number[] | Uint8Array): void {
    this.sent.push(Array.from(data))
  }
  /** Messages sent since the last take() */
  take(): number[][] {
    const out = this.sent
    this.sent = []
    return out
  }
}

export class FakeMidiAccess {
  inputs = new Map<string, FakeMidiInput>()
  outputs = new Map<string, FakeMidiOutput>()
  onstatechange: ((e: { port: FakeMidiPort }) => void) | null = null
  constructor(public sysexEnabled = false) {}

  addDevice(name: string, outputName = name): { input: FakeMidiInput; output: FakeMidiOutput } {
    const input = new FakeMidiInput(name)
    const output = new FakeMidiOutput(outputName)
    this.inputs.set(input.id, input)
    this.outputs.set(output.id, output)
    return { input, output }
  }

  /** Unplug a device: ports disconnected and removed, statechange fired */
  unplug(name: string): void {
    for (const [id, p] of this.inputs) {
      if (p.name !== name) continue
      p.state = 'disconnected'
      this.inputs.delete(id)
      this.onstatechange?.({ port: p })
    }
    for (const [id, p] of this.outputs) {
      if (p.name !== name) continue
      p.state = 'disconnected'
      this.outputs.delete(id)
      this.onstatechange?.({ port: p })
    }
  }
}

/** Stub navigator.requestMIDIAccess. `sysexCalls` records each request's sysex flag. */
export function installFakeWebMidi(make: (sysex: boolean) => FakeMidiAccess): { sysexCalls: boolean[] } {
  const record = { sysexCalls: [] as boolean[] }
  vi.stubGlobal('navigator', {
    requestMIDIAccess: async (opts?: { sysex?: boolean }) => {
      record.sysexCalls.push(!!opts?.sysex)
      return make(!!opts?.sysex)
    }
  })
  return record
}
