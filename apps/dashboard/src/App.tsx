import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { AuthProvider } from './auth/AuthProvider';
import { ThemeProvider } from './lib/theme';
import { createAppRouter } from './router';

export function App({ history }: { history?: Parameters<typeof createAppRouter>[0] }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } }),
  );
  const [router] = useState(() => createAppRouter(history));
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
