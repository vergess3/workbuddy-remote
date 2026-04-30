import { BridgeRuntime } from "./bridge/runtime.mjs";
import { logger } from "./logger.mjs";
import { parseArgs } from "./shared.mjs";
import { startBridgeServer } from "./server/bridge-server.mjs";

function hasStatusCodeSymbol(error, code) {
  if (!error || typeof error !== "object") {
    return false;
  }

  return Object.getOwnPropertySymbols(error).some((symbol) => {
    return String(symbol) === "Symbol(status-code)" && error[symbol] === code;
  });
}

function isRecoverableWebSocketPayloadError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH" ||
    hasStatusCodeSymbol(error, 1009) ||
    /Max payload size exceeded|Unsupported message length/i.test(message)
  );
}

function exitAfterFatalProcessError(event, error, origin) {
  logger.error(event, "Bridge process encountered an unrecoverable error", {
    error,
    origin,
  });
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
}

function installProcessGuards() {
  process.on("uncaughtException", (error, origin) => {
    if (isRecoverableWebSocketPayloadError(error)) {
      logger.warn("process.websocket_payload_limit", "Ignored oversized WebSocket payload error", {
        error,
        origin,
      });
      return;
    }

    exitAfterFatalProcessError("process.uncaught_exception", error, origin);
  });

  process.on("unhandledRejection", (reason) => {
    if (isRecoverableWebSocketPayloadError(reason)) {
      logger.warn("process.websocket_payload_limit", "Ignored oversized WebSocket payload rejection", {
        error: reason,
      });
      return;
    }

    exitAfterFatalProcessError("process.unhandled_rejection", reason, "unhandledRejection");
  });
}

async function main() {
  installProcessGuards();
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
