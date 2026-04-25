import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { RouteProgressBar } from '@/components/LoadingProgressBar';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Mantra Football',
  description: 'Analyze squads, set formations and build the perfect lineup',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-gray-950 text-white min-h-screen antialiased font-sans">
        <RouteProgressBar />
        {children}
      </body>
    </html>
  );
}
