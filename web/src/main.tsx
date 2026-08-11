import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import './i18n/index.js';
import { initialiseTheme } from './lib/theme.js';
import { App } from './App.js';

// Before first paint: a dark-mode user should never see a white flash.
initialiseTheme();

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
