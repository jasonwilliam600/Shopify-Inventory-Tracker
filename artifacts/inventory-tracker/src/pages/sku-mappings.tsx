import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
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
  getGetReviewerSessionQueryKey,
  useGetReviewerSession,
  useApproveSkuMapping,
  useRevokeSkuMapping,
} from "@workspace/api-client-react";
import { ReviewerSignIn } from "@/lib/clerk-host";
import type {
  ListSkuMappingRowsStatus,
  MappingCatalogVariant,
  SkuMappingApprovalInputSupplier,
  SkuMappingRevocationInputSupplier,
  SkuMappingRow,
} from "@workspace/api-client-react";
import "./sku-mappings.css";

const statusFilters: { value: ListSkuMappingRowsStatus; label: string }[] = [
  { value: "all", label: "All mappings" },
  { value: "unmatched", label: "Unmatched" },
  { value: "candidate", label: "Candidate" },
  { value: "held", label: "Held" },
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

function MappingDialog({ row, onClose, canApprove, reviewerAuthorized, returnFocus }: {
  row: SkuMappingRow;
  onClose: () => void;
  canApprove: boolean;
  reviewerAuthorized: boolean;
  returnFocus: HTMLElement | null;
}) {
  const [showReview, setShowReview] = useState(row.mappingStatus !== "rejected");
  const closeButton = useRef<HTMLButtonElement>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSource, setCatalogSource] = useState<"historical" | "live">("historical");
  const [selectedVariant, setSelectedVariant] = useState<MappingCatalogVariant | null>(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [unitConfirmed, setUnitConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [costBasis, setCostBasis] = useState<"piece" | "pack" | "unknown">("unknown");
  const [packSize, setPackSize] = useState("");
  const [costEvidence, setCostEvidence] = useState("");
  const [writeMessage, setWriteMessage] = useState("");
  const queryClient = useQueryClient();
  const approveMapping = useApproveSkuMapping();
  const revokeMapping = useRevokeSkuMapping();
  const trimmedSearch = catalogSearch.trim();
  const canSearchHistorical = trimmedSearch.length >= 2;
  const catalogParams = useMemo(
    () => ({ search: canSearchHistorical ? trimmedSearch : undefined, source: catalogSource }),
    [canSearchHistorical, trimmedSearch, catalogSource],
  );
  const liveReady = catalogSource === "historical" || (reviewerAuthorized && canApprove);
  const catalogQuery = useSearchMappingCatalog(catalogParams, {
    query: {
      enabled: canSearchHistorical && liveReady,
      queryKey: getSearchMappingCatalogQueryKey(catalogParams),
      staleTime: 30_000,
    },
  });

  const provenanceValid = catalogQuery.data?.source === catalogSource && (
    catalogSource === "historical"
      ? catalogQuery.data.verified === false && catalogQuery.data.items.every(v => v.historical && v.variantId === null)
      : catalogQuery.data.verified === true && catalogQuery.data.items.every(v =>
        !v.historical && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(v.variantId ?? "")
        && Boolean(v.verifiedAt) && Number.isFinite(Date.parse(v.verifiedAt ?? ""))
        && Boolean(v.identityFingerprint))
  );
  const visibleVariants = provenanceValid ? catalogQuery.data?.items ?? [] : [];
  const permanentlyDisabled = row.mappingStatus === "held" || row.mappingStatus === "flagged" || row.mappingStatus === "rejected";
  const writePending = approveMapping.isPending || revokeMapping.isPending;
  const reasonValid = reason.trim().length >= 12;
  const approvalReady = reviewerAuthorized && canApprove && !permanentlyDisabled
    && selectedVariant !== null && !selectedVariant.historical
    && selectedVariant.skuStatus === "unique"
    && Boolean(selectedVariant.identityFingerprint) && Boolean(row.sourceIdentityFingerprint)
    && identityConfirmed && unitConfirmed && reasonValid
    && (!costConfirmed || (costEvidence.trim().length >= 12 && (costBasis === "piece"
      || (costBasis === "pack" && Number.isSafeInteger(Number(packSize)) && Number(packSize) > 0))));
  const saveApproval = async () => {
    if (!approvalReady || !selectedVariant?.variantId || !selectedVariant.identityFingerprint) return;
    setWriteMessage("");
    try {
      await approveMapping.mutateAsync({ data: {
        supplier: row.supplier as SkuMappingApprovalInputSupplier,
        originalSku: row.originalSku,
        sourceIdentityFingerprint: row.sourceIdentityFingerprint!,
        variantId: selectedVariant.variantId,
        expectedVersion: row.decisionVersion ?? null,
        expectedCostAmount: costConfirmed ? row.costAmount ?? null : null,
        identityFingerprint: selectedVariant.identityFingerprint,
        identityConfirmed: true,
        unitConfirmed: true,
        reason: reason.trim(),
        costConfirmed,
        costBasis,
        packSize: costBasis === "pack" && packSize ? Number(packSize) : null,
        costEvidence: costEvidence.trim(),
      } });
      setWriteMessage("Mapping approved. The decision was saved atomically.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/sku-mappings"] }),
        queryClient.invalidateQueries({ queryKey: getGetSkuMappingCapabilitiesQueryKey() }),
      ]);
      onClose();
    } catch (error) {
      setWriteMessage(error instanceof Error ? error.message : "Approval failed. No automatic retry was attempted.");
    }
  };
  const revokeApproval = async () => {
    if (!reviewerAuthorized || !canApprove || !reasonValid || !row.decisionVersion) return;
    setWriteMessage("");
    try {
      await revokeMapping.mutateAsync({ data: {
        supplier: row.supplier as SkuMappingRevocationInputSupplier,
        originalSku: row.originalSku,
        expectedVersion: row.decisionVersion,
        reason: reason.trim(),
      } });
      setWriteMessage("Approval revoked.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/sku-mappings"] }),
        queryClient.invalidateQueries({ queryKey: getGetSkuMappingCapabilitiesQueryKey() }),
      ]);
      onClose();
    } catch (error) {
      setWriteMessage(error instanceof Error ? error.message : "Revocation failed. No automatic retry was attempted.");
    }
  };
  const blockers = catalogQuery.data?.blocker;
  const warnings = sourceWarnings(row);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="mapping-overlay sku-mappings-page">
      <DialogPrimitive.Content
        className="mapping-dialog"
        aria-describedby={row.mappingStatus === "rejected" ? "rejected-mapping-safety" : undefined}
        data-testid="dialog-fix-mapping"
        onOpenAutoFocus={(event) => { event.preventDefault(); closeButton.current?.focus(); }}
        onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus?.focus(); }}
      >
        <header className="mapping-dialog-head">
          <div>
            <p className="mapping-kicker">Relationship review</p>
            <DialogPrimitive.Title asChild>
              <h2>{!showReview ? "Rejected mapping details" : row.mappingStatus === "rejected" || row.mappingStatus === "ambiguous" ? "Review source mapping" : "Fix SKU mapping"}</h2>
            </DialogPrimitive.Title>
          </div>
          <button ref={closeButton} className="icon-button" onClick={onClose} aria-label="Close mapping review" data-testid="button-close-mapping">
            <X size={18} />
          </button>
        </header>

        {row.mappingStatus === "rejected" && (
          <section className="rejected-mapping-details" aria-label="Rejected source details">
            <p id="rejected-mapping-safety" className="mapping-field-hint">Read-only inspection. This rejection and its protected source hold remain in effect. Opening review does not approve, remap, or clear it.</p>
            <dl className="rejected-mapping-facts">
              <div><dt>Supplier</dt><dd>{row.supplier}</dd></div>
              <div><dt>Original SKU</dt><dd>{row.originalSku}</dd></div>
              <div><dt>Product description</dt><dd>{row.supplierProductName || "Not supplied in the current source record."}</dd></div>
              <div><dt>Supplier quantity</dt><dd>{quantityLabel(row)} · {statusName(row.quantityKind)} supplier units · {freshnessLabel(row)}</dd></div>
              <div><dt>Last feed import</dt><dd>{row.lastFeedImport ? new Date(row.lastFeedImport).toLocaleString() : "Import time unknown"}</dd></div>
              <div><dt>Previous destination</dt><dd>{row.diagnosticSkus.join(" · ") || "Not available in this review response."}</dd></div>
              <div><dt>Rejection reason</dt><dd>{row.reason || "No reason supplied in this review response."}</dd></div>
            </dl>
            <h3>Review notes</h3>
            <ul className="rejected-review-notes">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            <p className="mapping-field-hint">These are source review warnings. Saved reviewer notes are not exposed by the current review response.</p>
            <h3>Available mapping history</h3>
            <p className="mapping-field-hint">{row.diagnosticSkus.length > 0 ? `Previously rejected relationship: ${row.originalSku} → ${row.diagnosticSkus.join(" · ")}.` : "Previous destination evidence is unavailable."}</p>
            {row.decisionId && <p className="mapping-field-hint">Decision reference: {row.decisionId} · version {row.decisionVersion ?? "unknown"}{row.approvedVariantId ? ` · variant ${row.approvedVariantId}` : ""}.</p>}
            <p className="mapping-field-hint">Full timestamped audit events are not exposed by the current review response. Existing history is unchanged.</p>
            {!showReview && <footer className="mapping-dialog-footer">
              <button className="button-secondary" onClick={onClose}>Back to filtered list</button>
              <button className="button-secondary" onClick={() => setShowReview(true)} data-testid="button-open-rejected-review">Open existing mapping review <ChevronRight size={14} /></button>
              <span className="mapping-disabled-caption">Diagnostic review is available; correcting or approving a protected rejection is not supported by this workflow.</span>
            </footer>}
          </section>
        )}

        {showReview && <>
        <div className="mapping-source-pair">
          <div className="mapping-source-block">
            <span className="mapping-overline">Supplier source</span>
            <strong>{row.originalSku}</strong>
            <span>{row.supplier} {row.supplierProductName ? `· ${row.supplierProductName}` : ""}</span>
            <small>Source quantity: {quantityLabel(row)} · {statusName(row.quantityKind)} supplier units</small>
            {row.costAmount !== null && row.costAmount !== undefined && <small>Exact source cost: {row.costAmount} · basis unconverted</small>}
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
            <option value="live" disabled={!reviewerAuthorized || !canApprove}>LIVE — verified local catalog</option>
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
            ? "HISTORICAL · October 5. Local diagnostic previews, not verified variant identities."
            : "VERIFIED LOCAL CACHE · Read-only. This screen never requests Shopify data or imports a catalog."}</p>
        </div>

        {catalogSource === "live" && !liveReady && (
          <div className="mapping-blocker"><LockKeyhole size={17} /><div><strong>Verified catalog search unavailable</strong><span>Sign in as an authorized reviewer and confirm a fresh verified local catalog is ready before selecting a destination.</span>{!reviewerAuthorized && <ReviewerSignIn />}</div></div>
        )}

        {canSearchHistorical && (
          <div className="catalog-results" aria-live="polite" data-testid="list-historical-catalog-results">
            {catalogQuery.isLoading && <div className="catalog-loading"><span /> Loading {catalogSource} matches</div>}
            {catalogQuery.isError && (
              <div className="catalog-inline-error">
                <span>{catalogSource === "live" ? "Verified local catalog is unavailable. Historical results are never substituted." : "Historical catalog could not be loaded."}</span>
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
                disabled={!variant.historical && (!variant.identityFingerprint || !reviewerAuthorized || !canApprove)}
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
              <span>Identity fingerprint <b>{selectedVariant.identityFingerprint ?? "Unavailable"}</b></span>
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

        <div className="mapping-field mapping-evidence-fields">
          <label htmlFor="mapping-review-reason">Reviewer evidence / reason <span>Required · at least 12 characters</span></label>
          <textarea id="mapping-review-reason" value={reason} onChange={event => setReason(event.target.value)} placeholder="Describe the evidence supporting this exact supplier source and variant." rows={3} data-testid="input-mapping-review-reason" />
          {row.costAmount !== null && row.costAmount !== undefined ? <>
            <p className="mapping-field-hint">Exact source cost: <strong>{row.costAmount}</strong> · {row.supplier} · {row.originalSku}. The displayed value is submitted unchanged for verification.</p>
            <label className="mapping-check-label"><input type="checkbox" checked={costConfirmed} onChange={event => setCostConfirmed(event.target.checked)} data-testid="check-confirm-source-cost" /> Explicitly verify the supplier cost basis (optional).</label>
          </> : <p className="mapping-field-hint">No current source cost amount is reported; cost verification is unavailable for this row.</p>}
          {costConfirmed && row.costAmount !== null && row.costAmount !== undefined && <div className="mapping-cost-evidence">
            <label>Cost is for<select value={costBasis} onChange={event => setCostBasis(event.target.value as "piece" | "pack" | "unknown")}><option value="unknown">Unknown basis</option><option value="piece">One individual piece</option><option value="pack">One supplier pack</option></select></label>
            {costBasis === "pack" && <label>Pack quantity<input type="number" min="1" step="1" value={packSize} onChange={event => setPackSize(event.target.value)} placeholder="Enter confirmed pack count" /></label>}
            <label>Cost evidence<input value={costEvidence} onChange={event => setCostEvidence(event.target.value)} placeholder="Invoice, feed field, or verified note" /></label>
          </div>}
          <p className="mapping-field-hint">Keep source basis explicit: one piece or one supplier pack. No inferred piece/pack conversion.</p>
        </div>

          <div className="mapping-blocker" role="note" data-testid="status-mapping-write-blocked">
          <LockKeyhole size={17} />
          <div><strong>{permanentlyDisabled ? "Approval permanently disabled" : "Approval prerequisites"}</strong>
            <span>{blockers || (permanentlyDisabled ? "Flagged and rejected sources are permanently disabled in this workflow." : "Approval requires an authorized reviewer, a fresh verified local catalog identity, confirmations, and evidence.")}</span>
            <span>Historical matches are diagnostic only. Prefixes and suggestions never grant approval; held sources are rejected by the server.</span>
          </div>
        </div>

        <footer className="mapping-dialog-actions">
          <button className="button-secondary" onClick={onClose} data-testid="button-cancel-mapping">Close review</button>
          {row.mappingStatus === "approved" ? (
            <button className="button-primary disabled" onClick={() => void revokeApproval()} disabled={writePending || !reviewerAuthorized || !canApprove || !reasonValid || !row.decisionVersion} data-testid="button-revoke-mapping">
              {revokeMapping.isPending ? "Revoking…" : "Revoke approval"}
            </button>
          ) : (
            <button className="button-primary disabled" onClick={() => void saveApproval()} disabled={writePending || !approvalReady || (costBasis === "pack" && costConfirmed && (!packSize || Number(packSize) < 1))} title={permanentlyDisabled ? "Held, flagged, or rejected sources cannot be approved." : undefined} data-testid="button-save-mapping">
              {approveMapping.isPending ? "Approving…" : "Approve mapping"}
            </button>
          )}
          {writeMessage && <span className="mapping-write-message" role="status">{writeMessage}</span>}
          {!reviewerAuthorized && <ReviewerSignIn />}
          {row.mappingStatus === "held" || row.mappingStatus === "flagged" || row.mappingStatus === "rejected" ? <span className="mapping-disabled-caption">This source cannot be resolved or approved in this workflow.</span> : null}
          {approveMapping.isError && <span className="mapping-write-error" role="alert">{approveMapping.error instanceof Error ? approveMapping.error.message : "Approval failed."}</span>}
          {revokeMapping.isError && <span className="mapping-write-error" role="alert">{revokeMapping.error instanceof Error ? revokeMapping.error.message : "Revocation failed."}</span>}
        </footer>
        <p className="mapping-disabled-caption">Approval atomically saves this individual source relationship. It never updates inventory or publishes to Shopify.</p>
        </>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Overlay>
    </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function MappingSkeleton() {
  return <div className="mapping-skeleton" aria-label="Loading SKU mappings"><div className="skeleton-title" /><div className="skeleton-toolbar" />{[1, 2, 3, 4].map((item) => <div className="skeleton-row" key={item}><i /><i /><i /><i /></div>)}</div>;
}

export default function SkuMappings() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const statusFromLocation = useMemo<ListSkuMappingRowsStatus>(() => {
    const value = new URLSearchParams(searchString).get("status");
    return statusFilters.some((filter) => filter.value === value) ? value as ListSkuMappingRowsStatus : "all";
  }, [searchString]);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("");
  const [status, setStatus] = useState<ListSkuMappingRowsStatus>(statusFromLocation);
  const [page, setPage] = useState(1);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [activeRow, setActiveRow] = useState<SkuMappingRow | null>(null);
  const mappingOpener = useRef<HTMLElement | null>(null);
  const openMapping = (row: SkuMappingRow, opener: HTMLElement) => {
    mappingOpener.current = opener;
    setActiveRow(row);
  };
  const reviewerSession = useGetReviewerSession({
    query: { queryKey: getGetReviewerSessionQueryKey(), staleTime: 15_000 },
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
      setSelectedKeys([]);
      setActiveRow(null);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    setStatus(statusFromLocation);
    setPage(1);
    setSelectedKeys([]);
    setActiveRow(null);
  }, [statusFromLocation]);

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
            <strong>{capabilities.data?.canApprove ? "Authenticated mapping review is available" : "Mapping approval prerequisites"}</strong>
            <p>Only a fresh, verified local catalog identity can be approved by an allowlisted reviewer. Historical diagnostics remain read-only; holds, flagged sources, and rejected sources cannot be resolved here.</p>
          <div className="capability-chips">
            <span><i /> {capabilities.data?.canSave ? "Save enabled" : "Save disabled"}</span><span><i /> {capabilities.data?.canApprove ? "Approve enabled" : "Approve disabled"}</span><span><i /> Verified local cache</span><span><i /> Manual review only</span>
          </div>
          {capabilities.isLoading && <small className="capability-loading">Checking current capability state…</small>}
          {capabilities.isError && <small className="capability-error">Capability details could not be loaded. Writes remain disabled.</small>}
          {capabilityBlockers.length > 0 && (
            <ul className="capability-blockers">{capabilityBlockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}</ul>
          )}
        </div>
          <div className="capability-state"><span>WRITE ACCESS</span><strong>{capabilities.data?.canApprove ? "REVIEW" : "LOCKED"}</strong></div>
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
          <label className="supplier-filter"><span>Supplier</span><input value={supplier} onChange={(event) => { setSupplier(event.target.value); setPage(1); setSelectedKeys([]); setActiveRow(null); }} placeholder="Any supplier" aria-label="Filter by supplier" data-testid="input-mapping-supplier" /></label>
          <label className="filter-select"><span>Status</span><select value={status} onChange={(event) => {
            const nextStatus = event.target.value as ListSkuMappingRowsStatus;
            setStatus(nextStatus);
            setPage(1);
            setSelectedKeys([]);
            setActiveRow(null);
            setLocation(nextStatus === "all" ? "/sku-mappings" : `/sku-mappings?status=${encodeURIComponent(nextStatus)}`);
          }} data-testid="select-mapping-status">{statusFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select></label>
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
            <button onClick={(event) => openMapping(row, event.currentTarget)} data-testid={`button-review-selected-${encodeURIComponent(rowKey(row))}`}>Review</button>
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
            <button onClick={() => { setSearchDraft(""); setSupplier(""); setStatus("all"); setPage(1); setSelectedKeys([]); setActiveRow(null); setLocation("/sku-mappings"); }} className="button-secondary" data-testid="button-reset-mapping-filters">Reset filters</button>
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
                    return <tr
                      key={rowKey(row)}
                      data-testid={`row-sku-mapping-${encodeURIComponent(rowKey(row))}`}
                      className={row.mappingStatus === "rejected" ? "rejected-review-row" : undefined}
                      tabIndex={row.mappingStatus === "rejected" ? 0 : undefined}
                      aria-label={row.mappingStatus === "rejected" ? `Inspect rejected mapping ${row.supplier} ${row.originalSku}` : undefined}
                      aria-haspopup={row.mappingStatus === "rejected" ? "dialog" : undefined}
                      onClick={(event) => {
                        if (row.mappingStatus !== "rejected" || (event.target as HTMLElement).closest("button, input, a, select, textarea, label")) return;
                        openMapping(row, event.currentTarget);
                      }}
                      onKeyDown={(event) => {
                        if (row.mappingStatus !== "rejected" || event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
                        event.preventDefault();
                        openMapping(row, event.currentTarget);
                      }}
                    >
                      <td className="select-column"><input type="checkbox" checked={isChecked} aria-label={`Select ${row.supplier} ${row.originalSku}`} onChange={() => toggleSelection(rowKey(row))} data-testid={`check-mapping-${encodeURIComponent(rowKey(row))}`} /></td>
                      <td className="source-cell"><strong>{row.originalSku}</strong><span>{row.supplier}</span>{row.supplierProductName && <small>{row.supplierProductName}</small>}</td>
                      <td className="destination-cell">
                        {row.suggestedSkus.length ? <div className="sku-pills">{row.suggestedSkus.map((sku) => <span key={sku} className="sku-pill">{sku}</span>)}</div> : <span className="muted-text">No suggested destination</span>}
                        {row.diagnosticSkus.length > 0 && <small className="diagnostic-line">{row.mappingStatus === "rejected" ? "Previous destination: " : "Diagnostic: "}{row.diagnosticSkus.join(", ")}</small>}
                        {row.shopifyTitles.length > 0 && <small className="destination-title">{row.shopifyTitles.join(" · ")}</small>}
                        {row.reason && <small className="reason-line">{row.reason}</small>}
                        {row.decisionId && <small className="diagnostic-line">Decision v{row.decisionVersion ?? "—"} · {row.approvedVariantId ?? "Approved variant unavailable"}</small>}
                        {row.identityFingerprint && <small className="diagnostic-line">Identity {row.identityFingerprint}</small>}
                        {row.costAmount !== null && row.costAmount !== undefined && <small className="diagnostic-line">Source cost {row.costAmount} · exact supplier basis</small>}
                      </td>
                      <td className="quantity-cell">
                        <strong className={row.quantityKind === "unknown" || row.freshness === "stale" ? "quantity-caution" : ""}>{quantityLabel(row)}</strong>
                        <span>{row.supplier?.toLowerCase().includes("hobbytyme") && /piece/i.test(row.quantityText ?? "") ? "HobbyTyme pieces · supplier units" : `${statusName(row.quantityKind)} · supplier units`}</span>
                        {row.freshness === "stale" && <small className="stale-quantity">Stale lower bound is not an exact stock count.</small>}
                      </td>
                      <td className="feed-cell"><span className={`freshness freshness-${row.freshness.toLowerCase()}`}>{row.freshness === "stale" ? <AlertTriangle size={12} /> : <Clock3 size={12} />}{freshnessLabel(row)}</span><small>{row.lastFeedImport ? new Date(row.lastFeedImport).toLocaleString() : "Import time unknown"}</small><span className={`availability availability-${row.availability.toLowerCase().replaceAll(" ", "-")}`}>{row.availability}</span></td>
                      <td><span className={`mapping-status status-${row.mappingStatus}`} data-testid={`status-row-mapping-${encodeURIComponent(rowKey(row))}`}>{row.mappingStatus}</span>{warnings.length > 0 && <small className="warning-count"><AlertTriangle size={12} /> {warnings.length} {warnings.length === 1 ? "review note" : "review notes"}</small>}</td>
                       <td className="action-column"><button className="review-button" onClick={(event) => openMapping(row, event.currentTarget)} data-testid={`button-fix-mapping-${encodeURIComponent(rowKey(row))}`}>{row.mappingStatus === "rejected" || row.mappingStatus === "flagged" || row.mappingStatus === "held" ? "Inspect" : row.mappingStatus === "approved" ? "Review approval" : "Review mapping"} <ChevronRight size={14} /></button></td>
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
      {activeRow && <MappingDialog
        key={rowKey(activeRow)}
        row={activeRow}
        returnFocus={mappingOpener.current}
        onClose={() => setActiveRow(null)}
        canApprove={capabilities.data?.canApprove === true}
        reviewerAuthorized={reviewerSession.data?.configured === true && reviewerSession.data.authenticated && reviewerSession.data.authorized}
      />}
    </div>
  );
}
