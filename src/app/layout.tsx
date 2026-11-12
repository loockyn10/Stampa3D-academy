import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MainLayout } from "./main-layout";
import { AppFeedbackProvider } from "@/components/ui/app-feedback";
import { PendingBetaCodeRedeemer } from "@/components/beta-access/PendingBetaCodeRedeemer";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { THEME_COLORS, THEME_INIT_SCRIPT } from "@/lib/theme/theme";
import { SIDEBAR_INIT_SCRIPT } from "@/lib/layout/sidebar-preference";
import { siteOrigin } from "@/lib/seo/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_DESCRIPTION = "Universo Stampa: formación, herramientas y comunidad para impresión 3D.";
const OG_IMAGE = { url: "/og/universo-stampa-og.png", width: 1200, height: 630, alt: "Universo Stampa" };

export const metadata: Metadata = {
  // Base absoluta para las imágenes de Open Graph / Twitter (NEXT_PUBLIC_APP_URL).
  metadataBase: new URL(siteOrigin()),
  title: "Universo Stampa",
  description: SITE_DESCRIPTION,
  applicationName: "Universo Stampa",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: "Universo Stampa",
    locale: "es_AR",
    title: "Universo Stampa",
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "Universo Stampa",
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

export const viewport: Viewport = {
  // El script de tema ajusta este valor segun el tema resuelto; el valor inicial corresponde al tema por defecto.
  themeColor: THEME_COLORS.dark,
  colorScheme: "light dark",
  // Necesario para que env(safe-area-inset-*) tenga valores en iOS (notch, barra de inicio) y en la PWA instalada.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: los scripts de tema y de sidebar fijan data-theme/color-scheme/data-sidebar en <html> antes de hidratar.
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
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
