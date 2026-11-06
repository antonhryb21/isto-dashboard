import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: "ISTO · Marketing",
  description: "Реклама, соцмережі та ліди ISTO в одному місці",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
