import { loadConfig } from "../config.js";
import { runMigrations } from "./postgres.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }
  await runMigrations(config.databaseUrl);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
