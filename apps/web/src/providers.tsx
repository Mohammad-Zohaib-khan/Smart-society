import { createContext, useContext, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';
import { useTheme } from '@/hooks/useTheme';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
    },
  },
});

type ThemeApi = ReturnType<typeof useTheme>;
const ThemeContext = createContext<ThemeApi | null>(null);

export function useThemeContext(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('ThemeContext missing');
  return ctx;
}

export function Providers({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <ThemeContext.Provider value={theme}>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster
          position="bottom-right"
          theme={theme.dark ? 'dark' : 'light'}
          toastOptions={{ className: '!rounded-2xl !border-border !bg-surface !text-foreground !font-sans !shadow-lift' }}
        />
      </QueryClientProvider>
    </ThemeContext.Provider>
  );
}
