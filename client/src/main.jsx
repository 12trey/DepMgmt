import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AdCredentialProvider } from './context/AdCredentialContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AdCredentialProvider>
        <App />
      </AdCredentialProvider>
    </BrowserRouter>
  </React.StrictMode>
);
