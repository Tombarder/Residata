import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthProvider } from './lib/useAuth'
import { CountryProvider } from './lib/useCountry'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <CountryProvider>
        <App />
      </CountryProvider>
    </AuthProvider>
  </React.StrictMode>,
)
