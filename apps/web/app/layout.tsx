import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { LegalLinks } from "@/components/legal-links";
import { Sidebar } from "@/components/sidebar";
import { AppTinyBaseProvider } from "@/lib/tinybase";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Paperless Local LLM",
  description: "KI-gestütztes Dokumentenanalyse-System für Paperless-ngx",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className="dark">
      <body
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AppTinyBaseProvider>
            <div className="flex h-screen flex-col bg-background">
              <div className="flex min-h-0 flex-1">
                <Sidebar />
                <main className="min-w-0 flex-1 overflow-auto">{children}</main>
              </div>
              <LegalLinks />
            </div>
          </AppTinyBaseProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
