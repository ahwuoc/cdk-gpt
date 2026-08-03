import type { Metadata } from 'next';
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
      </body>
    </html>
  );
}
