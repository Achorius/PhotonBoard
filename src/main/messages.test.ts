import { afterEach, describe, expect, it } from 'vitest'
import { mt, setMainLanguage } from './messages'
import { parseShowFileContent } from './show-validation'

afterEach(() => setMainLanguage('en'))

describe('main-process messages', () => {
  it('follow the console UI language (default English)', () => {
    expect(mt('showExistsUpload', { name: 'Gala' })).toMatch(/already exists/)
    setMainLanguage('fr')
    expect(mt('showExistsUpload', { name: 'Gala' })).toBe('Un show nommé « Gala » existe déjà. Confirmez son remplacement ou renommez le fichier.')
    const bad = parseShowFileContent('')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toMatch(/vide/)
    setMainLanguage('de')
    expect(mt('emptyFile')).toMatch(/empty/)
  })

  it('leaves unknown parameters visible', () => {
    expect(mt('damagedKey')).toContain('{key}')
  })
})
