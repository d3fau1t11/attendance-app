import app from "./app";
import { logger } from "./lib/logger";
import { config } from "./lib/config";
import { startSweeper, stopSweeper } from "./services/sweeper";

const port = config.port;

/**
 * Bind to 0.0.0.0 rather than localhost so a phone on the same Wi-Fi can reach
 * the API during development. In production the platform terminates TLS in
 * front of this process.
 */
const server = app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
  startSweeper();
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

/** Drain in-flight requests before exiting so a deploy cannot truncate a check-in. */
function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  stopSweeper();
  server.close(() => process.exit(0));
  // Failsafe: do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
