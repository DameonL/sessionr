import { render } from 'preact'
import { LocationProvider } from 'preact-iso'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { App } from './app.tsx'

const queryClient = new QueryClient()

render(
  <QueryClientProvider client={queryClient}>
    <LocationProvider>
      <App />
    </LocationProvider>
  </QueryClientProvider>,
  document.getElementById('app')!,
)
