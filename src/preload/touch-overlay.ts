// Preload of the touchscreen setup overlays (src/main/touch-overlay-page.ts):
// the page gets its view from main and reports taps / buttons. Nothing else.
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'

contextBridge.exposeInMainWorld('pbTouch', {
  send: (msg: unknown) => ipcRenderer.send(IPC.TOUCH_OVERLAY_MESSAGE, msg),
  onState: (callback: (view: unknown) => void) => {
    ipcRenderer.on(IPC.TOUCH_OVERLAY_STATE, (_event, view: unknown) => callback(view))
  }
})
