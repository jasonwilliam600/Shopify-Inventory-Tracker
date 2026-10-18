import {
  useGetDashboard,
  useListSuppliers,
  useListSkuMappingRows,
  getGetDashboardQueryKey,
  getListSuppliersQueryKey,
  getListSkuMappingRowsQueryKey,
  type ListSkuMappingRowsStatus,
} from "@workspace/api-client-react"
import "./store-dashboard.css"
import { Card } from "@/components/ui/card"
import { SupplierCatalogBox } from "@/components/supplier-catalog-box"
import { Link } from "wouter"
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  Box,
  CircleHelp,
  GitBranch,
  PackageCheck,
  PackageMinus,
  PackageSearch,
  RefreshCw,
  Store,
  Truck,
} from "lucide-react"

function DashboardSkeleton() {
  return (
    <section className="refined-dashboard">
      <div className="rd-shell" aria-label="Loading inventory dashboard" aria-busy="true">
        <div className="rd-topline">
          <span className="rd-skeleton" style={{ width: 164 }} />
          <span className="rd-skeleton" style={{ width: 140 }} />
        </div>
        <div className="rd-heading">
          <span className="rd-skeleton" style={{ width: 340, height: 35 }} />
        </div>
        <div className="rd-network-grid">
          {[1, 2, 3].map((item) => <span className="rd-skeleton rd-dashboard-skeleton-card" key={`source-${item}`} />)}
        </div>
        <div className="rd-store-grid">
          {[1, 2, 3, 4].map((item) => <span className="rd-skeleton rd-dashboard-skeleton-stock" key={`store-${item}`} />)}
        </div>
        <span className="rd-skeleton rd-skeleton-wide" />
      </div>
    </section>
  )
}

function NavigationCard({ href, title, value, description, icon: Icon, variant = "neutral", unavailable = false }: {
  href: string
  title: string
  value: string
  description: string
  icon: typeof Box
  variant?: "blue" | "green" | "amber" | "neutral" | "stock" | "stock-ready" | "stock-empty" | "stock-low"
  unavailable?: boolean
}) {
  return (
    <Link href={href} className={`rd-summary-link rd-summary-${variant}${unavailable && variant !== "stock" ? " rd-summary-stock" : ""}`} aria-label={`${title}: ${unavailable ? "Unavailable" : value}. ${description}`}>
      <Card className={`rd-panel rd-summary-card${unavailable ? " is-unavailable" : ""}`}>
        <div className="rd-summary-heading">
          <span className="rd-summary-icon"><Icon size={18} aria-hidden="true" /></span>
          <span className="rd-summary-label">{title}</span>
          <ArrowRight className="rd-summary-arrow" size={16} aria-hidden="true" />
        </div>
        <strong className="rd-summary-value">{value}</strong>
        <span className="rd-summary-description">{description}</span>
        {unavailable && <span className="rd-unavailable-tag">Unavailable</span>}
      </Card>
    </Link>
  )
}

