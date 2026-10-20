import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import App from './App'
import './styles/globals.css'
import { installRemoteAPI } from './lib/remote-api'
import { useUiStore } from './stores/ui-store'

// If running in a browser (no Electron preload), install WebSocket bridge
installRemoteAPI()

// Density before the first paint (no compact → touch jump on the Pi)
document.documentElement.dataset.density = useUiStore.getState().density

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
