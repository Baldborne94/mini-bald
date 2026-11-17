import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/dm-sans';
import './styles/themes.css';
import './styles/base.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.tsx';

// Chrome offers installation through this event; keep it for the Settings page.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  (window as unknown as { minibaldInstall?: Event }).minibaldInstall = event;
  window.dispatchEvent(new Event('minibald:installable'));
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
