import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { CopilotPanel } from "@/components/common/copilot-panel";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "GCC Lab — Training Management System",
  description: "GCC Lab Enterprise Training & Certification Management System — المختبر الخليجي",
  keywords: ["GCC Lab", "TMS", "Training", "Safety", "Certification", "المختبر الخليجي"],
  authors: [{ name: "GCC Lab" }],
  icons: { icon: "/gcclab-icon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // dir/lang are corrected client-side once the stored locale is known (see
  // PublicShell and AppShell); these are the pre-hydration defaults.
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${plexArabic.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <CopilotPanel />
      </body>
    </html>
  );
}
