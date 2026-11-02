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
  title: "MJIC Customized Apparel Supplier | Corporate Uniforms & Custom Jackets Philippines",
  description: "MJIC custom apparel, corporate uniform and custom jacket manufacturer in the Philippines. MOQ 20 pcs, free Metro Manila delivery, free digital mock-up.",
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
