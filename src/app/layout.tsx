import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Cairo } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "GCCLAB — Training Management System",
  description: "GCCLAB Enterprise Training Management System — Gulf Calibration Laboratory",
  keywords: ["GCCLAB", "TMS", "Training", "Safety", "Certification", "Calibration"],
  authors: [{ name: "GCCLAB" }],
  icons: { icon: "/logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${cairo.variable} antialiased bg-background text-foreground`}
        style={{ fontFamily: "var(--font-inter), var(--font-cairo), system-ui, sans-serif" }}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
