import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('joins parts and skips falsy values', () => {
    expect(cn('a', false, null, undefined, 0, '', 'b')).toBe('a b')
    expect(cn()).toBe('')
  })

  it('lets a later class override a conflicting one', () => {
    expect(cn('h-control px-3', 'h-8')).toBe('px-3 h-8')
    expect(cn('bg-surface-3 text-fg-primary', 'bg-accent text-on-accent')).toBe('bg-accent text-on-accent')
    expect(cn('rounded', 'rounded-full')).toBe('rounded-full')
  })

  describe('custom font sizes vs custom text colours', () => {
    it('keeps a font size next to a text colour', () => {
      for (const color of ['text-fg-primary', 'text-fg-secondary', 'text-fg-tertiary', 'text-fg', 'text-accent-fg', 'text-on-accent', 'text-go-fg', 'text-on-danger', 'text-midi-fg', 'text-accent', 'text-danger']) {
        expect(cn('text-2xs', color)).toBe(`text-2xs ${color}`)
        expect(cn(color, 'text-2xs')).toBe(`${color} text-2xs`)
        expect(cn('text-sm', color)).toBe(`text-sm ${color}`)
      }
    })

    it('resolves font sizes against each other, including 2xs and arbitrary sizes', () => {
      expect(cn('text-2xs', 'text-sm')).toBe('text-sm')
      expect(cn('text-sm', 'text-2xs')).toBe('text-2xs')
      expect(cn('text-2xs', 'text-[10px]')).toBe('text-[10px]')
      expect(cn('text-base', 'text-2xl')).toBe('text-2xl')
    })

    it('resolves text colours against each other', () => {
      expect(cn('text-fg-tertiary', 'text-fg-primary')).toBe('text-fg-primary')
      expect(cn('text-fg-secondary', 'text-accent-fg')).toBe('text-accent-fg')
      expect(cn('text-on-accent', 'text-danger-fg/80')).toBe('text-danger-fg/80')
    })

    it('keeps an explicit leading next to a font size (Tailwind emits leading-* last)', () => {
      expect(cn('leading-none', 'text-2xs')).toBe('leading-none text-2xs')
      expect(cn('text-xs leading-tight')).toBe('text-xs leading-tight')
    })
  })

  it('understands density-aware sizes', () => {
    expect(cn('h-control-xs', 'h-control-sm')).toBe('h-control-sm')
    expect(cn('h-control', 'h-11')).toBe('h-11')
    expect(cn('h-control-lg', 'h-row')).toBe('h-row')
    expect(cn('min-h-row', 'min-h-0')).toBe('min-h-0')
    expect(cn('w-fader', 'w-12')).toBe('w-12')
    expect(cn('px-3', 'px-control')).toBe('px-control')
    expect(cn('h-control-sm', 'w-control-sm')).toBe('h-control-sm w-control-sm')
    expect(cn('h-topbar', 'h-statusbar')).toBe('h-statusbar')
  })

  it('understands custom colours on every property', () => {
    expect(cn('bg-surface-0', 'bg-surface-overlay')).toBe('bg-surface-overlay')
    expect(cn('border-line', 'border-line-strong')).toBe('border-line-strong')
    expect(cn('border border-line-subtle', 'border-2')).toBe('border-line-subtle border-2')
    expect(cn('ring-1 ring-line', 'ring-info/60')).toBe('ring-1 ring-info/60')
    expect(cn('bg-go', 'bg-warning/15')).toBe('bg-warning/15')
    expect(cn('outline-midi-fg', 'outline-accent')).toBe('outline-accent')
  })

  it('understands custom shadows, z-index, durations and animations', () => {
    expect(cn('shadow-raised', 'shadow-none')).toBe('shadow-none')
    expect(cn('shadow-popover', 'shadow-modal')).toBe('shadow-modal')
    expect(cn('shadow-raised', 'shadow-glow-danger')).toBe('shadow-glow-danger')
    // a shadow colour does not replace a custom shadow size
    expect(cn('shadow-raised', 'shadow-black/40')).toBe('shadow-raised shadow-black/40')
    expect(cn('z-popover', 'z-toast')).toBe('z-toast')
    expect(cn('z-10', 'z-modal')).toBe('z-modal')
    expect(cn('duration-fast', 'duration-slow')).toBe('duration-slow')
    expect(cn('duration-fast', 'duration-300')).toBe('duration-300')
    expect(cn('animate-fade-in', 'animate-none')).toBe('animate-none')
    expect(cn('tabular', 'proportional-nums')).toBe('proportional-nums')
  })

  it('keeps unrelated custom and variant classes', () => {
    expect(cn('touch-none-surface scrollbar-none', 'titlebar-drag')).toBe('touch-none-surface scrollbar-none titlebar-drag')
    expect(cn('hover:bg-surface-3', 'bg-surface-2')).toBe('hover:bg-surface-3 bg-surface-2')
    expect(cn('[[data-density=touch]_&]:w-[296px]', 'w-64')).toBe('[[data-density=touch]_&]:w-[296px] w-64')
  })
})
