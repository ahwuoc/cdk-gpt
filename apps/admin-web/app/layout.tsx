import type { Metadata } from 'next';
import { AppToaster } from './app-toaster';
import './globals.css';

export const metadata: Metadata = {
  title: 'Digital Store Admin',
  description: 'Secure administration for encrypted digital inventory.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="w-full h-full">
      <body className="w-full min-h-screen">
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
