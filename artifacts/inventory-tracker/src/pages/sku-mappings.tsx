import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  GitBranch,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import {
  getGetSkuMappingCapabilitiesQueryKey,
  getListSkuMappingRowsQueryKey,
  getSearchMappingCatalogQueryKey,
  useGetSkuMappingCapabilities,
  useListSkuMappingRows,
  useSearchMappingCatalog,
} from "@workspace/api-client-react";
import type {
  ListSkuMappingRowsStatus,
  MappingCatalogVariant,
  SkuMappingRow,
} from "@workspace/api-client-react";
import "./sku-mappings.css";

const statusFilters: { value: ListSkuMappingRowsStatus; label: string }[] = [
  { value: "all", label: "All mappings" },
  { value: "unmatched", label: "Unmatched" },
  { value: "candidate", label: "Candidate" },
  { value: "flagged", label: "Flagged" },
  { value: "rejected", label: "Rejected" },
  { value: "ambiguous", label: "Ambiguous" },
  { value: "approved", label: "Approved" },
];

function rowKey(row: SkuMappingRow) {
  return `${row.supplier}::${row.originalSku}`;
}

function statusName(status: string) {
  return status.slice(0, 1).toUpperCase() + status.slice(1);
}

function quantityLabel(row: SkuMappingRow) {
  if (row.quantityText) return row.quantityText;
  if (row.supplierQuantity === null) return "Quantity not reported";
  if (row.quantityKind === "lower_bound") return `At least ${row.supplierQuantity}`;
  if (row.quantityKind === "upper_bound") return `Up to ${row.supplierQuantity}`;
  if (row.quantityKind === "unknown") return "Quantity unknown";
  return `${row.supplierQuantity}`;
}

function freshnessLabel(row: SkuMappingRow) {
  const freshness = row.freshness.toLowerCase();
  if (freshness === "stale") return "Stale feed";
  if (freshness === "unknown") return "Freshness unknown";
  return statusName(row.freshness || "unknown");
}

function sourceWarnings(row: SkuMappingRow) {
  const warnings = [...row.warnings];
  if (!row.trusted) warnings.unshift("Supplier source is not trusted for automatic use.");
  if (!row.publishable) warnings.unshift("This relationship is not publishable.");
  if (row.quantityKind === "unknown") warnings.push("Supplier quantity is unknown; no stock total is inferred.");
  return [...new Set(warnings)];
}

