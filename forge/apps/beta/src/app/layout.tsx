import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'FORGE — Train. Track. Go further.',
    template: '%s · FORGE',
  },
  description:
    'A personal performance network: structured training, activity tracking, routes and maps, progress that means something, and real coaching.',
  applicationName: 'FORGE',
  openGraph: {
    title: 'FORGE — Train. Track. Go further.',
    description:
      'Structured training, activity tracking, routes and maps, and progress that means something.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0B0B0C',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
