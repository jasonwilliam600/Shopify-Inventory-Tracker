import app from "./app";
import { logger } from "./lib/logger";
import { startHobbyTymeRefreshScheduler } from "./lib/hobbytyme";
import { startHeartlandRefreshScheduler } from "./lib/heartland";
import { startWalthersRefreshScheduler } from "./lib/walthers";
import { startMmdRefreshScheduler } from "./lib/mmd";
import { initializeSupplierInventory } from "./lib/supplier-inventory";
import { inventoryStartup } from "./lib/inventory-startup";

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

app.listen(port, "0.0.0.0", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  inventoryStartup.start({
    initialize: initializeSupplierInventory,
    onReady: () => {
      logger.info("Supplier inventory initialization completed");
      startHobbyTymeRefreshScheduler();
      startHeartlandRefreshScheduler();
      startWalthersRefreshScheduler();
      startMmdRefreshScheduler();
    },
    onError: (err) => {
      logger.error({ err, retrySeconds: 15 }, "Supplier inventory initialization failed; inventory requests remain unavailable while startup retries");
    },
  });
});
