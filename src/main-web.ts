import { createRuntimeFromEnv } from "./bootstrap.js";
import { createServer } from "./web/create-server.js";

async function main(): Promise<void> {
  const runtime = await createRuntimeFromEnv();
  const app = await createServer(runtime);
  await app.listen({ port: 3000, host: "0.0.0.0" });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
