import type { Metadata, Viewport } from 'next';
import Providers from './providers';
import { NavBar } from '../components/NavBar';
import '../index.css';

export const metadata: Metadata = {
  title: 'sessionr',
  description: 'Mobile-first PWA for traditional musicians',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'sessionr',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/icon-192x192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <NavBar />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
