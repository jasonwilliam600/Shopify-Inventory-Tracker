import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { inventoryStartup } from "./lib/inventory-startup";
import { ApplicationSynchronization } from "./lib/application-synchronization";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import { requireMappingReviewer } from "./lib/reviewer-authorization";

const app: Express = express();
// Construct services only: no archive/key creation, DB import, new timer or
// Shopify access. Explicitly configured and authorized operations are separate.
app.locals.synchronization = new ApplicationSynchronization();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
// Absence of credentials is an explicit setup blocker, never a guest reviewer.
// No tenant or keys are provisioned by application startup.
if (process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY) {
  app.use(clerkMiddleware(req => ({
    publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? "", process.env.CLERK_PUBLISHABLE_KEY),
  })));
}
app.use("/api/matrixify/preview", requireMappingReviewer, express.json({ limit: "42mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", (req, res, next) => {
  // The deployment startup probe must not wait for database backfills.
  if (req.path === "/healthz" || inventoryStartup.isReady()) {
    next();
    return;
  }
  res.setHeader("Retry-After", "15");
  res.status(503).json({
    code: "INVENTORY_INITIALIZING",
    error: "Inventory is initializing. Please retry shortly.",
  });
});
app.use("/api", router);

export default app;
