import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { NATSProvider } from './context/NATSContext.tsx'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <NATSProvider>
            <App />
        </NATSProvider>
    </React.StrictMode>,
)
