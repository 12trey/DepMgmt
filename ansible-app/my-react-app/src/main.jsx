import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Frame from './Frame.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* <App /> */}
    <Frame>
      <App />
    </Frame>
  </StrictMode>,
)
