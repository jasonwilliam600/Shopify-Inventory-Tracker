import { useGetDashboard, useListSuppliers, getGetDashboardQueryKey, getListSuppliersQueryKey } from "@workspace/api-client-react"
import "./store-dashboard.css"
import { Card } from "@/components/ui/card"
import { SupplierCatalogBox } from "@/components/supplier-catalog-box"
import {
  AlertCircle,
  ArrowDownToLine,
  Box,
  CircleHelp,
  CircleOff,
  Clock3,
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
        <div className="rd-metric-grid">
          {[1, 2, 3, 4].map((item) => <span className="rd-skeleton rd-skeleton-card" key={item} />)}
        </div>
        <span className="rd-skeleton rd-skeleton-wide" />
      </div>
    </section>
  )
}

function MetricCard({ title, description, icon: Icon, featured = false }: {
  title: string
  description: string
  icon: typeof Box
  featured?: boolean
}) {
  return (
    <Card className={`rd-panel rd-metric-card${featured ? " is-featured" : ""}`}>
      <div className="rd-metric-heading">
        <span>{title}</span>
        <span className="rd-metric-icon"><Icon size={17} aria-hidden="true" /></span>
      </div>
      <p className="rd-metric-value" aria-label={`${title} unavailable`}>—</p>
      <p className="rd-metric-description">{description}</p>
      <span className="rd-unavailable-tag">Unavailable</span>
    </Card>
  )
}

export default function StoreDashboard() {
  const { data: dashboard, isLoading: dashLoading } = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey(), staleTime: 30000, refetchInterval: 60000 } })
  const supplierQuery = useListSuppliers({ query: { queryKey: getListSuppliersQueryKey(), staleTime: 30000, refetchInterval: 60000 } })
  const suppliers = (supplierQuery.data ?? []).map((supplier) => {
    const importedAt = supplier.lastUpdate ? new Date(supplier.lastUpdate) : null
    const hasImport = importedAt !== null && !Number.isNaN(importedAt.getTime())
    return {
      name: supplier.name, kind: "Import record", status: hasImport ? "imported" : "unknown",
      state: "Connection not verified",
      detail: hasImport ? "Last import recorded" : "No import date available",
      date: hasImport ? `Last import · ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(importedAt!)}` : "Last import unknown",
    }
  })

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
            <p className="rd-eyebrow">Top Speed Hobbies <span> / </span> Operations</p>
            <h1 className="rd-title">Inventory overview</h1>
            <p className="rd-subtitle">A clear view of store inventory and supplier records.</p>
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
        </header>

        <section className="rd-overview-section" aria-labelledby="rd-store-heading">
          <div className="rd-section-intro">
            <div>
              <p className="rd-section-kicker">Store inventory</p>
              <h2 className="rd-section-title" id="rd-store-heading">Top Speed Hobbies</h2>
            </div>
            <span className="rd-data-boundary"><Store size={14} aria-hidden="true" /> Shopify catalog only</span>
          </div>
          <div className="rd-metric-grid">
            <MetricCard title="Total SKUs" description="SKUs in the store catalog." icon={Box} featured />
            <MetricCard title="In-stock SKUs" description="Store items currently available." icon={PackageCheck} />
            <MetricCard title="Out-of-stock SKUs" description="Store items currently unavailable." icon={PackageMinus} />
            <MetricCard title="Low-stock SKUs" description="Store items flagged as low stock." icon={ArrowDownToLine} />
          </div>
          <div className="rd-review-strip">
            <span className="rd-review-icon"><PackageSearch size={17} aria-hidden="true" /></span>
            <span className="rd-review-copy">
              <strong>Store SKUs needing review</strong>
              <small>Review count is unavailable until store inventory is connected and read.</small>
            </span>
            <span className="rd-review-value" aria-label="Store SKUs needing review unavailable">—</span>
          </div>
        </section>

        <SupplierCatalogBox />

        <div className="rd-lower-grid">
          <Card className="rd-panel rd-connection-card">
            <div className="rd-card-heading">
              <span className="rd-card-icon rd-card-icon-alert"><Store size={17} aria-hidden="true" /></span>
              <div>
                <p className="rd-section-kicker">Store connection</p>
                <h2 className="rd-card-title">Shopify</h2>
              </div>
            </div>
            <div className="rd-connection-state">
              <span className="rd-state-mark"><CircleOff size={17} aria-hidden="true" /></span>
              <div>
                <strong>{connected ? "Connected" : "Disconnected"}</strong>
                <span>{connected ? "Verified store counts are not available yet" : "Store data is not available"}</span>
              </div>
            </div>
            <div className="rd-sync-row">
              <span className="rd-sync-label"><RefreshCw size={14} aria-hidden="true" /> Last Shopify sync</span>
              <strong>{connected ? "Not available" : "Not synced"}</strong>
            </div>
            <p className="rd-card-note">Supplier import dates are shown separately and do not represent a Shopify sync.</p>
          </Card>

          <Card className="rd-panel rd-supplier-card">
            <div className="rd-supplier-header">
              <div className="rd-card-heading">
                <span className="rd-card-icon"><Truck size={17} aria-hidden="true" /></span>
                <div>
                  <p className="rd-section-kicker">Supplier registry</p>
                  <h2 className="rd-card-title">Supplier connections</h2>
                </div>
              </div>
              <span className="rd-record-count">{supplierQuery.isPending || supplierQuery.isError ? "—" : `${suppliers.length} records`}</span>
            </div>
            <div className="rd-supplier-list">
              {supplierQuery.isPending && <p className="rd-supplier-message" role="status">Loading suppliers…</p>}
              {supplierQuery.isError && <div className="rd-supplier-message" role="alert"><p>Unable to refresh supplier records.</p><button type="button" onClick={() => void supplierQuery.refetch()}>Retry</button></div>}
              {!supplierQuery.isPending && !supplierQuery.isError && suppliers.length === 0 && <p className="rd-supplier-message">No suppliers registered yet.</p>}
              {suppliers.map((supplier) => (
                <article className="rd-supplier-row" key={supplier.name} data-testid={`card-supplier-${supplier.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                  <span className={`rd-supplier-mark ${supplier.status === "imported" ? "is-imported" : "is-example"}`}>
                    {supplier.status === "imported" ? <PackageCheck size={16} aria-hidden="true" /> : <CircleHelp size={16} aria-hidden="true" />}
                  </span>
                  <div className="rd-supplier-info">
                    <div className="rd-supplier-name-line">
                      <strong>{supplier.name}</strong>
                      <span className={`rd-supplier-kind ${supplier.status === "unknown" ? "is-example" : ""}`}>{supplier.kind}</span>
                    </div>
                    <span className="rd-supplier-state">{supplier.state}</span>
                    <span className="rd-supplier-detail">{supplier.detail}</span>
                  </div>
                  <span className="rd-supplier-date"><Clock3 size={12} aria-hidden="true" />{supplier.date}</span>
                </article>
              ))}
            </div>
            <div className="rd-supplier-foot">
              <span><AlertCircle size={14} aria-hidden="true" /> Import history is not a current connection-health check.</span>
            </div>
          </Card>
        </div>

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