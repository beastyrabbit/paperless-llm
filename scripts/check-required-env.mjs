const requiredKeys = process.argv.slice(2);
const missingKeys = requiredKeys.filter((key) => !process.env[key]?.trim());

if (missingKeys.length) {
  console.error(`Missing Infisical keys: ${missingKeys.join(", ")}`);
  process.exit(1);
}

console.log(`Infisical environment ready (${requiredKeys.length} required keys).`);
