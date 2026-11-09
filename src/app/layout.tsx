import type { Metadata } from "next";
import "@fontsource-variable/figtree";
import "./globals.css";

export const metadata: Metadata = {
  title: "ISTO · Marketing",
  description: "Реклама, соцмережі та ліди ISTO в одному місці",
  robots: { index: false, follow: false },
};

/** Applies the saved theme before first paint so the page never flashes the wrong colours. */
const themeScript = `try{var t=localStorage.getItem("isto-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Erode (brand secondary typeface) is free for commercial use via Fontshare. */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=erode@300&f[]=erode@300i&display=swap" />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
