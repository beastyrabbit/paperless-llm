import type { Config } from "../../config/index.js";
import { Empty, Ledger, Part, Scale } from "./components.js";
import { Layout, type Shell } from "./layout.js";

export function ConfigPage({
  config,
  credentials,
  configHash,
  shell,
}: {
  config: Config;
  credentials: Record<string, string>;
  configHash: string;
  shell: Shell;
}) {
  const providers = [
    ["Paperless-ngx", config.paperless.url, "None", "paperlessToken"],
    ["Mistral OCR", config.ocr.mistralApiBaseUrl, config.ocr.mistralModel, "mistralApiKey"],
    ["Jev", config.jev.apiBaseUrl, config.jev.model, "jevApiKey"],
    ["Cloud LLM", config.llm.cloud.baseUrl, config.llm.cloud.model, "llmApiKey"],
    ["Local LLM", config.llm.local.baseUrl, config.llm.local.model, "localLlmApiKey"],
  ];
  const rules = [
    [
      config.tags.requested,
      "Classify this document and read its fields",
      "Paperless workflow or by hand",
      "Processing finishes: clean, in review or failed",
    ],
    [
      config.tags.review,
      "At least one field or name waits for a decision",
      "This service",
      "All held changes are approved or rejected",
    ],
    [
      config.tags.failed,
      "Processing stopped with an error",
      "This service",
      "The next service-tag update sets review or clean",
    ],
  ];
  return (
    <Layout
      title="Configuration"
      active="config"
      shell={shell}
      lede="Read-only. Edit the GitOps YAML and restart to apply changes. This page shows the validated configuration currently running."
      summary={
        <dl class="infoblock">
          <div>
            <dt>Configuration hash</dt>
            <dd>
              <code class="config-hash">{configHash}</code>
            </dd>
          </div>
          <div>
            <dt>Staging mode</dt>
            <dd>{config.stagingMode.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt>Polling</dt>
            <dd>
              {config.polling.enabled
                ? `Every ${config.polling.intervalMs / 1000} seconds`
                : "Disabled"}
            </dd>
          </div>
        </dl>
      }
    >
      <Part
        id="providers"
        title="Providers"
        note="Secrets come from the environment. This page shows whether one is set, never its value."
      >
        <Ledger headings={["Service", "Endpoint", "Model", "Secret"]}>
          <tbody>
            {providers.map(([service, endpoint, model, key]) => (
              <tr key={service}>
                <td class="cell-main">
                  <b>{service}</b>
                </td>
                <td data-label="Endpoint">
                  <code>{endpoint}</code>
                </td>
                <td data-label="Model">
                  <code>{model}</code>
                </td>
                <td
                  data-label="Secret"
                  class={`secret${credentials[key ?? ""] === "configured" ? "" : " secret-missing"}`}
                >
                  {credentials[key ?? ""] === "configured" ? (
                    <>
                      <span class="redacted" aria-hidden="true" />
                      set
                    </>
                  ) : (
                    "not set"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Ledger>
      </Part>
      <Part
        id="tags"
        title="Tag rules"
        note="Service tags are changed with verified bulk deltas. Unrelated tags are preserved."
      >
        <div>
          <Ledger headings={["Tag", "Means", "Set by", "Removed when"]}>
            <tbody>
              {rules.map(([tag, means, set, removed]) => (
                <tr key={tag}>
                  <td class="cell-main">
                    <span class="tagname">{tag}</span>
                  </td>
                  <td data-label="Means">{means}</td>
                  <td data-label="Set by">{set}</td>
                  <td data-label="Removed when">{removed}</td>
                </tr>
              ))}
            </tbody>
          </Ledger>
          {Object.keys(config.tags.curated).length > 0 && (
            <Ledger caption="Curated tag descriptions" headings={["Tag", "Description"]}>
              <tbody>
                {Object.entries(config.tags.curated).map(([tag, description]) => (
                  <tr key={tag}>
                    <td class="cell-main">
                      <span class="tagname">{tag}</span>
                    </td>
                    <td data-label="Description">{description}</td>
                  </tr>
                ))}
              </tbody>
            </Ledger>
          )}
        </div>
      </Part>
      <Part
        id="ocr"
        title="OCR limits"
        note="Pages are reserved before the paid provider call, including calls whose outcome is uncertain."
      >
        <Ledger headings={["Setting", "Value", "Effect"]}>
          <tbody>
            {[
              [
                "ocr.enabled",
                String(config.ocr.enabled),
                "Enable paid OCR for eligible new documents.",
              ],
              [
                "ocr.notBefore",
                config.ocr.notBefore,
                "Older documents keep their existing OCR text.",
              ],
              [
                "ocr.maxPagesPerDay",
                String(config.ocr.maxPagesPerDay),
                "Daily reserved page cap. Resets at 00:00 UTC.",
              ],
              [
                "ocr.versionMode",
                config.ocr.versionMode,
                "Write text in place or create a derivative version.",
              ],
              [
                "ocr.allowAutoRetryUncertain",
                String(config.ocr.allowAutoRetryUncertain),
                "Automatic repetition of an ambiguous paid call requires this explicit setting.",
              ],
            ].map(([key, value, effect]) => (
              <tr key={key}>
                <td class="cell-main">
                  <code>{key}</code>
                </td>
                <td data-label="Value">{value}</td>
                <td data-label="Effect">{effect}</td>
              </tr>
            ))}
          </tbody>
        </Ledger>
      </Part>
      <Part
        id="types"
        title="Document types"
        note="Each type lists its extraction fields. Thresholds below come from the active configuration."
      >
        <div>
          {Object.keys(config.documentTypes).length ? (
            Object.entries(config.documentTypes).map(([name, type]) => (
              <details class="schema" key={name}>
                <summary>
                  <span class="schema-name">{name}</span>
                  <Scale
                    zone
                    t={config.jev.thresholds.documentType}
                    read={
                      <>
                        Type from <b>{config.jev.thresholds.documentType.toFixed(2)}</b>
                      </>
                    }
                  />
                  <span class="schema-stats">
                    {type.openFields.length} open fields, {type.selectFields.length} select fields
                  </span>
                </summary>
                <div class="schema-body">
                  <p>
                    Extraction route: <code>{type.llmRouting ?? config.llm.defaultProvider}</code>.
                    Title template: <code>{type.titleTemplate ?? "None"}</code>.
                  </p>
                  {type.openFields.length > 0 && (
                    <Ledger headings={["Field", "Type", "Checks", "Semantic threshold"]}>
                      <tbody>
                        {type.openFields.map((field) => (
                          <tr key={field.name}>
                            <td class="cell-main">
                              {field.name}
                              <small>{field.description}</small>
                            </td>
                            <td data-label="Type">
                              {field.kind}
                              {field.required ? ", required" : ", optional"}
                            </td>
                            <td data-label="Checks">
                              Verbatim evidence and type validation
                              {field.maxLength
                                ? `, length up to ${Math.min(128, field.maxLength)}`
                                : ""}
                            </td>
                            <td data-label="Semantic threshold">
                              {field.semanticCheck
                                ? config.jev.thresholds.semanticCheck.toFixed(2)
                                : "When a closed choice needs confirmation"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Ledger>
                  )}
                  {type.selectFields.length > 0 && (
                    <p>
                      Select fields: {type.selectFields.join(", ")}. Values must exist in the
                      Paperless catalog.
                    </p>
                  )}
                  {!type.openFields.length && !type.selectFields.length && (
                    <p>No extraction fields configured.</p>
                  )}
                </div>
              </details>
            ))
          ) : (
            <Empty title="No document-type schemas configured.">
              Add documentTypes to the GitOps YAML to configure extraction.
            </Empty>
          )}
          <Ledger
            caption="Thresholds that apply across document types"
            headings={["Decision", "Threshold"]}
          >
            <tbody>
              {Object.entries(config.jev.thresholds).map(([key, value]) => (
                <tr key={key}>
                  <td class="cell-main">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</td>
                  <td data-label="Threshold">
                    <Scale
                      zone
                      t={value}
                      read={
                        <>
                          From <b>{value.toFixed(2)}</b>
                        </>
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Ledger>
        </div>
      </Part>
      <Part
        id="runtime"
        title="Runtime settings"
        note="All validated settings, including defaults. Credentials are listed above only as set or missing."
      >
        <pre class="config-json">{JSON.stringify(config, null, 2)}</pre>
      </Part>
      <Part
        id="cli"
        title="Commands"
        note="Run these commands inside the application container. Provider calls use the configured endpoints."
      >
        <dl class="cli">
          {[
            [
              "node dist/cli.js calibrate",
              "Compare Jev decisions with existing metadata. Reports precision and shortlist recall; it does not change Paperless metadata.",
            ],
            [
              "node dist/cli.js consolidate",
              "Scan for duplicate names using Jev and record proposals. Add --suggest to ask the LLM for additional candidate pairs.",
            ],
            [
              "node dist/cli.js reconcile",
              "Rebuild local OCR state from document version markers after restoring the database.",
            ],
            [
              "node dist/cli.js undo <batchId>",
              "Reverse journaled changes in one merge batch while preserving later human edits.",
            ],
          ].map(([command, description]) => (
            <div key={command}>
              <dt>{command}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </Part>
    </Layout>
  );
}
