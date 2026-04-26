import { BridgeRuntime } from "../src/bridge/runtime.mjs";
import { logger } from "../src/logger.mjs";
import { parseArgs } from "../src/shared.mjs";
import { startBridgeServer } from "../src/server/bridge-server.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtime = new BridgeRuntime(options);
  await runtime.prepareWebAssets();
  await startBridgeServer(runtime, options);
  runtime.warmup().catch((error) => {
    logger.warn("bridge.warmup.error", "Bridge warmup failed", { error });
  });
}

main().catch((error) => {
  logger.error("bridge.fatal", "Bridge process failed", { error });
  process.exitCode = 1;
});
