import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'FORGE — Build Your Strongest Self',
    template: '%s · FORGE',
  },
  description:
    'A complete performance system combining personalised training, nutrition, recovery and real coaching.',
  applicationName: 'FORGE',
  authors: [{ name: 'FORGE' }],
  openGraph: {
    title: 'FORGE — Build Your Strongest Self',
    description: 'Training, nutrition, recovery and real coaching — personalised around you.',
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
