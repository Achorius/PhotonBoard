/// <reference types="vite/client" />

import type { PhotonBoardAPI } from '../preload/index'

declare global {
  interface Window {
    photonboard: PhotonBoardAPI
  }
}
