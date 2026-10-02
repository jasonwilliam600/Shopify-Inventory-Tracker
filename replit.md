# Inventory Tracker

Tracks Shopify-facing inventory against wholesaler availability updates, preserving supplier rows and highlighting mismatches that need review.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/inventory-tracker/` — React inventory dashboard and supplier import experience
- `artifacts/api-server/src/routes/inventory.ts` — inventory, dashboard, supplier import, and activity API handlers
- `lib/api-spec/openapi.yaml` — API source of truth
- `lib/db/src/schema/inventory.ts` — inventory, supplier, and activity persistence

## Architecture decisions

- Shopify remains the product and store inventory source of truth once connected.
- Supplier imports retain unmatched SKUs as pending records instead of dropping them.
- The original supplier fields are preserved alongside mapped SKU, quantity, availability, price, ETA, and notes.
- Shopify webhooks are not available through the connector, so store sync should remain user-driven.

## Product

- Dashboard for inventory health, urgent mismatches, and recent update activity
- Searchable inventory comparison between Shopify and supplier availability
- Flexible wholesaler CSV import with column mapping, quoted-field parsing, row accounting, and unmatched SKU retention
- Supplier history with availability counts and last update timestamps
- Protected HobbyTyme refresh that selects the newest export, imports unique SKUs, and runs every six hours

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Re-run `pnpm --filter @workspace/api-spec run codegen` after every OpenAPI change.
- Do not ask for Shopify credentials; use the Replit Shopify Store integration when the user is ready to connect.
- HobbyTyme credentials belong only in `HOBBYTYME_USERNAME` and `HOBBYTYME_PASSWORD` Secrets; never surface them in logs or browser code.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
