import { cpSync, mkdirSync } from "node:fs";
mkdirSync("dist/db/migrations", { recursive: true });
cpSync("src/db/migrations", "dist/db/migrations", { recursive: true });
mkdirSync("dist/web/public", { recursive: true });
cpSync("src/web/public", "dist/web/public", { recursive: true });
cpSync("node_modules/htmx.org/dist/htmx.min.js", "dist/web/public/htmx.min.js");
