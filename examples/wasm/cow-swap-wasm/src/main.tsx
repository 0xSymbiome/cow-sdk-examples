import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app'
import { ensureCowReady } from './lib/cow'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

const root = createRoot(container)

// On the bundler target the wasm module is instantiated on import, so this
// resolves immediately; keeping the await means the same entry also works on the
// web/edge target where the host owns instantiation.
void ensureCowReady().then(() => {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
