import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import CmsLoader from "./_components/CmsLoader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://jacket-ai.vercel.app"),
  title: {
    default: "Michael Jeffrey International Corporation | Custom Jackets and More",
    template: "%s | MJIC",
  },
  description:
    "Michael Jeffrey International Corporation (MJIC) makes custom jackets, corporate uniforms, and branded products in the Philippines. MOQ 20 pieces, free digital mock-up, and free Metro Manila delivery.",
  openGraph: {
    title: "Michael Jeffrey International Corporation | Custom Jackets and More",
    description:
      "Custom jackets, corporate uniforms, and branded products by Michael Jeffrey International Corporation in the Philippines.",
    url: "/",
    siteName: "Michael Jeffrey International Corporation",
    locale: "en_PH",
    type: "website",
    images: [
      {
        url: "/branding/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Michael Jeffrey International Corporation — Custom Jackets and More",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Michael Jeffrey International Corporation | Custom Jackets and More",
    description:
      "Custom jackets, corporate uniforms, and branded products by MJIC in the Philippines.",
    images: ["/branding/og-image.jpg"],
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}<CmsLoader /></body>
    </html>
  );
}
