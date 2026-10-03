import app from "./app";
import { logger } from "./lib/logger";
import { startHobbyTymeRefreshScheduler } from "./lib/hobbytyme";
import { startHeartlandRefreshScheduler } from "./lib/heartland";
import { startWalthersRefreshScheduler } from "./lib/walthers";
import { startMmdRefreshScheduler } from "./lib/mmd";
import { initializeSupplierInventory } from "./lib/supplier-inventory";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

initializeSupplierInventory().then(() => app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startHobbyTymeRefreshScheduler();
  startHeartlandRefreshScheduler();
  startWalthersRefreshScheduler();
  startMmdRefreshScheduler();
})).catch((err) => {
  logger.error({ err }, "Supplier inventory initialization failed");
  process.exit(1);
});
