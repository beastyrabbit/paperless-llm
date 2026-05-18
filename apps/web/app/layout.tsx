import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
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
        <NextIntlClientProvider messages={messages}>
          <AppTinyBaseProvider>
            <GlobalStatusProvider>
              <div className="flex h-screen bg-background">
                <Sidebar />
                <main className="flex-1 overflow-auto">{children}</main>
              </div>
            </GlobalStatusProvider>
          </AppTinyBaseProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
