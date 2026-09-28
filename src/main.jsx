import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import RootErrorBoundary from './components/RootErrorBoundary.jsx'
import { AuthProvider } from './lib/useAuth'
import { CountryProvider } from './lib/useCountry'
import { CurrencyProvider } from './lib/useCurrency'
import AccountPrefsSync from './lib/AccountPrefsSync'
import { loadInsights } from './pages/insightsLoader'
import './index.css'

const container = document.getElementById('root')
const mount = () => ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <AuthProvider>
        <CountryProvider>
          <CurrencyProvider>
            <AccountPrefsSync />
            <App />
          </CurrencyProvider>
        </CountryProvider>
      </AuthProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
)

// A page the build pre-rendered (scripts/prerender.mjs — the analyses) is
// already on screen. Mount once the code for it is in, so the app's first
// render IS that page and the hand-over is one swap of identical content —
// not content, then a loading spinner, then the content again. Mounting
// anyway if the chunk fails keeps the app's own error handling in charge.
if (container.dataset.prerendered) loadInsights().then(mount, mount)
else mount()
