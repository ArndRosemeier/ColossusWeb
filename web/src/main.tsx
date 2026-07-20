import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './components/App'
import { BackgroundAtmosphere } from './components/BackgroundAtmosphere'
import { initBackgroundAtmosphere } from './ui/backgroundAtmosphere'

initBackgroundAtmosphere()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BackgroundAtmosphere />
    <App />
  </StrictMode>,
)
