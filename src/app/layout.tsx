import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "StudioFlow",
  description:
    "Booking, CRM, and growth platform for studios.",
  openGraph: {
    title: "StudioFlow",
    description:
      "Booking, CRM, and growth platform for studios.",
    url: "https://studioflow.ie",
    siteName: "StudioFlow",
    locale: "en_IE",
    type: "website",
  },
  metadataBase: new URL("https://studioflow.ie"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
