import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MainLayout } from "./main-layout";
import { AppFeedbackProvider } from "@/components/ui/app-feedback";
import { PendingBetaCodeRedeemer } from "@/components/beta-access/PendingBetaCodeRedeemer";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { THEME_COLORS, THEME_INIT_SCRIPT } from "@/lib/theme/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Academia Stampa",
  description: "Plataforma de impresión 3D de Stampa",
  applicationName: "Academia Stampa",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  // El script de tema ajusta este valor segun el tema resuelto; el valor inicial corresponde al tema por defecto.
  themeColor: THEME_COLORS.dark,
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: el script de tema fija data-theme/color-scheme en <html> antes de hidratar.
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-stampa-bg text-stampa-body font-sans">
        <ThemeProvider>
          <AppFeedbackProvider>
            <PendingBetaCodeRedeemer />
            <MainLayout>{children}</MainLayout>
          </AppFeedbackProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
