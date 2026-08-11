import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './features/layout/AppShell.js';

/**
 * Root.
 *
 * TanStack Query owns all server state; there is no second store. Retries are
 * disabled for mutations because every mutation here is a conditional write —
 * a blind retry would either fail identically on the same stale ETag or, worse,
 * succeed twice. Conflict recovery is explicit, in usePatchNode.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: 1,
      staleTime: 5_000,
    },
    mutations: {
      retry: false,
    },
  },
});

export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell />} />
          <Route path="/tasks/:taskId" element={<AppShell />} />
          <Route path="*" element={<AppShell />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
