import { createRuntimeFromEnv } from "./bootstrap.js";

async function main(): Promise<void> {
  const runtime = await createRuntimeFromEnv();
  const abortController = new AbortController();
  process.on("SIGINT", () => abortController.abort());
  process.on("SIGTERM", () => abortController.abort());
  await runtime.worker.startLoop(abortController.signal);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
