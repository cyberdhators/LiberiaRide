import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "LiberiaRide", template: "%s · LiberiaRide" },
  description: "Book a keke, car or comfort ride across Monrovia.",
  applicationName: "LiberiaRide",
  appleWebApp: { capable: true, title: "LiberiaRide", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#143f85",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-LR" className={inter.variable}>
      <body className="min-h-dvh font-sans">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
