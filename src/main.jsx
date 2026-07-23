import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import RootErrorBoundary from './components/RootErrorBoundary.jsx'
import { AuthProvider } from './lib/useAuth'
import { CountryProvider } from './lib/useCountry'
import { CurrencyProvider } from './lib/useCurrency'
import AccountPrefsSync from './lib/AccountPrefsSync'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
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
