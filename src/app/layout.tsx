import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Đếm ngược',
  description: 'Đồng hồ đếm lên và đếm ngược.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
