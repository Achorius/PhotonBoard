import { describe, it, expect } from 'vitest'
import { REMOTE_COMMANDS } from '../shared/remote-commands'
// @ts-expect-error — plain JS module of the separate Companion package
import { COMMANDS } from '../../companion-module-photonboard/src/commands.js'

describe('Companion module command list', () => {
  it('is an exact copy of src/shared/remote-commands.ts', () => {
    expect(COMMANDS).toEqual([...REMOTE_COMMANDS])
  })
})
