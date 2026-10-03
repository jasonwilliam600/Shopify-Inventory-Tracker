import { useState } from "react"
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Gauge,
  RefreshCw,
  Store,
} from "lucide-react"
import { useGetDashboard } from "../dashboard-refresh/_data"
import "./velocity.css"

export default function Velocity() {
  const { data: dashboard, isLoading } = useGetDashboard()
  const [showDetails, setShowDetails] = useState(false)

  if (isLoading) {
    return (
      <main className="velocity-page">
        <div className="velocity-shell">
          <div className="velocity-skeleton" />
          <div className="velocity-skeleton velocity-skeleton-large" />
          <div className="velocity-skeleton velocity-skeleton-card" />
        </div>
      </main>
    )
  }

  if (!dashboard) {
    return (
      <main className="velocity-page">
        <div className="velocity-shell">
          <div className="velocity-alert"><AlertCircle size={18} /> Inventory overview could not be loaded. Refresh to try again.</div>
        </div>
      </main>
    )
  }

  const connected = dashboard.shopifyConnected

  return (
    <main className="velocity-page">
      <div className="velocity-shell">
        <div className="velocity-masthead">
          <div className="velocity-brand">
            <div className="velocity-mark" aria-hidden="true"><Gauge size={21} strokeWidth={2.2} /></div>
            <div>
              <span className="velocity-brand-name">TOP SPEED <b>HOBBIES</b></span>
              <span className="velocity-brand-caption">THE INVENTORY PIT WALL</span>
            </div>
          </div>
          <div className="velocity-preview"><span /> DESIGN PREVIEW <i>·</i> SAMPLE DATA</div>
        </div>

        <div className="velocity-rule" />

        <header className="velocity-heading">
          <div>
            <div className="velocity-kicker"><span>01</span> / STORE TELEMETRY</div>
            <h1>Catalog <em>status</em></h1>
            <p>One clear read on the Shopify catalog. No supplier totals in this lane.</p>
          </div>
          <div className={`velocity-connection ${connected ? "is-connected" : ""}`}>
            <span className="velocity-connection-icon"><Store size={17} /></span>
            <span className="velocity-connection-copy">
              <small>SHOPIFY CONNECTION</small>
              <b><i />{connected ? dashboard.shopifyStoreName || "Connected" : "Disconnected"}</b>
            </span>
            <ChevronDown size={15} className="velocity-chevron" />
          </div>
        </header>

        <section className="velocity-main-panel" aria-labelledby="velocity-count-title">
          <div className="velocity-panel-top">
            <span className="velocity-panel-label"><span className="velocity-stripe" /> STORE CATALOG / LIVE COUNT</span>
            <span className="velocity-flag"><AlertCircle size={13} /> AWAITING CONNECTION</span>
          </div>
          <div className="velocity-panel-body">
            <div className="velocity-number-group">
              <p className="velocity-store-name">TOP SPEED HOBBIES <span>SHOPIFY</span></p>
              <h2 id="velocity-count-title">Total SKUs</h2>
              <div className="velocity-number-line">
                <strong aria-label="Store SKU count unavailable">— — —</strong>
                <span>NOT AVAILABLE<br />YET</span>
              </div>
              <p className="velocity-explainer">
                Connect the store to read the number of products and variants in its Shopify catalog.
              </p>
              <button className="velocity-details-button" type="button" onClick={() => setShowDetails((visible) => !visible)} aria-expanded={showDetails}>
                <CircleHelp size={15} /> Why is this blank? <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="velocity-instrument" aria-hidden="true">
              <div className="velocity-radar velocity-radar-outer" />
              <div className="velocity-radar velocity-radar-inner" />
              <div className="velocity-dial">
                <div className="velocity-dial-arc" />
                <span className="velocity-dial-center"><Gauge size={42} strokeWidth={1.2} /></span>
                <span className="velocity-dial-tick tick-a" />
                <span className="velocity-dial-tick tick-b" />
                <span className="velocity-dial-tick tick-c" />
                <span className="velocity-dial-tick tick-d" />
                <span className="velocity-dial-needle" />
              </div>
              <span className="velocity-dial-label">CATALOG<br />SIGNAL</span>
              <span className="velocity-cross velocity-cross-a" />
              <span className="velocity-cross velocity-cross-b" />
            </div>
          </div>
          {showDetails && (
            <div className="velocity-details">
              <span><Check size={15} /> Shopify is currently disconnected.</span>
              <p>This metric will show only after the store catalog can be read. Supplier inventory and historical tracker records stay separate and are not used to estimate this count.</p>
            </div>
          )}
          <div className="velocity-panel-foot">
            <div className="velocity-foot-label"><RefreshCw size={14} /> DATA SOURCE</div>
            <p>Shopify catalog only <span>/</span> supplier inventory excluded</p>
            <span className="velocity-not-ready"><i /> NOT SYNCED</span>
          </div>
        </section>

        <footer className="velocity-footer">
          <div className="velocity-check"><Check size={13} /></div>
          <p><b>Count integrity:</b> only a number read from the Shopify catalog appears here. No inferred or supplier-based totals.</p>
          <span>TSH <i>—</i> INVENTORY / 01</span>
        </footer>
      </div>
    </main>
  )
}