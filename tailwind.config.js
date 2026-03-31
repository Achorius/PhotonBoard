/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#0a0a0f',
          1: '#12121a',
          2: '#1a1a25',
          3: '#222230',
          4: '#2a2a3a'
        },
        accent: {
          DEFAULT: '#e85d04',
          light: '#f48c06',
          dark: '#d00000'
        },
        dmx: {
          red: '#ff3333',
          green: '#33ff33',
          blue: '#3388ff',
          amber: '#ffaa00',
          white: '#ffffff',
          cyan: '#00ffff',
          magenta: '#ff00ff',
          yellow: '#ffff00'
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace']
      }
    }
  },
  plugins: []
}
