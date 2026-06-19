import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { RenderBenchmark } from './features/benchmark/RenderBenchmark'
import { InspectorDrawer } from './features/inspector/InspectorDrawer'
import { OrdersPanel } from './features/orders/OrdersPanel'
import { SwapCard } from './features/swap/SwapCard'
import { Header } from './features/wallet/Header'
import { ToastProvider } from './ui/toast'
import { WalletProvider } from './wallet/WalletProvider'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <ToastProvider>
          <div className="app">
            <Header />
            <main className="app-main">
              <div className="columns">
                <SwapCard />
                <OrdersPanel />
              </div>
            </main>
            <footer className="app-footer">
              <p>
                A demonstration interface built on the open-source CoW Protocol SDK compiled to
                WebAssembly. Not affiliated with CoW DAO. Sepolia is available for free testing.
              </p>
            </footer>
            <InspectorDrawer />
            <RenderBenchmark />
          </div>
        </ToastProvider>
      </WalletProvider>
    </QueryClientProvider>
  )
}
