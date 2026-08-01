import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

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
          <div className="flex h-screen flex-col bg-background md:flex-row">
            <Sidebar />
            <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
