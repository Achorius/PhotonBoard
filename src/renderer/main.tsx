import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { installRemoteAPI } from './lib/remote-api'

// If running in a browser (no Electron preload), install WebSocket bridge
installRemoteAPI()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
