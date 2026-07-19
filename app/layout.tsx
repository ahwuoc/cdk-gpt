import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'New Application',
  description: 'Clean start project initialized from scratch.',
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
      </body>
    </html>
  );
}
