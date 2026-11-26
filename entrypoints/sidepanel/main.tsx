import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/app.css';
import { applyAppearance, readCachedAppearance } from '@/lib/appearance';
import App from './App';

// paint with the last-used theme / text size before settings load (no light flash in dark mode)
const cached = readCachedAppearance();
if (cached) applyAppearance(document.documentElement, cached);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
