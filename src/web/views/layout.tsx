import type { Child } from "hono/jsx";
import { Alert } from "./components.js";

export interface Shell {
  counts: { review: number; consolidation: number; activity: number };
  externalUrl: string;
  configHash: string;
  unavailable?: string;
}
export function Counts({ counts, oob = false }: { counts: Shell["counts"]; oob?: boolean }) {
  return (
    <>
      {(["review", "consolidation", "activity"] as const).map((key) => (
        <span
          key={key}
          class="tab-count"
          id={`count-${key}`}
          hx-swap-oob={oob ? "true" : undefined}
        >
          {counts[key]}
        </span>
      ))}
    </>
  );
}
export function Layout({
  title,
  active,
  lede,
  summary,
  shell,
  children,
}: {
  title: string;
  active: "review" | "consolidation" | "activity" | "config";
  lede: string;
  summary?: Child;
  shell: Shell;
  children: Child;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} | Paperless Local LLM</title>
        <meta
          name="htmx-config"
          content={JSON.stringify({
            responseHandling: [
              { code: "204", swap: false },
              { code: "[23]..", swap: true },
              { code: "[45]..", swap: true, error: true },
            ],
          })}
        />
        <link rel="stylesheet" href="/assets/styles.css" />
        <script src="/assets/htmx.min.js" defer />
      </head>
      <body>
        <a class="skip" href="#main">
          Skip to content
        </a>
        <div class="desk">
          <header class="masthead">
            <a class="brand" href="/">
              <svg class="brand-mark" viewBox="0 0 8 15" aria-hidden="true">
                <circle cx="4" cy="3" r="2.5" fill="currentColor" />
                <circle cx="4" cy="12" r="2.5" fill="currentColor" />
              </svg>
              Paperless Local LLM
            </a>
            <p class="masthead-state">
              Paperless-ngx archive<a href={shell.externalUrl}>Open Paperless</a>
            </p>
          </header>
          <nav class="tabs" aria-label="Sections">
            {(
              [
                ["review", "/", "Review"],
                ["consolidation", "/consolidation", "Consolidation"],
                ["activity", "/activity", "Activity"],
                ["config", "/config", "Configuration"],
              ] as const
            ).map(([key, href, text]) => (
              <a
                key={key}
                class="tab"
                href={href}
                aria-current={active === key ? "page" : undefined}
              >
                {text}
                {key !== "config" && (
                  <span class="tab-count" id={`count-${key}`}>
                    {shell.counts[key]}
                  </span>
                )}
              </a>
            ))}
          </nav>
          <main class="sheet" id="main">
            <header class="letterhead">
              <div>
                <h1>{title}</h1>
                <p class="lede">{lede}</p>
              </div>
              {summary}
            </header>
            <div id="announce" class="vh" role="status" aria-live="polite" />
            {shell.unavailable && (
              <Alert page title="Paperless did not answer">
                {shell.unavailable} Local journal entries remain available. Check Paperless before
                trying again.
              </Alert>
            )}
            {children}
          </main>
          <footer class="colophon">
            <span>Paperless Local LLM {process.env.APP_VERSION ?? "0.1.0"}</span>
            <span>
              Configuration <code>{shell.configHash.slice(0, 12)}</code>
            </span>
            <a href="/privacy">Privacy</a>
            <a href="/datenschutz">Datenschutz</a>
            <a href="/impressum">Impressum</a>
            <a href="/legal-notice">Legal notice</a>
          </footer>
        </div>
      </body>
    </html>
  );
}
