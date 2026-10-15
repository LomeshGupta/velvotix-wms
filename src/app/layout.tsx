import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppProviders } from "@/providers/AppProviders";
import { PwaRegister } from "@/components/pwa/PwaRegister";

export const metadata: Metadata = {
  title: { default: "Velvotix WMS", template: "%s · Velvotix WMS" },
  description:
    "Warehouse execution for Microsoft Dynamics 365 Business Central",
  manifest: "/manifest.webmanifest",
  applicationName: "Velvotix WMS",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EEF0F2" },
    { media: "(prefers-color-scheme: dark)", color: "#0E151B" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>
          {children}
          <PwaRegister />
        </AppProviders>
      </body>
    </html>
  );
}
