import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pocket + Next.js Example',
  description: 'Demonstrates RSC server loading with local-first client hydration',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          maxWidth: '640px',
          margin: '2rem auto',
          padding: '0 1rem',
          color: '#1a1a1a',
          backgroundColor: '#fafafa',
        }}
      >
        {children}
      </body>
    </html>
  );
}
