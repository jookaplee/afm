import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { I18nProvider } from './lib/i18n.tsx';
import { ConfirmProvider, MetaProvider, ToastProvider } from './lib/app-context.tsx';
import { STANDALONE } from './lib/env.ts';
import { DatasetGate } from './components/LockScreen.tsx';
import './styles.css';

// Hosted standalone pages can't rely on the URL path, so routing stays in memory there.
const Router = STANDALONE ? MemoryRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <I18nProvider>
        {/* Before any provider calls the API: a password-protected page must be opened first. */}
        <DatasetGate>
          <ToastProvider>
            <ConfirmProvider>
              <MetaProvider>
                <App />
              </MetaProvider>
            </ConfirmProvider>
          </ToastProvider>
        </DatasetGate>
      </I18nProvider>
    </Router>
  </StrictMode>,
);
