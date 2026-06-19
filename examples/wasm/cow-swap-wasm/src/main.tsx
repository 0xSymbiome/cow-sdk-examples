import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app'
import { ensureCowReady } from './lib/cow'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

const root = createRoot(container)

// The browser resolves the trading flavour's web build, where the host owns wasm
// instantiation, so render only after `initialize()` resolves. (On the
// bundler/nodejs targets it resolves immediately, so the same entry works there.)
void ensureCowReady().then(() => {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
