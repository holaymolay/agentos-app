import { z } from "zod";
import { createOpenClawAdminBridge } from "./host/openclaw-admin-bridge.js";

const schema = z.object({
  AGENTOS_OPENCLAW_ADMIN_BRIDGE_BIND: z.string().min(1).default("127.0.0.1"),
  AGENTOS_OPENCLAW_ADMIN_BRIDGE_PORT: z.coerce.number().int().positive().default(19401),
  AGENTOS_OPENCLAW_ADMIN_BRIDGE_TOKEN: z.string().min(16),
  AGENTOS_OPENCLAW_SYSTEMD_UNIT: z.string().min(1).default("openclaw-gateway.service"),
});

async function main(): Promise<void> {
  const config = schema.parse(process.env);
  const server = createOpenClawAdminBridge({
    bindHost: config.AGENTOS_OPENCLAW_ADMIN_BRIDGE_BIND,
    port: config.AGENTOS_OPENCLAW_ADMIN_BRIDGE_PORT,
    bearerToken: config.AGENTOS_OPENCLAW_ADMIN_BRIDGE_TOKEN,
    serviceName: config.AGENTOS_OPENCLAW_SYSTEMD_UNIT,
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.AGENTOS_OPENCLAW_ADMIN_BRIDGE_PORT, config.AGENTOS_OPENCLAW_ADMIN_BRIDGE_BIND, () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(
    `OpenClaw admin bridge listening on http://${config.AGENTOS_OPENCLAW_ADMIN_BRIDGE_BIND}:${config.AGENTOS_OPENCLAW_ADMIN_BRIDGE_PORT}`,
  );

  const shutdown = async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  };

  process.on("SIGINT", () => {
    shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    shutdown().finally(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
