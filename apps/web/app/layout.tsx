import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { LegalLinks } from "@/components/legal-links";
import { Sidebar } from "@/components/sidebar";
import { GlobalStatusProvider } from "@/lib/global-status";
import { AppTinyBaseProvider } from "@/lib/tinybase";

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
      <body className="antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AppTinyBaseProvider>
            <GlobalStatusProvider>
              <div className="flex h-screen flex-col bg-background">
                <div className="flex min-h-0 flex-1">
                  <Sidebar />
                  <main className="min-w-0 flex-1 overflow-auto">{children}</main>
                </div>
                <LegalLinks />
              </div>
            </GlobalStatusProvider>
          </AppTinyBaseProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
