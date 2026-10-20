import type { Translation } from '../types'

export const remote: Translation['remote'] = {
  pinTitle: 'Saisissez le PIN de la console',
  pinDescription: 'Cette console PhotonBoard est protégée. Le PIN se trouve dans Réglages → Accès à distance sur la console.',
  pin: 'PIN',
  connect: 'Se connecter',
  wrongPin: 'PIN incorrect — vérifiez le PIN affiché dans les Réglages de la console.',
  unreachable: 'Impossible de joindre la console.',
  connectionLost: 'Connexion à la console perdue — reconnexion'
}
