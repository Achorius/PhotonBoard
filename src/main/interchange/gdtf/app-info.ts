// PhotonBoard name / version written into exported files (GDTF revisions, MVR provider)
import pkg from '../../../../package.json'

export const APP_NAME = 'PhotonBoard'
export const APP_VERSION: string = typeof pkg.version === 'string' ? pkg.version : '1'
