const requiredKeys = process.argv.slice(2);
const missingKeys = requiredKeys.filter((key) => !process.env[key]?.trim());

if (missingKeys.length) {
  console.error(`Missing Infisical keys: ${missingKeys.join(", ")}`);
  process.exit(1);
}

const endpointKeys = ["PAPERLESS_URL", "OLLAMA_URL", "QDRANT_URL"].filter((key) =>
  requiredKeys.includes(key),
);
const invalidEndpointKeys = endpointKeys.filter((key) => {
  try {
    const url = new URL(process.env[key]);
    return (
      !["http:", "https:"].includes(url.protocol) ||
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  } catch {
    return true;
  }
});

if (invalidEndpointKeys.length) {
  console.error(
    `Infisical endpoints must be absolute, non-loopback HTTP(S) URLs: ${invalidEndpointKeys.join(", ")}`,
  );
  process.exit(1);
}

const positiveIntegerKeys = [
  "QDRANT_EMBEDDING_DIMENSION",
  "PAPERLESS_LLM_AI_ANALYSE_TAG_ID",
].filter((key) => requiredKeys.includes(key));
const invalidPositiveIntegerKeys = positiveIntegerKeys.filter((key) => {
  const value = process.env[key];
  return !value || !/^[1-9]\d*$/.test(value);
});

if (invalidPositiveIntegerKeys.length) {
  console.error(
    `Infisical values must be positive integers: ${invalidPositiveIntegerKeys.join(", ")}`,
  );
  process.exit(1);
}

if (
  requiredKeys.includes("PAPERLESS_LLM_MUTATION_MODE") &&
  process.env.PAPERLESS_LLM_MUTATION_MODE !== "paperless_first"
) {
  console.error("PAPERLESS_LLM_MUTATION_MODE must be paperless_first for the overhaul runtime.");
  process.exit(1);
}

if (
  requiredKeys.includes("PAPERLESS_LLM_AI_ANALYSE_SCANNER_SCOPE") &&
  !["disabled", "canary", "all"].includes(process.env.PAPERLESS_LLM_AI_ANALYSE_SCANNER_SCOPE ?? "")
) {
  console.error("PAPERLESS_LLM_AI_ANALYSE_SCANNER_SCOPE must be disabled, canary, or all.");
  process.exit(1);
}

console.log(`Infisical environment ready (${requiredKeys.length} required keys).`);
