import Providers from './providers';
import { NavBar } from '../components/NavBar';
import '../index.css';

export const metadata = {
  title: 'sessionr',
  description: 'Mobile-first PWA for traditional musicians',
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
