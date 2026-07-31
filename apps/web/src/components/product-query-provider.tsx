import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

export function ProductQueryProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 10 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
          },
          mutations: { retry: 0 },
        },
      })
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
