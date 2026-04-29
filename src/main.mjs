import { BridgeRuntime } from "./bridge/runtime.mjs";
import { logger } from "./logger.mjs";
import { parseArgs } from "./shared.mjs";
import { startBridgeServer } from "./server/bridge-server.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtime = new BridgeRuntime(options);
  await startBridgeServer(runtime, options);
  runtime.warmup().catch((error) => {
    logger.warn("bridge.warmup.error", "Bridge warmup failed", { error });
  });
}

main().catch((error) => {
  logger.error("bridge.fatal", "Bridge process failed", { error });
  process.exitCode = 1;
});
