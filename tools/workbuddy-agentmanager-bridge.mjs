import { BridgeRuntime } from "../src/bridge/runtime.mjs";
import { parseArgs } from "../src/shared.mjs";
import { startBridgeServer } from "../src/server/bridge-server.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtime = new BridgeRuntime(options);
  await runtime.prepareWebAssets();
  await startBridgeServer(runtime, options);
  runtime.warmup().catch((error) => {
    console.warn("[bridge] warmup failed:", error instanceof Error ? error.message : String(error));
  });
}

main().catch((error) => {
  console.error("[bridge] Fatal:", error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
