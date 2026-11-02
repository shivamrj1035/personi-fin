import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Gujarati } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const gujarati = Noto_Sans_Gujarati({ variable: "--font-gu", subsets: ["gujarati"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "EL Smart Tracker", template: "%s · EL Smart Tracker" },
  description: "Track EMIs, loans and borrowings, and clear them sooner.",
  applicationName: "EL Smart Tracker",
  appleWebApp: { capable: true, title: "EL Tracker", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f6f7fb" }, { media: "(prefers-color-scheme: dark)", color: "#0b1020" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${gujarati.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