function MappingDialog({ row, onClose }: { row: SkuMappingRow; onClose: () => void }) {
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSource, setCatalogSource] = useState<"historical" | "live">("historical");
  const [selectedVariant, setSelectedVariant] = useState<MappingCatalogVariant | null>(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [unitConfirmed, setUnitConfirmed] = useState(false);
  const trimmedSearch = catalogSearch.trim();
  const canSearchHistorical = trimmedSearch.length >= 2;
  const catalogParams = useMemo(
    () => ({ search: canSearchHistorical ? trimmedSearch : undefined, source: catalogSource }),
    [canSearchHistorical, trimmedSearch, catalogSource],
  );
  const catalogQuery = useSearchMappingCatalog(catalogParams, {
    query: {
      enabled: canSearchHistorical,
      queryKey: getSearchMappingCatalogQueryKey(catalogParams),
      staleTime: 30_000,
    },
  });

  const historicalOnly = catalogQuery.data?.source === "historical";
  const provenanceValid = catalogQuery.data?.source === catalogSource && (
    catalogSource === "historical"
      ? catalogQuery.data.verified === false && catalogQuery.data.items.every(v => v.historical && v.variantId === null)
      : catalogQuery.data.verified === true && catalogQuery.data.items.every(v =>
        !v.historical && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(v.variantId ?? "")
        && Boolean(v.verifiedAt) && Number.isFinite(Date.parse(v.verifiedAt ?? "")))
  );
  const visibleVariants = provenanceValid ? catalogQuery.data?.items ?? [] : [];
  const blockers = catalogQuery.data?.blocker;
  const warnings = sourceWarnings(row);

  return (
    <div className="mapping-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="mapping-dialog" role="dialog" aria-modal="true" aria-labelledby="mapping-dialog-title" data-testid="dialog-fix-mapping">
        <header className="mapping-dialog-head">
          <div>
            <p className="mapping-kicker">Relationship review</p>
            <h2 id="mapping-dialog-title">{row.mappingStatus === "rejected" || row.mappingStatus === "ambiguous" ? "Resolve source mapping" : "Fix SKU mapping"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close mapping review" data-testid="button-close-mapping">
            <X size={18} />
          </button>
        </header>

        <div className="mapping-source-pair">
          <div className="mapping-source-block">
            <span className="mapping-overline">Supplier source</span>
            <strong>{row.originalSku}</strong>
            <span>{row.supplier} {row.supplierProductName ? `· ${row.supplierProductName}` : ""}</span>
          </div>
          <ArrowLeftRight className="mapping-arrow" size={18} />
          <div className="mapping-source-block destination">
            <span className="mapping-overline">Destination preview</span>
            <strong>{selectedVariant?.sku ?? `Choose a ${catalogSource} product`}</strong>
            <span>{selectedVariant?.title ?? "No live Shopify match is available"}</span>
          </div>
        </div>

        {row.mappingStatus === "rejected" && row.diagnosticSkus.length > 0 && (
          <div className="mapping-note previous-destination">
            <CircleHelp size={16} />
            <div><strong>Previously rejected destination</strong><span>{row.diagnosticSkus.join(" · ")}</span></div>
          </div>
        )}

        <div className="mapping-field">
          <label htmlFor="catalog-source">Catalog source</label>
          <select id="catalog-source" value={catalogSource} data-testid="select-catalog-source" onChange={event => {
            setCatalogSource(event.target.value as "historical" | "live");
            setSelectedVariant(null);
            setIdentityConfirmed(false);
            setUnitConfirmed(false);
          }}>
            <option value="historical">HISTORICAL — October 5 export (preview only)</option>
            <option value="live">LIVE — verified Shopify identities (not activated)</option>
          </select>
          <label htmlFor="historical-product-search">Search the {catalogSource === "historical" ? "historical product export" : "verified live catalog"}</label>
          <div className="mapping-searchbox">
            <Search size={17} />
            <input
              id="historical-product-search"
              value={catalogSearch}
              onChange={(event) => {
                setCatalogSearch(event.target.value);
                setSelectedVariant(null);
                setIdentityConfirmed(false);
                setUnitConfirmed(false);
              }}
              placeholder="Search title, SKU, or vendor"
              data-testid="input-historical-product-search"
            />
          </div>
          <p className="mapping-field-hint">{catalogSource === "historical"
            ? "HISTORICAL · October 5. Local previews, not live Shopify identities."
            : "LIVE · Not activated. Requires a permitted read provider and a separately authorized complete catalog import. No connection or token is requested here."}</p>
        </div>

        {canSearchHistorical && (
          <div className="catalog-results" aria-live="polite" data-testid="list-historical-catalog-results">
            {catalogQuery.isLoading && <div className="catalog-loading"><span /> Loading {catalogSource} matches</div>}
            {catalogQuery.isError && (
              <div className="catalog-inline-error">
                <span>{catalogSource === "live" ? "Live catalog access is blocked; no approved complete snapshot is active. Historical results are never substituted." : "Historical catalog could not be loaded."}</span>
                <button onClick={() => void catalogQuery.refetch()} data-testid="button-retry-catalog">Retry</button>
              </div>
            )}
            {catalogQuery.data && !provenanceValid && <p className="catalog-empty">Catalog provenance mismatch. Results are hidden; no mapping can be approved.</p>}
            {!catalogQuery.isLoading && !catalogQuery.isError && provenanceValid && visibleVariants.length === 0 && (
              <p className="catalog-empty">No {catalogSource} products match this search.</p>
            )}
            {visibleVariants.map((variant) => (
              <button
                type="button"
                key={variant.key}
                className={`catalog-result ${selectedVariant?.key === variant.key ? "selected" : ""}`}
                onClick={() => {
                  setSelectedVariant(variant);
                  setIdentityConfirmed(false);
                  setUnitConfirmed(false);
                }}
                data-testid={`button-select-${catalogSource}-variant-${variant.key}`}
              >
                <span className="catalog-radio">{selectedVariant?.key === variant.key ? <Check size={13} /> : null}</span>
                <span className="catalog-result-main"><strong>{variant.title}</strong><small>{variant.sku} · {variant.vendor}</small></span>
                <span className="catalog-result-meta"><small>{variant.options.join(" / ") || "No options"}</small><em>{variant.skuStatus}</em></span>
              </button>
            ))}
          </div>
        )}
        {!canSearchHistorical && <div className="catalog-prompt">Enter at least 2 characters to search the {catalogSource} catalog.</div>}

        {selectedVariant && (
          <div className="variant-preview">
            <div className="variant-preview-head"><span>Selected variant preview</span><span className="historic-tag">{selectedVariant.historical ? "HISTORICAL" : "LIVE identity — relationship unapproved"}</span></div>
            <div><strong>{selectedVariant.title}</strong><span>{selectedVariant.sku} · {selectedVariant.vendor}</span></div>
            <div className="variant-facts">
              <span>Options <b>{selectedVariant.options.join(" / ") || "None listed"}</b></span>
              <span>SKU status <b>{selectedVariant.skuStatus}</b></span>
              <span>Variant ID <b>{selectedVariant.variantId ?? "Unavailable in historical export"}</b></span>
              {!selectedVariant.historical && <>
                <span>Product ID <b>{selectedVariant.productId ?? "Unknown"}</b></span>
                <span>Inventory item <b>{selectedVariant.inventoryItemId ?? "Unavailable"}</b></span>
                <span>Product status <b>{selectedVariant.productStatus ?? "Unknown"}</b></span>
                <span>Verified <b>{selectedVariant.verifiedAt ?? "Unknown"}</b></span>
              </>}
            </div>
          </div>
        )}

        {(warnings.length > 0 || (selectedVariant && selectedVariant.skuStatus !== "unique")) && (
          <div className="mapping-warning-box">
            <div className="warning-heading"><AlertTriangle size={16} /> Verify before any future change</div>
            <ul>
              {warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
              {selectedVariant?.skuStatus === "duplicate" && <li>This product SKU is duplicated in the selected catalog; destination collision needs review.</li>}
              {selectedVariant?.skuStatus === "missing" && <li>The selected historical variant has no SKU.</li>}
              {selectedVariant && (row.quantityKind !== "exact" || /pack|piece|unit/i.test(row.quantityText ?? "")) && (
                <li>Confirm the supplier selling unit matches the selected Shopify variant; no pack or piece conversion is inferred.</li>
              )}
            </ul>
          </div>
        )}

        <div className="mapping-confirmations">
          <label><input type="checkbox" checked={identityConfirmed} onChange={(event) => setIdentityConfirmed(event.target.checked)} data-testid="check-confirm-product-identity" /> I verified the supplier source and product identity.</label>
          <label><input type="checkbox" checked={unitConfirmed} onChange={(event) => setUnitConfirmed(event.target.checked)} data-testid="check-confirm-selling-unit" /> I verified the selling unit / pack size.</label>
        </div>

        <div className="mapping-blocker" role="note" data-testid="status-mapping-write-blocked">
          <LockKeyhole size={17} />
          <div><strong>Changes are disabled</strong>
            <span>{blockers || "Mapping write and reviewer identity are not enabled. This preview cannot save, approve, or resolve a mapping."}</span>
            <span>Catalog identity verification is not supplier relationship approval. Save, Approve, and Resolve &amp; Approve remain disabled for both sources.</span>
          </div>
        </div>

        <footer className="mapping-dialog-actions">
          <button className="button-secondary" onClick={onClose} data-testid="button-cancel-mapping">Close review</button>
          <button className="button-primary disabled" disabled title="Saving is disabled until migration and reviewer identity approval." data-testid="button-save-mapping">
            {row.mappingStatus === "rejected" || row.mappingStatus === "ambiguous" ? "Resolve & approve" : "Save mapping"}
          </button>
        </footer>
        <p className="mapping-disabled-caption">Confirmations are for review only. No changes are persisted.</p>
      </section>
    </div>
  );
}

function MappingSkeleton() {
  return <div className="mapping-skeleton" aria-label="Loading SKU mappings"><div className="skeleton-title" /><div className="skeleton-toolbar" />{[1, 2, 3, 4].map((item) => <div className="skeleton-row" key={item}><i /><i /><i /><i /></div>)}</div>;
}

export default function SkuMappings() {
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("");
  const [status, setStatus] = useState<ListSkuMappingRowsStatus>("all");
  const [page, setPage] = useState(1);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [activeRow, setActiveRow] = useState<SkuMappingRow | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchDraft.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const params = useMemo(() => ({
    search: search || undefined,
    supplier: supplier || undefined,
    status,
    page,
    pageSize: 25,
  }), [search, supplier, status, page]);
  const mappings = useListSkuMappingRows(params, {
    query: {
      queryKey: getListSkuMappingRowsQueryKey(params),
      staleTime: 30_000,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
  });
  const capabilities = useGetSkuMappingCapabilities({ query: { staleTime: 30_000, queryKey: getGetSkuMappingCapabilitiesQueryKey() } });
  const rows = mappings.data?.items ?? [];
  const total = mappings.data?.total ?? 0;
  const totalPages = Math.max(mappings.data?.totalPages ?? 1, 1);
  const selectedRows = useMemo(() => rows.filter((row) => selectedKeys.includes(rowKey(row))), [rows, selectedKeys]);
  const capabilityBlockers = capabilities.data?.blockers ?? [];

  const toggleSelection = (key: string) => {
    setSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };
  const togglePage = () => {
    const pageKeys = rows.map(rowKey);
    setSelectedKeys((current) => pageKeys.every((key) => current.includes(key))
      ? current.filter((key) => !pageKeys.includes(key))
      : [...new Set([...current, ...pageKeys])]);
  };

  return (
    <div className="sku-mappings-page" data-testid="page-sku-mappings">
      <section className="mapping-intro">
        <div className="mapping-intro-copy">
          <div className="mapping-eyebrow"><GitBranch size={15} /> CATALOG GOVERNANCE <span>·</span> READ-ONLY PREVIEW</div>
          <h1>SKU Mapping <em>Manager</em></h1>
          <p>Review supplier identifiers against store products. Every relationship stays source-specific; quantities are never combined here.</p>
        </div>
        <div className="catalog-date-card">
          <span className="date-mark"><Clock3 size={17} /></span>
          <div><span>REFERENCE CATALOG</span><strong>October 5 export</strong><small>Historical snapshot · not live Shopify</small></div>
        </div>
      </section>

      <section className="capability-banner" data-testid="notice-mapping-capabilities">
        <div className="capability-icon"><ShieldAlert size={19} /></div>
        <div className="capability-content">
          <strong>Mapping changes are not available yet</strong>
          <p>The mapping schema is installed. Saving, approval, and hold resolution remain locked until reviewer authentication, transactional approval APIs and live variant verification are implemented and tested. Live catalog import is not activated; scopes remain unverified.</p>
          <div className="capability-chips">
            <span><i /> Save disabled</span><span><i /> Approve disabled</span><span><i /> Live catalog unavailable</span><span><i /> Scopes unverified</span>
          </div>
          {capabilities.isLoading && <small className="capability-loading">Checking current capability state…</small>}
          {capabilities.isError && <small className="capability-error">Capability details could not be loaded. Writes remain disabled.</small>}
          {capabilityBlockers.length > 0 && (
            <ul className="capability-blockers">{capabilityBlockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}</ul>
          )}
        </div>
        <div className="capability-state"><span>WRITE ACCESS</span><strong>LOCKED</strong></div>
      </section>

      <section className="mapping-workspace">
        <header className="workspace-heading">
          <div><p className="mapping-eyebrow">SUPPLIER RELATIONSHIPS</p><h2>Mapping queue</h2><span>One row per supplier + original SKU</span></div>
          <button className="refresh-button" onClick={() => void mappings.refetch()} disabled={mappings.isFetching} data-testid="button-refresh-mappings">
            <RefreshCw size={15} className={mappings.isFetching ? "spin" : ""} /> Refresh
          </button>
        </header>

        <div className="mapping-toolbar">
          <label className="mapping-search">
            <Search size={17} />
            <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search original SKU, product, or destination" aria-label="Search SKU mappings" data-testid="input-mapping-search" />
            {searchDraft && <button type="button" onClick={() => setSearchDraft("")} aria-label="Clear search" data-testid="button-clear-mapping-search"><X size={15} /></button>}
          </label>
          <label className="supplier-filter"><span>Supplier</span><input value={supplier} onChange={(event) => { setSupplier(event.target.value); setPage(1); setSelectedKeys([]); }} placeholder="Any supplier" aria-label="Filter by supplier" data-testid="input-mapping-supplier" /></label>
          <label className="filter-select"><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value as ListSkuMappingRowsStatus); setPage(1); setSelectedKeys([]); }} data-testid="select-mapping-status">{statusFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select></label>
        </div>

        {selectedRows.length > 0 && (
          <section className="bulk-review" data-testid="panel-bulk-review-preview">
            <header><div><span className="bulk-count">{selectedRows.length}</span><div><strong>Selected relationships</strong><small>Review each pairing individually; no values or quantities are grouped.</small></div></div>
              <button onClick={() => setSelectedKeys([])} className="clear-selection" data-testid="button-clear-selection"><X size={14} /> Clear selection</button>
            </header>
            <div className="bulk-rows">{selectedRows.map((row) => (
              <article key={rowKey(row)}>
                <div><strong>{row.supplier} <span>·</span> {row.originalSku}</strong><small>{row.suggestedSkus.length ? `Suggested: ${row.suggestedSkus.join(", ")}` : "No destination suggested"}</small></div>
                <ul>{sourceWarnings(row).length ? sourceWarnings(row).map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>) : <li>Source has no recorded warnings; identity still requires individual verification.</li>}</ul>
                <button onClick={() => setActiveRow(row)} data-testid={`button-review-selected-${encodeURIComponent(rowKey(row))}`}>Review</button>
              </article>
            ))}</div>
            <footer><span>Bulk approval is unavailable. Rejected, ambiguous, and unit-conflict cases require individual verification.</span><button disabled title="Bulk approval is disabled until migration and reviewer identity approval." data-testid="button-bulk-approve">Approve selected</button></footer>
          </section>
        )}

        {mappings.isLoading && !mappings.data ? <MappingSkeleton /> : mappings.isError && !mappings.data ? (
          <div className="mapping-error" role="alert" data-testid="status-mapping-error">
            <div className="error-symbol"><AlertTriangle size={20} /></div><h3>Mapping queue unavailable</h3>
            <p>We couldn't load the current supplier relationships. No changes have been made.</p>
            <button onClick={() => void mappings.refetch()} className="button-secondary" data-testid="button-retry-mappings">Retry loading</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="mapping-empty" data-testid="status-mapping-empty">
            <div className="empty-symbol"><Search size={20} /></div><h3>No matching relationships</h3>
            <p>Try a different supplier, status, or search term. Feed quantities are not inferred from missing matches.</p>
            <button onClick={() => { setSearchDraft(""); setSupplier(""); setStatus("all"); setPage(1); }} className="button-secondary" data-testid="button-reset-mapping-filters">Reset filters</button>
          </div>
        ) : (
          <>
            <div className="mapping-table-wrap">
              <table className="mapping-table">
                <thead><tr>
                  <th className="select-column"><input aria-label="Select all visible relationships" type="checkbox" checked={rows.length > 0 && rows.every((row) => selectedKeys.includes(rowKey(row)))} onChange={togglePage} data-testid="check-select-visible-mappings" /></th>
                  <th>Supplier source</th><th>Destination context</th><th>Supplier quantity</th><th>Feed</th><th>Status</th><th className="action-column">Review</th>
                </tr></thead>
                <tbody>
                  {rows.map((row) => {
                    const warnings = sourceWarnings(row);
                    const isChecked = selectedKeys.includes(rowKey(row));
                    return <tr key={rowKey(row)} data-testid={`row-sku-mapping-${encodeURIComponent(rowKey(row))}`}>
                      <td className="select-column"><input type="checkbox" checked={isChecked} aria-label={`Select ${row.supplier} ${row.originalSku}`} onChange={() => toggleSelection(rowKey(row))} data-testid={`check-mapping-${encodeURIComponent(rowKey(row))}`} /></td>
                      <td className="source-cell"><strong>{row.originalSku}</strong><span>{row.supplier}</span>{row.supplierProductName && <small>{row.supplierProductName}</small>}</td>
                      <td className="destination-cell">
                        {row.suggestedSkus.length ? <div className="sku-pills">{row.suggestedSkus.map((sku) => <span key={sku} className="sku-pill">{sku}</span>)}</div> : <span className="muted-text">No suggested destination</span>}
                        {row.diagnosticSkus.length > 0 && <small className="diagnostic-line">{row.mappingStatus === "rejected" ? "Previous destination: " : "Diagnostic: "}{row.diagnosticSkus.join(", ")}</small>}
                        {row.shopifyTitles.length > 0 && <small className="destination-title">{row.shopifyTitles.join(" · ")}</small>}
                        {row.reason && <small className="reason-line">{row.reason}</small>}
                      </td>
                      <td className="quantity-cell">
                        <strong className={row.quantityKind === "unknown" || row.freshness === "stale" ? "quantity-caution" : ""}>{quantityLabel(row)}</strong>
                        <span>{row.supplier?.toLowerCase().includes("hobbytyme") && /piece/i.test(row.quantityText ?? "") ? "HobbyTyme pieces · supplier units" : `${statusName(row.quantityKind)} · supplier units`}</span>
                        {row.freshness === "stale" && <small className="stale-quantity">Stale lower bound is not an exact stock count.</small>}
                      </td>
                      <td className="feed-cell"><span className={`freshness freshness-${row.freshness.toLowerCase()}`}>{row.freshness === "stale" ? <AlertTriangle size={12} /> : <Clock3 size={12} />}{freshnessLabel(row)}</span><small>{row.lastFeedImport ? new Date(row.lastFeedImport).toLocaleString() : "Import time unknown"}</small><span className={`availability availability-${row.availability.toLowerCase().replaceAll(" ", "-")}`}>{row.availability}</span></td>
                      <td><span className={`mapping-status status-${row.mappingStatus}`} data-testid={`status-row-mapping-${encodeURIComponent(rowKey(row))}`}>{row.mappingStatus}</span>{warnings.length > 0 && <small className="warning-count"><AlertTriangle size={12} /> {warnings.length} {warnings.length === 1 ? "review note" : "review notes"}</small>}</td>
                      <td className="action-column"><button className="review-button" onClick={() => setActiveRow(row)} data-testid={`button-fix-mapping-${encodeURIComponent(rowKey(row))}`}>{row.mappingStatus === "rejected" || row.mappingStatus === "ambiguous" ? "Resolve" : "Fix mapping"} <ChevronRight size={14} /></button></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
            <footer className="mapping-pagination">
              <span>Showing <strong>{(page - 1) * 25 + 1}–{Math.min(page * 25, total)}</strong> of <strong>{total}</strong> relationships{mappings.isFetching && <em> Updating…</em>}</span>
              <div><button onClick={() => { setPage((current) => Math.max(1, current - 1)); setSelectedKeys([]); }} disabled={page <= 1} aria-label="Previous page" data-testid="button-previous-mapping-page"><ChevronLeft size={16} /></button><span>Page {page} of {totalPages}</span><button onClick={() => { setPage((current) => Math.min(totalPages, current + 1)); setSelectedKeys([]); }} disabled={page >= totalPages} aria-label="Next page" data-testid="button-next-mapping-page"><ChevronRight size={16} /></button></div>
            </footer>
          </>
        )}
      </section>
      <div className="mapping-footnote"><LockKeyhole size={14} /><span>Preview only. This screen does not persist relationships, alter stock, or publish to Shopify.</span></div>
      {activeRow && <MappingDialog row={activeRow} onClose={() => setActiveRow(null)} />}
    </div>
  );
}
