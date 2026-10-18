import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react"
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  PackageSearch,
  RefreshCw,
  Search,
  X,
} from "lucide-react"
import {
  getListInventoryQueryKey,
  getListSuppliersQueryKey,
  useListInventory,
  useListSuppliers,
} from "@workspace/api-client-react"
import "./supplier-catalog-box.css"
import { getSkuManufacturer } from "@/lib/sku-manufacturer"

const PAGE_SIZE = 20

export function SupplierCatalogBox() {
  const [search, setSearch] = useState("")
  const [supplier, setSupplier] = useState("")
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState("1")
  const [copyFeedback, setCopyFeedback] = useState<{ sku: string; message: string; success: boolean } | null>(null)
  const deferredSearch = useDeferredValue(search.trim())
  const rowsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setPage(1)
    setPageInput("1")
  }, [search, supplier])

  const params = useMemo(() => ({
    source: "supplier" as const,
    ...(deferredSearch ? { search: deferredSearch } : {}),
    ...(supplier ? { supplier } : {}),
    page,
    pageSize: PAGE_SIZE,
  }), [deferredSearch, supplier, page])

  const inventoryQuery = useListInventory(params, {
    query: {
      queryKey: getListInventoryQueryKey(params),
      staleTime: 30000,
      refetchInterval: 60000,
    },
  })
  const suppliersQuery = useListSuppliers({
    query: {
      queryKey: getListSuppliersQueryKey(),
      staleTime: 30000,
      refetchInterval: 60000,
    },
  })

  const items = inventoryQuery.data?.items ?? []
  const total = inventoryQuery.data?.total
  const currentPage = inventoryQuery.data?.page ?? page
  const totalPages = inventoryQuery.data?.totalPages ?? 0
  const pageStart = total && items.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0
  const pageEnd = total ? Math.min((currentPage - 1) * PAGE_SIZE + items.length, total) : 0
  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  useEffect(() => {
    if (rowsRef.current) rowsRef.current.scrollTop = 0
  }, [currentPage, deferredSearch, supplier])

  async function copySku(sku: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable")
      await navigator.clipboard.writeText(sku)
      setCopyFeedback({ sku, message: `SKU ${sku} copied`, success: true })
    } catch {
      setCopyFeedback({ sku, message: `Could not copy SKU ${sku}. Select and copy it directly.`, success: false })
    }
  }

  return (
    <section className="supplier-catalog" aria-labelledby="supplier-catalog-title">
      <header className="sc-heading">
        <div className="sc-heading-copy">
          <p className="sc-kicker">Supplier catalog</p>
          <h2 id="supplier-catalog-title">Supplier SKUs not in your store</h2>
          <p className="sc-subtitle">Imported supplier records, ready to compare against your store.</p>
        </div>
        <div className="sc-counts" aria-label="Comparison counts">
          <div className="sc-count sc-count-unavailable" data-testid="status-verified-missing-unavailable">
            <span className="sc-count-value" aria-label="Verified missing count unavailable">—</span>
            <span className="sc-count-label">Verified missing in store</span>
            <span className="sc-count-caption">Unavailable</span>
          </div>
          <div className="sc-count sc-count-awaiting">
            <span className="sc-count-value" data-testid="count-awaiting-comparison">
              {inventoryQuery.isPending || inventoryQuery.isError ? "—" : total}
            </span>
            <span className="sc-count-label">Supplier records awaiting comparison</span>
            <span className="sc-count-caption">Imported records only</span>
          </div>
        </div>
      </header>

      <div className="sc-warning" role="note" data-testid="notice-store-comparison-unavailable">
        <span className="sc-warning-icon"><AlertTriangle size={18} aria-hidden="true" /></span>
        <div>
          <strong>Store comparison is unavailable</strong>
          <p>A verified store catalog comparison is not available yet. These supplier records are not confirmed missing from your store; each is awaiting comparison.</p>
        </div>
      </div>

      <div className="sc-controls">
        <label className="sc-search">
          <Search size={17} aria-hidden="true" />
          <span className="sc-visually-hidden">Search supplier SKU or product</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search SKU or product"
            aria-label="Search supplier SKU or product"
            data-testid="input-supplier-catalog-search"
          />
          {search && (
            <button
              type="button"
              className="sc-clear"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              data-testid="button-clear-supplier-search"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </label>
        <label className="sc-filter">
          <span className="sc-filter-label">Supplier</span>
          <select
            value={supplier}
            onChange={(event) => setSupplier(event.target.value)}
            aria-label="Filter by supplier"
            data-testid="select-supplier-filter"
          >
            <option value="">All suppliers</option>
            {(suppliersQuery.data ?? []).map((record) => (
              <option key={record.name} value={record.name}>{record.name}</option>
            ))}
          </select>
        </label>
        {inventoryQuery.isFetching && !inventoryQuery.isPending && (
          <span className="sc-refreshing" role="status"><RefreshCw size={13} aria-hidden="true" /> Updating</span>
        )}
      </div>

      {suppliersQuery.isError && (
        <div className="sc-inline-error" role="alert">
          <span>Supplier filters could not be loaded.</span>
          <button type="button" onClick={() => void suppliersQuery.refetch()} data-testid="button-retry-suppliers">Retry</button>
        </div>
      )}

      {inventoryQuery.isPending && (
        <div className="sc-rows" aria-label="Loading supplier records" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="sc-skeleton-row" key={index}>
              <span className="sc-skeleton sc-skeleton-sku" />
              <span className="sc-skeleton sc-skeleton-name" />
              <span className="sc-skeleton sc-skeleton-name" />
              <span className="sc-skeleton sc-skeleton-status" />
            </div>
          ))}
        </div>
      )}

      {inventoryQuery.isError && (
        <div className="sc-state sc-state-error" role="alert">
          <span className="sc-state-icon"><AlertTriangle size={19} aria-hidden="true" /></span>
          <div>
            <strong>{inventoryQuery.data ? "Supplier records could not be refreshed" : "Supplier records could not be loaded"}</strong>
            <p>Try again to retrieve the latest imported catalog records.</p>
          </div>
          <button type="button" className="sc-retry" onClick={() => void inventoryQuery.refetch()} data-testid="button-retry-supplier-records">
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {!inventoryQuery.isPending && !inventoryQuery.isError && items.length === 0 && (
        <div className="sc-state sc-state-empty" data-testid="state-empty-supplier-records">
          <span className="sc-state-icon"><PackageSearch size={20} aria-hidden="true" /></span>
          <div>
            <strong>{deferredSearch || supplier ? "No matching supplier records" : "No imported supplier records yet"}</strong>
            <p>{deferredSearch || supplier ? "Try another search or supplier filter." : "Supplier catalog records will appear here after an import."}</p>
          </div>
          {(deferredSearch || supplier) && (
            <button type="button" className="sc-reset" onClick={() => { setSearch(""); setSupplier("") }} data-testid="button-reset-supplier-filters">
              Clear filters
            </button>
          )}
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="sc-list-head" aria-hidden="true">
            <span>SKU / product</span>
            <span>Manufacturer</span>
            <span>Supplier</span>
            <span>Store match</span>
            <span className="sc-action-heading">Copy</span>
          </div>
          <div className="sc-rows" ref={rowsRef} role="region" tabIndex={0} aria-label="Supplier records">
            {items.map((item) => {
               const manufacturer = getSkuManufacturer(item.sku, item.supplier)
               const displaySku = item.skuMappingConflict ? item.sku : item.mappedStoreSku ?? item.sku
              return (
              <article className="sc-row" key={`${item.supplier ?? "supplier"}-${item.sku}`} data-testid={`row-supplier-sku-${item.sku}`}>
                <div className="sc-item">
                   <code className="sc-sku" title={displaySku} data-testid={`text-supplier-sku-${item.sku}`}>{displaySku}</code>
                   {item.mappedStoreSku && item.mappedStoreSku !== item.sku && (
                     <span className="sc-variant">
                       {item.skuMappingConflict ? `Mapping needs review: ${item.mappedStoreSku}` : `Supplier SKU: ${item.sku} · Store-format candidate`}
                     </span>
                   )}
                  <strong className="sc-product" title={item.productName}>{item.productName || "Product name not provided"}</strong>
                  {item.variant && <span className="sc-variant">{item.variant}</span>}
                </div>
                <div className={`sc-manufacturer-name${manufacturer.name ? "" : " is-unmapped"}`} data-testid={`text-manufacturer-${item.sku}`}>
                  <span className="sc-mobile-label">Manufacturer · </span>
                  {manufacturer.name ?? (manufacturer.prefix ? `Unmapped prefix: ${manufacturer.prefix}` : "Prefix not identified")}
                   {manufacturer.sharedPrefix && <div className="sc-shared-prefix">Shared manufacturer code</div>}
                </div>
                 <div className="sc-supplier-name" data-testid={`text-supplier-name-${item.sku}`}>
                   {item.supplier || "Supplier not recorded"}
                   <div>Stock: {item.supplierStock ?? "Unknown"}</div>
                   <div>Wholesale: {item.supplierPrice === null ? "Unknown" : `$${item.supplierPrice.toFixed(2)}`}</div>
                 </div>
                <div className="sc-row-status">
                  <span className="sc-awaiting-mark" aria-hidden="true" />
                  <span>Awaiting store comparison</span>
                </div>
                <button
                  type="button"
                   className={`sc-copy-button${copyFeedback?.sku === displaySku && copyFeedback.success ? " is-copied" : ""}`}
                   onClick={() => void copySku(displaySku)}
                   aria-label={`Copy SKU ${displaySku}`}
                  data-testid={`button-copy-sku-${item.sku}`}
                >
                   {copyFeedback?.sku === displaySku && copyFeedback.success
                    ? <Check size={15} aria-hidden="true" />
                    : <Clipboard size={15} aria-hidden="true" />}
                   <span>{copyFeedback?.sku === displaySku && copyFeedback.success ? "Copied" : "Copy SKU"}</span>
                </button>
              </article>
              )
            })}
          </div>
          {copyFeedback && (
            <p className={`sc-copy-feedback${copyFeedback.success ? " is-success" : " is-failure"}`} role="status" aria-live="polite">
              {copyFeedback.message}
            </p>
          )}
          <footer className="sc-pagination">
            <span className="sc-page-summary" data-testid="text-supplier-page-summary">
              Showing {pageStart}–{pageEnd} of {total} supplier records
            </span>
            <div className="sc-page-actions">
              <button
                type="button"
                onClick={() => setPage(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1 || inventoryQuery.isFetching}
                aria-label="Previous page"
                data-testid="button-supplier-previous-page"
              >
                <ChevronLeft size={16} aria-hidden="true" /><span>Previous</span>
              </button>
              <form
                className="sc-page-jump"
                onSubmit={(event) => {
                  event.preventDefault()
                  const requestedPage = Number(pageInput)
                  if (inventoryQuery.isFetching || !Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > totalPages) return
                  setPage(requestedPage)
                }}
              >
                <label htmlFor="supplier-catalog-page" className="sc-visually-hidden">Page number</label>
                <input
                  id="supplier-catalog-page"
                  className="sc-page-input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={Math.max(totalPages, 1)}
                  step={1}
                  required
                  value={pageInput}
                  onChange={(event) => setPageInput(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  disabled={inventoryQuery.isFetching || totalPages < 1}
                  data-testid="input-supplier-page-number"
                />
                <span className="sc-page-total" aria-label={`${Math.max(totalPages, 1)} total pages`}>/ {Math.max(totalPages, 1)}</span>
                <button
                  type="submit"
                  disabled={inventoryQuery.isFetching || totalPages < 1}
                  aria-label="Go to page"
                  data-testid="button-supplier-go-page"
                >Go</button>
              </form>
              <button
                type="button"
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage >= totalPages || inventoryQuery.isFetching}
                aria-label="Next page"
                data-testid="button-supplier-next-page"
              >
                <span>Next</span><ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </footer>
        </>
      )}
    </section>
  )
}

export default SupplierCatalogBox