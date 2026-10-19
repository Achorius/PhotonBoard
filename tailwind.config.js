/** @type {import('tailwindcss').Config} */

/** Colour backed by a `--pb-*` "R G B" variable (supports `/opacity`). */
const token = (name) => `rgb(var(--pb-${name}) / <alpha-value>)`

/** Semantic colour: solid fill, readable text on dark (`-fg`), text on the fill (`on-*`). */
const semantic = (name) => ({
  DEFAULT: token(name),
  fg: token(`${name}-fg`)
})

export default {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: token('surface-0'),
          1: token('surface-1'),
          2: token('surface-2'),
          3: token('surface-3'),
          4: token('surface-4'),
          5: token('surface-5'),
          overlay: token('overlay')
        },
        line: {
          subtle: token('line-subtle'),
          DEFAULT: token('line'),
          strong: token('line-strong')
        },
        fg: {
          DEFAULT: token('fg-primary'),
          primary: token('fg-primary'),
          secondary: token('fg-secondary'),
          tertiary: token('fg-tertiary'),
          disabled: token('fg-disabled'),
          inverse: token('fg-inverse')
        },
        accent: {
          DEFAULT: token('accent'),
          hover: token('accent-hover'),
          active: token('accent-active'),
          fg: token('accent-fg'),
          // legacy names (pre design-system views)
          light: token('accent-hover'),
          dark: token('accent-active')
        },
        go: semantic('go'),
        danger: semantic('danger'),
        warning: semantic('warning'),
        info: semantic('info'),
        midi: semantic('midi'),
        on: {
          accent: token('on-accent'),
          go: token('on-go'),
          danger: token('on-danger'),
          warning: token('on-warning'),
          info: token('on-info'),
          midi: token('on-midi')
        },
        focus: token('focus'),
        // Legacy views use Tailwind grays for text/borders: remapped onto the
        // neutral graphite ramp so they match (and keep AA contrast).
        gray: {
          50: '#f6f7f8',
          100: '#eceef1',
          200: '#dde0e4',
          300: '#c4c9d0',
          400: '#aab1ba',
          500: '#858c96',
          600: '#646b74',
          700: '#3d434a',
          800: '#2b3036',
          900: '#1a1d21',
          950: '#0d0e10'
        },
        dmx: {
          red: '#ff3b3b',
          green: '#3ddc5a',
          blue: '#3b8bff',
          amber: '#ffab1a',
          white: '#ffffff',
          cyan: '#22d3ee',
          magenta: '#e64fe6',
          yellow: '#ffe14a'
        }
      },
      borderColor: {
        DEFAULT: token('line')
      },
      fontFamily: {
        sans: ['var(--pb-font-sans)'],
        mono: ['var(--pb-font-mono)']
      },
      // Type scale: 11 / 12 / 13 (base) / 14 / 16 / 20 / 24
      fontSize: {
        '2xs': ['11px', { lineHeight: '14px' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '18px' }],
        base: ['14px', { lineHeight: '20px' }],
        lg: ['16px', { lineHeight: '22px' }],
        xl: ['20px', { lineHeight: '26px' }],
        '2xl': ['24px', { lineHeight: '30px' }]
      },
      // Density-aware sizes: h-control, min-h-row, w-control-sm…
      spacing: {
        'control-xs': 'var(--pb-control-h-xs)',
        'control-sm': 'var(--pb-control-h-sm)',
        control: 'var(--pb-control-h)',
        'control-lg': 'var(--pb-control-h-lg)',
        row: 'var(--pb-row-h)',
        topbar: 'var(--pb-topbar-h)',
        statusbar: 'var(--pb-statusbar-h)',
        fader: 'var(--pb-fader-w)'
      },
      borderRadius: {
        sm: 'var(--pb-radius-sm)',
        DEFAULT: 'var(--pb-radius)',
        md: 'var(--pb-radius)',
        lg: 'var(--pb-radius-lg)',
        xl: 'var(--pb-radius-xl)'
      },
      boxShadow: {
        raised: 'var(--pb-shadow-raised)',
        popover: 'var(--pb-shadow-popover)',
        modal: 'var(--pb-shadow-modal)'
      },
      transitionDuration: {
        fast: 'var(--pb-dur-fast)',
        DEFAULT: 'var(--pb-dur)',
        slow: 'var(--pb-dur-slow)'
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--pb-ease)'
      },
      animation: {
        blink: 'pb-blink 1s steps(1, end) infinite',
        'fade-in': 'pb-fade-in var(--pb-dur) var(--pb-ease)',
        'pop-in': 'pb-pop-in var(--pb-dur) var(--pb-ease)',
        'toast-in': 'pb-toast-in var(--pb-dur-slow) var(--pb-ease)'
      },
      zIndex: {
        popover: '60',
        modal: '70',
        toast: '80',
        tooltip: '90'
      }
    }
  },
  plugins: []
}
