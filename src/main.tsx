import React from 'react'
import ReactDOM from 'react-dom/client'
import { frontendTokens, installCssVariables } from '@agi/frontend'

import App from './App'
import './styles.css'

installCssVariables(frontendTokens)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
