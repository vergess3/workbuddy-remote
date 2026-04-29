import { BridgeRuntime } from "./bridge/runtime.mjs";
import { logger } from "./logger.mjs";
import { parseArgs } from "./shared.mjs";
import { startBridgeServer } from "./server/bridge-server.mjs";
import { ModelSecretStore } from "./server/model-secret-store.mjs";
import { startModelProxyServer } from "./server/model-proxy.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.enableModelSecretProxy) {
    if (!options.modelSecretStorePath) {
      throw new Error("--model-secret-store-path is required when model secret proxy is enabled.");
    }
    options.modelSecretStore = new ModelSecretStore(options.modelSecretStorePath);
    await options.modelSecretStore.load();
    await startModelProxyServer(options.modelSecretStore, options);
  }

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