export default function StoreDashboard() {
  const { data: dashboard, isLoading: dashLoading } = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey(), staleTime: 30000, refetchInterval: 60000 } })
  const supplierQuery = useListSuppliers({ query: { queryKey: getListSuppliersQueryKey(), staleTime: 30000, refetchInterval: 60000 } })
  const suppliers = supplierQuery.data ?? []
  const mappingParams = { status: "all" as ListSkuMappingRowsStatus, page: 1, pageSize: 1 }
  const mappingQuery = useListSkuMappingRows(mappingParams, {
    query: { queryKey: getListSkuMappingRowsQueryKey(mappingParams), staleTime: 30_000, refetchInterval: 60_000 },
  })
  const supplierSkuTotal = supplierQuery.data?.reduce((sum, supplier) => sum + supplier.skuCount, 0)

  if (dashLoading) return <DashboardSkeleton />

  if (!dashboard) {
    return (
      <section className="refined-dashboard">
        <div className="rd-shell">
          <div className="rd-error" role="alert">
            <AlertCircle size={17} aria-hidden="true" />
            <span>Inventory overview could not be loaded. Please refresh to try again.</span>
          </div>
        </div>
      </section>
    )
  }

  const connected = dashboard.shopifyConnected

  return (
    <section className="refined-dashboard">
      <div className="rd-shell">
        <div className="rd-topline">
          <div className="rd-crumb">Inventory <span>/</span> Overview</div>
          <div className="rd-preview-label">
            <span className="rd-preview-mark" aria-hidden="true" />
            Supplier registry <span className="rd-preview-divider">·</span> {supplierQuery.isFetching ? "Updating…" : "Refreshes every minute"}
          </div>
        </div>

        <header className="rd-heading">
          <div>
            <p className="rd-eyebrow">Welcome back</p>
            <h1 className="rd-title">TSH Inventory <span>Sync</span></h1>
            <p className="rd-subtitle">Manage supplier inventory, map SKUs, and prepare Shopify updates for review.</p>
          </div>
          <div className={`rd-shopify-chip${connected ? " is-connected" : ""}`} data-testid="status-shopify">
            <span className="rd-shopify-icon"><Store size={17} aria-hidden="true" /></span>
            <span className="rd-shopify-copy">
              <span className="rd-shopify-name">Shopify</span>
              <span className="rd-shopify-state">
                <span className="rd-status-indicator" aria-hidden="true" />
                {connected ? "Connected" : "Disconnected"}
              </span>
            </span>
          </div>
          <Link href="/inventory" className="rd-inventory-link" data-testid="link-supplier-availability">
            View supplier availability <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </header>

        <section className="rd-overview-section rd-network-section" aria-labelledby="rd-network-heading">
          <div className="rd-section-intro rd-network-intro">
            <div>
              <p className="rd-section-kicker">Supplier network</p>
              <h2 className="rd-section-title" id="rd-network-heading">Source inventory</h2>
            </div>
            <span className="rd-data-boundary"><Truck size={14} aria-hidden="true" /> Supplier data only</span>
          </div>
          <div className="rd-network-grid">
            <NavigationCard
              href="/inventory?source=supplier-records"
              title="Supplier SKUs"
              value={supplierSkuTotal === undefined || supplierQuery.isError ? "—" : supplierSkuTotal.toLocaleString()}
              description={supplierQuery.isPending ? "Loading supplier records" : supplierQuery.isError ? "Supplier total unavailable" : "Imported supplier SKU records"}
              icon={Box}
              variant="blue"
            />
            <NavigationCard
              href="/sku-mappings?status=candidate"
              title="Mapping Candidates"
              value={mappingQuery.data?.counts?.candidate?.toLocaleString() ?? "—"}
              description={mappingQuery.isError && !mappingQuery.data ? "Candidate count unavailable" : "Current candidate relationships"}
              icon={GitBranch}
              variant="green"
            />
            <NavigationCard
              href="/sku-mappings?status=flagged"
              title="Needs Review"
              value={mappingQuery.data?.counts?.flagged?.toLocaleString() ?? "—"}
              description={mappingQuery.isError && !mappingQuery.data ? "Flagged count unavailable" : "Flagged source relationships"}
              icon={AlertTriangle}
              variant="amber"
            />
          </div>
        </section>

        <section className="rd-overview-section rd-store-section" aria-labelledby="rd-store-heading">
          <div className="rd-section-intro">
            <div>
              <p className="rd-section-kicker">Shopify store inventory</p>
              <h2 className="rd-section-title" id="rd-store-heading">Top Speed Hobbies</h2>
            </div>
            <span className="rd-data-boundary"><Store size={14} aria-hidden="true" /> Store catalog only</span>
          </div>
          <div className="rd-store-grid">
            <NavigationCard href="/inventory?source=shopify-store&view=total" title="Total Store SKUs" value="—" description="Open store SKU view" icon={Box} variant="stock" unavailable />
            <NavigationCard href="/inventory?source=shopify-store&view=in-stock" title="In-Stock SKUs" value="—" description="Open in-stock view" icon={PackageCheck} variant="stock-ready" unavailable />
            <NavigationCard href="/inventory?source=shopify-store&view=out-of-stock" title="Out-of-Stock SKUs" value="—" description="Open out-of-stock view" icon={PackageMinus} variant="stock-empty" unavailable />
            <NavigationCard href="/inventory?source=shopify-store&view=low-stock" title="Low-Stock SKUs" value="—" description="Open low-stock view" icon={ArrowDownToLine} variant="stock-low" unavailable />
          </div>
        </section>

        <Card className="rd-panel rd-supplier-card rd-supplier-status-section">
          <div className="rd-supplier-header">
            <div className="rd-card-heading">
              <span className="rd-card-icon"><Truck size={17} aria-hidden="true" /></span>
              <div>
                <p className="rd-section-kicker">Supplier registry</p>
                <h2 className="rd-card-title">Supplier status</h2>
              </div>
            </div>
            <Link href="/suppliers" className="rd-registry-link" data-testid="link-dashboard-suppliers">Supplier controls <ArrowRight size={13} aria-hidden="true" /></Link>
          </div>
          <div className="rd-supplier-table-wrap">
            {supplierQuery.isPending && <div className="rd-supplier-message" role="status">Loading supplier registry…</div>}
            {supplierQuery.isError && <div className="rd-supplier-message" role="alert"><span>Unable to load supplier records.</span><button type="button" onClick={() => void supplierQuery.refetch()}>Retry</button></div>}
            {!supplierQuery.isPending && !supplierQuery.isError && suppliers.length === 0 && <div className="rd-supplier-message">No suppliers registered yet.</div>}
            {!supplierQuery.isPending && !supplierQuery.isError && suppliers.length > 0 && (
              <table className="rd-supplier-table" aria-label="Supplier status" data-testid="table-dashboard-suppliers">
                <thead><tr><th scope="col">Supplier</th><th scope="col">Supplier SKUs</th><th scope="col" title="Stored supplier timestamp; not independent confirmation of refresh success.">Last import record</th><th scope="col">Import status</th><th scope="col" className="rd-supplier-actions-heading">Actions</th></tr></thead>
                <tbody>
                  {suppliers.map((supplier) => {
                    const importedAt = supplier.lastUpdate ? new Date(supplier.lastUpdate) : null
                    const hasImport = importedAt !== null && !Number.isNaN(importedAt.getTime())
                    const slug = supplier.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
                    return (
                      <tr key={supplier.name} data-testid={`row-dashboard-supplier-${slug}`}>
                        <td data-label="Supplier"><strong>{supplier.name}</strong></td>
                        <td data-label="Supplier SKUs" className="rd-supplier-sku-count">{supplier.skuCount.toLocaleString()}</td>
                        <td data-label="Last import record">{hasImport ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(importedAt!) : "No import recorded"}</td>
                        <td data-label="Import status"><span className={`rd-import-status${hasImport ? " is-recorded" : ""}`}>{hasImport ? "Import recorded" : "No import record"} <span>· Connection unverified</span></span></td>
                        <td data-label="Actions"><Link href={`/suppliers#supplier-${slug}`} className="rd-view-details" data-testid={`link-view-supplier-${slug}`}>View details <ArrowRight size={13} aria-hidden="true" /></Link></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="rd-supplier-foot">
            <span><AlertCircle size={14} aria-hidden="true" /> Import timestamps are recorded metadata, not independent proof of a successful refresh or live connection.</span>
          </div>
        </Card>

        <div className={`rd-connection-notice${connected ? " is-connected" : ""}`} data-testid="status-shopify-details">
          <Store size={16} aria-hidden="true" />
          <strong>Shopify store data {connected ? "connected" : "unavailable"}</strong>
          <span>{connected ? "Verified store counts are not available yet" : "Store data is not available"}</span>
          <span className="rd-connection-sync"><RefreshCw size={13} aria-hidden="true" /> Last Shopify sync: {connected ? "Not available" : "Not synced"}</span>
          <span className="rd-review-inline"><PackageSearch size={13} aria-hidden="true" /> Store SKUs needing review: — · unavailable</span>
        </div>

        <SupplierCatalogBox />

        <details className="rd-explanation">
          <summary><CircleHelp size={15} aria-hidden="true" /> About these counts</summary>
          <div className="rd-explanation-content">
            <p>Store-only counts are unavailable until verified Shopify catalog data is provided. Supplier totals and historical tracker records are never substituted for your store’s SKU count.</p>
            <p>Supplier names and import dates are read from the live registry and refreshed every minute. An import date is historical information, not a current connection-health check. Connection status stays unverified until a real check is available.</p>
          </div>
        </details>
        <footer className="rd-footer-note">
          <span className="rd-footer-mark"><CircleHelp size={14} aria-hidden="true" /></span>
          <span>Store totals stay separate from supplier and historical inventory records.</span>
          <span className="rd-footer-status">No verified store counts available</span>
        </footer>
      </div>
    </section>
  )
}