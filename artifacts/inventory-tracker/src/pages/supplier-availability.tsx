import { useEffect, useMemo, useState } from "react"
import {
  getListSupplierAvailabilityQueryKey,
  useListSupplierAvailability,
} from "@workspace/api-client-react"
import type {
  ListSupplierAvailabilityParams,
  SupplierAvailabilityOffer,
  SupplierAvailabilityVariant,
} from "@workspace/api-client-react"
import { AlertTriangle, ChevronLeft, ChevronRight, Clock3, RefreshCw, Search, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import "./supplier-availability.css"

const issueFilters = [
  { value: "all", label: "All variants" },
  { value: "duplicate", label: "Duplicate SKU" },
  { value: "missing", label: "Missing SKU" },
] as const

function formatDate(value: string | null | undefined) {
  if (!value) return "Date not available"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Date not available"
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

function mappingLabel(status: SupplierAvailabilityOffer["mappingStatus"]) {
  if (status === "candidate") return "Candidate · unverified"
  if (status === "held") return "Held"
  if (status === "rejected") return "Rejected"
  return "Collision"
}

function quantityLabel(offer: SupplierAvailabilityOffer) {
  if (offer.quantityKind === "unknown" || !offer.quantityText) return "Quantity unknown"
  if (offer.freshness === "stale") return `Last reported: ${offer.quantityText}`
  if (offer.quantityKind === "lower_bound") return `At least ${offer.quantityText} · source quantity`
  if (offer.quantityKind === "upper_bound") return `Up to ${offer.quantityText} · source quantity`
  return `${offer.quantityText} · source quantity`
}

function OfferRow({ offer }: { offer: SupplierAvailabilityOffer }) {
  const blocked = offer.mappingStatus !== "candidate"
  const availability = offer.availability === "available"
    ? "Reported available"
    : offer.availability === "out_of_stock"
      ? "Reported out of stock"
      : "Availability unknown"

  return (
    <div className={`sa-offer${blocked ? " is-blocked" : ""}`} data-testid={`row-supplier-offer-${offer.sourceSku}`}>
      <div className="sa-offer-top">
        <div className="sa-source">
          <span className="sa-source-label">Source SKU</span>
          <code>{offer.sourceSku || "Not supplied"}</code>
        </div>
        <span className={`sa-status sa-status-${offer.mappingStatus}`}>{mappingLabel(offer.mappingStatus)}</span>
      </div>
      <p className="sa-reason">{offer.mappingReason || "No mapping explanation supplied."}</p>
      <div className="sa-offer-facts">
        <div className="sa-fact">
          <span>Source observation</span>
          <strong>{blocked ? "Excluded from product availability" : quantityLabel(offer)}</strong>
          {blocked && offer.quantityText && (
            <small>Blocked-source observation: {offer.quantityText} · not product availability</small>
          )}
        </div>
        <div className="sa-fact">
          <span>Feed import</span>
          <strong>{formatDate(offer.lastFeedImport)}</strong>
        </div>
        <div className="sa-fact">
          <span>Feed freshness</span>
          <strong className={`sa-freshness sa-freshness-${offer.freshness}`}>
            {offer.freshness === "fresh" ? "Within feed window" : offer.freshness === "stale" ? "Stale · last report only" : "Unknown"}
          </strong>
          {offer.freshnessLimitMinutes > 0 && <small>Window: {offer.freshnessLimitMinutes} minutes</small>}
        </div>
        {!blocked && (
          <div className="sa-fact">
            <span>Supplier indication</span>
            <strong>{offer.freshness === "stale" ? "Historical report, not current availability" : availability}</strong>
            {offer.stockReason && <small>{offer.stockReason}</small>}
          </div>
        )}
      </div>
    </div>
  )
}

function VariantCard({ variant }: { variant: SupplierAvailabilityVariant }) {
  const options = variant.options.filter(Boolean)
  return (
    <article className="sa-variant" data-testid={`card-availability-variant-${variant.key}`}>
      <header className="sa-variant-head">
        <div className="sa-product">
          <span className="sa-product-eyebrow">Historical variant record</span>
          <h3>{variant.title || variant.handle || "Untitled variant"}</h3>
          <div className="sa-product-meta">
            <code>{variant.sku || "No SKU on record"}</code>
            {variant.handle && <span>{variant.handle}</span>}
            {options.length > 0 && <span>{options.join(" · ")}</span>}
          </div>
        </div>
        <span className={`sa-sku-state sa-sku-${variant.skuStatus}`}>
          {variant.skuStatus === "unique" ? "Unique SKU" : variant.skuStatus === "duplicate" ? "Duplicate SKU" : "Missing SKU"}
        </span>
      </header>

      <div className="sa-suppliers">
        {variant.suppliers.length === 0 ? (
          <div className="sa-no-match">
            <span className="sa-no-match-mark" aria-hidden="true">—</span>
            <div><strong>No supplier match</strong><span>Unknown · no matching source record. This is not a zero-stock result.</span></div>
          </div>
        ) : variant.suppliers.map((supplier, supplierIndex) => (
          <section className="sa-supplier" key={`${supplier.supplier}-${supplierIndex}`}>
            <div className="sa-supplier-name">{supplier.supplier}</div>
            {supplier.offers.length === 0
              ? <div className="sa-no-match sa-no-match-inline"><div><strong>No matching offer</strong><span>Unknown · no supplier quantity is inferred.</span></div></div>
              : supplier.offers.map((offer, offerIndex) => <OfferRow key={`${offer.sourceSku}-${offerIndex}`} offer={offer} />)}
          </section>
        ))}
      </div>
    </article>
  )
}

function SkeletonList() {
  return <div className="sa-skeleton-list" aria-label="Loading supplier availability" aria-busy="true">
    {[0, 1, 2].map((item) => <div className="sa-skeleton-card" key={item}>
      <span /><span /><span /><span />
    </div>)}
  </div>
}

export default function SupplierAvailability() {
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [issue, setIssue] = useState<"all" | "duplicate" | "missing">("all")
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, issue])

  const params: ListSupplierAvailabilityParams = useMemo(() => ({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    issue,
    page,
    pageSize: 10,
  }), [debouncedSearch, issue, page])

  const query = useListSupplierAvailability(params, {
    query: {
      queryKey: getListSupplierAvailabilityQueryKey(params),
      staleTime: 30000,
      refetchInterval: 60000,
    },
  })
  const pageData = query.data
  const waitingForSearch = search.trim() !== debouncedSearch
  const showingCurrentRequest = !waitingForSearch && !query.isPlaceholderData
  const visiblePage = showingCurrentRequest ? pageData : undefined
  const catalog = visiblePage?.catalog
  const firstResult = visiblePage && visiblePage.total > 0 ? (visiblePage.page - 1) * visiblePage.pageSize + 1 : 0
  const lastResult = visiblePage ? Math.min(visiblePage.page * visiblePage.pageSize, visiblePage.total) : 0
  const isUnavailable = catalog?.source === "unavailable"

  return (
    <section className="supplier-availability" aria-labelledby="sa-title">
      <div className="sa-page-heading">
        <div>
          <p className="sa-kicker">Inventory <span>/</span> Supplier visibility</p>
          <h1 id="sa-title">Supplier availability</h1>
          <p className="sa-subtitle">Source-level observations, kept separate from store inventory.</p>
        </div>
        <Button
          variant="outline"
          className="sa-refresh"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          data-testid="button-refresh-supplier-availability"
        >
          <RefreshCw size={15} className={query.isFetching ? "sa-spin" : ""} aria-hidden="true" />
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className={`sa-history-banner${catalog?.source === "unavailable" ? " is-unavailable" : ""}`} role="note" data-testid="status-historical-catalog">
        <span className="sa-banner-icon"><ShieldAlert size={18} aria-hidden="true" /></span>
        <div>
          <strong>{catalog?.source === "unavailable" ? "Historical catalog unavailable — no current Shopify verification" : "Historical October 5 export — not a current Shopify verification"}</strong>
          <p>This catalog has no live variant IDs. Supplier mappings are candidates or blocked records; none are trusted or verified. Source quantities are shown as supplied: HobbyTyme quantities are individual pieces with no pack conversion; other suppliers’ selling units are not yet verified. No Shopify inventory is shown or changed here.</p>
        </div>
      </div>

      {catalog && (
        <div className="sa-catalog-strip" data-testid="text-catalog-metadata">
          <div><strong>{catalog.totalVariants.toLocaleString()}</strong><span>Historical variants</span></div>
          <div><strong>{catalog.duplicateSkuGroups.toLocaleString()}</strong><span>Duplicate SKU groups</span></div>
          <div><strong>{catalog.missingSkuVariants.toLocaleString()}</strong><span>Variants missing SKU</span></div>
          <div><strong>{catalog.rejectedMappings.toLocaleString()}</strong><span>Rejected mappings</span></div>
          <div><strong>{catalog.flaggedCandidates.toLocaleString()}</strong><span>Flagged candidates</span></div>
          <div><strong>{catalog.uniqueHeldSources.toLocaleString()}</strong><span>Held source SKUs</span></div>
          <div className="sa-catalog-trust"><strong>{catalog.verified ? "Verified" : "Unverified"}</strong><span>{catalog.containsVariantIds ? "Live variant IDs present" : "No live variant IDs"}</span></div>
          <div className="sa-catalog-trust"><strong>{catalog.physicalStockExists ? "Physical stock exists" : "No physical store stock"}</strong><span>Store stock model · not a Shopify quantity</span></div>
          <div className="sa-catalog-observed"><Clock3 size={13} aria-hidden="true" /> Observed {formatDate(catalog.observedAt)}</div>
        </div>
      )}

      {catalog && (
        <div className="sa-blocker" data-testid="text-availability-blocker">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{catalog.blocker || "Publishing is disabled. Historical source observations are for review only."}</span>
          <span className="sa-publish-state">{catalog.publishingEnabled ? "Catalog flag: enabled" : "Publishing disabled"}</span>
        </div>
      )}

      <div className="sa-toolbar">
        <label className="sa-search">
          <Search size={16} aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product, variant or SKU"
            aria-label="Search product, variant or SKU"
            data-testid="input-supplier-availability-search"
          />
        </label>
        <div className="sa-filter-group" role="group" aria-label="Filter SKU issues">
          {issueFilters.map((filter) => (
            <button
              type="button"
              className={`sa-filter${issue === filter.value ? " is-active" : ""}`}
              key={filter.value}
              onClick={() => setIssue(filter.value)}
              aria-pressed={issue === filter.value}
              data-testid={`filter-supplier-availability-${filter.value}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {query.isError ? (
        <div className="sa-state sa-error" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <div><strong>Supplier availability could not be loaded</strong><span>The read-only catalog request failed. No import or refresh was started.</span></div>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} data-testid="button-retry-availability">Try again</Button>
        </div>
      ) : query.isLoading || waitingForSearch || (query.isFetching && !visiblePage) ? (
        <SkeletonList />
      ) : isUnavailable ? (
        <div className="sa-state sa-empty" role="status" data-testid="status-availability-unavailable">
          <span className="sa-empty-mark">—</span>
          <div><strong>Historical catalog unavailable</strong><span>{catalog?.blocker || "No historical catalog is available for review."}</span></div>
        </div>
      ) : visiblePage?.items.length ? (
        <div className="sa-results" aria-live="polite">
          <div className="sa-results-top">
            <span>{visiblePage.total.toLocaleString()} variants</span>
            <span>Supplier observations only · quantities are never combined</span>
          </div>
          {visiblePage.items.map((variant) => <VariantCard key={variant.key} variant={variant} />)}
        </div>
      ) : (
        <div className="sa-state sa-empty" role="status" data-testid="status-availability-empty">
          <span className="sa-empty-mark"><Search size={18} aria-hidden="true" /></span>
          <div><strong>{debouncedSearch || issue !== "all" ? "No matching variants" : "No historical variants to show"}</strong><span>Try another search or clear the issue filter. An absent match is unknown, not zero.</span></div>
        </div>
      )}

      {visiblePage && !isUnavailable && (
        <div className="sa-pagination">
          <span>{firstResult.toLocaleString()}–{lastResult.toLocaleString()} of {visiblePage.total.toLocaleString()} variants</span>
          <div>
            <span>Page {visiblePage.page} of {Math.max(visiblePage.totalPages, 1)}</span>
            <Button
              variant="outline" size="icon"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={query.isFetching || visiblePage.page <= 1}
              aria-label="Previous page" data-testid="button-availability-previous"
            ><ChevronLeft size={16} /></Button>
            <Button
              variant="outline" size="icon"
              onClick={() => setPage((current) => current + 1)}
              disabled={query.isFetching || visiblePage.page >= visiblePage.totalPages}
              aria-label="Next page" data-testid="button-availability-next"
            ><ChevronRight size={16} /></Button>
          </div>
        </div>
      )}
    </section>
  )
}
