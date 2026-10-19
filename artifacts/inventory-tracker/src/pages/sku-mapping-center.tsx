import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, ArrowRight, ArrowRightLeft, Check, ChevronLeft,
  ChevronRight, CircleHelp, GitBranch, LockKeyhole, PackageSearch, Search,
  ShieldCheck, Wrench,
} from "lucide-react";
import {
  getGetMappingCenterQueryKey, getGetReviewerSessionQueryKey,
  getListCenterProposalsQueryKey, getSearchCenterSourcesQueryKey,
  getSearchMappingCatalogQueryKey, useGetMappingCenter, useGetReviewerSession,
  useListCenterProposals, usePreviewCenterRule, useSaveCenterProposal,
  useSearchCenterSources, useSearchMappingCatalog,
} from "@workspace/api-client-react";
import type {
  CenterComparison, CenterProposalInput, CenterRulePreviewInput,
} from "@workspace/api-client-react";
import { ReviewerSignIn } from "@/lib/clerk-host";
import { INDIVIDUAL_CORRECTION_REASONS, IndividualCorrectionReasonField, resolveIndividualReason } from "@/lib/individual-correction-reason";
import type { IndividualCorrectionReason } from "@/lib/individual-correction-reason";
import "./sku-mapping-center.css";

type Workflow = "rule" | "individual";
type PreviewStatus = "all" | "review" | "conflict" | "protected";

const statusChoices: { value: PreviewStatus; label: string }[] = [
  { value: "all", label: "All results" },
  { value: "review", label: "Review" },
  { value: "conflict", label: "Conflicts" },
  { value: "protected", label: "Protected" },
];

function statusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function useDebounced(value: string, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value.trim()), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function Stat({ label, value, note }: { label: string; value: string | number; note: string }) {
  return <div className="center-stat"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function Pager({ page, totalPages, onPage, disabled = false }: { page: number; totalPages: number; onPage: (page: number) => void; disabled?: boolean }) {
  return <div className="center-pager">
    <span>Page <strong>{page}</strong> of <strong>{Math.max(totalPages, 1)}</strong></span>
    <div>
      <button type="button" aria-label="Previous page" data-testid="button-center-previous-page" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={15} /></button>
      <button type="button" aria-label="Next page" data-testid="button-center-next-page" disabled={disabled || page >= totalPages} onClick={() => onPage(page + 1)}><ChevronRight size={15} /></button>
    </div>
  </div>;
}

function ResultRows({ rows, emptyLabel }: { rows: CenterComparison[]; emptyLabel: string }) {
  if (!rows.length) return <div className="center-empty"><PackageSearch size={20} /><strong>No comparison rows</strong><span>{emptyLabel}</span></div>;
  return <div className="center-comparison-list">
    {rows.map((row, index) => <article className="center-comparison-row" key={`${row.supplier}-${row.originalSku}-${index}`} data-testid={`row-center-comparison-${index}`}>
      <div className="center-product">
        <span className="center-product-kicker">Supplier product</span>
        <strong className="center-mono">{row.originalSku || "SKU not supplied"}</strong>
        <span>{row.supplierTitle || "No supplier title supplied"}</span>
        <small>{row.supplier}</small>
      </div>
      <ArrowRightLeft className="center-compare-arrow" size={16} aria-hidden="true" />
      <div className="center-product">
        <span className="center-product-kicker">Historical catalog · unverified</span>
        <strong className="center-mono">{row.proposedSku || "No destination SKU"}</strong>
        <span>{row.catalogTitle || "No historical title available"}</span>
        <small>{row.catalogKey ? `Catalog reference ${row.catalogKey}` : "No historical catalog key"}</small>
      </div>
      <div className="center-row-status">
        <span className={`center-badge ${row.status.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`}>{statusLabel(row.status)}</span>
        <small>{row.verified ? "Verified" : "Not verified"}</small>
        {row.warnings.length > 0 && <details className="center-warnings">
          <summary><AlertTriangle size={13} /> {row.warnings.length} {row.warnings.length === 1 ? "warning" : "warnings"}</summary>
          <ul>{row.warnings.map((warning, warningIndex) => <li key={`${warningIndex}-${warning}`}>{warning}</li>)}</ul>
        </details>}
      </div>
    </article>)}
  </div>;
}

export default function SkuMappingCenter() {
  const searchString = useSearch();
  const queryClient = useQueryClient();
  const config = useGetMappingCenter({ query: { queryKey: getGetMappingCenterQueryKey(), staleTime: 30_000 } });
  const reviewer = useGetReviewerSession({ query: { queryKey: getGetReviewerSessionQueryKey(), staleTime: 15_000 } });
  const authorized = reviewer.data?.configured === true && reviewer.data.authenticated && reviewer.data.authorized;
  const proposals = useListCenterProposals({
    query: { queryKey: getListCenterProposalsQueryKey(), enabled: authorized, staleTime: 20_000 },
  });
  const saveProposal = useSaveCenterProposal();
  const previewMutation = usePreviewCenterRule();

  const [workflow, setWorkflow] = useState<Workflow>("rule");
  const [supplier, setSupplier] = useState("");
  const [incoming, setIncoming] = useState("");
  const [destination, setDestination] = useState("");
  const [ruleSearchDraft, setRuleSearchDraft] = useState("");
  const ruleSearch = useDebounced(ruleSearchDraft);
  const [ruleStatus, setRuleStatus] = useState<PreviewStatus>("all");
  const [rulePage, setRulePage] = useState(1);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewMutation.mutateAsync>> | null>(null);
  const [previewSignature, setPreviewSignature] = useState("");
  const [previewBaseSignature, setPreviewBaseSignature] = useState("");
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [previewRequestPending, setPreviewRequestPending] = useState(false);
  const previewRequestSequence = useRef(0);
  const previewMutationRef = useRef(previewMutation.mutateAsync);
  previewMutationRef.current = previewMutation.mutateAsync;
  const [ruleIdentityChecked, setRuleIdentityChecked] = useState(false);
  const [ruleUnitChecked, setRuleUnitChecked] = useState(false);
  const [sourceSearchDraft, setSourceSearchDraft] = useState("");
  const sourceSearch = useDebounced(sourceSearchDraft);
  const [sourcePage, setSourcePage] = useState(1);
  const [selectedSource, setSelectedSource] = useState<{ supplier: string; sku: string; title: string | null } | null>(null);
  const [catalogSearchDraft, setCatalogSearchDraft] = useState("");
  const catalogSearch = useDebounced(catalogSearchDraft);
  const [selectedCatalog, setSelectedCatalog] = useState<{ key: string; sku: string; title: string; vendor: string; skuStatus: string } | null>(null);
  const [individualIdentityChecked, setIndividualIdentityChecked] = useState(false);
  const [individualUnitChecked, setIndividualUnitChecked] = useState(false);
  const [reason, setReason] = useState("");
  const [individualReasonChoice, setIndividualReasonChoice] = useState<IndividualCorrectionReason>(INDIVIDUAL_CORRECTION_REASONS[0]);
  const [individualOtherReason, setIndividualOtherReason] = useState("");
  const individualReason = resolveIndividualReason(individualReasonChoice, individualOtherReason);
  const [receipt, setReceipt] = useState<{ id: string; createdAt: string; state: string; active: boolean; sha256: string } | null>(null);
  const [writeError, setWriteError] = useState("");
  const [preselectSku, setPreselectSku] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    if (params.get("workflow") !== "individual") return;
    const sku = params.get("sku") ?? "";
    setWorkflow("individual");
    setSupplier(params.get("supplier") ?? "");
    if (sku) {
      setSourceSearchDraft(sku);
      setSelectedSource(null);
      setSelectedCatalog(null);
      setIndividualIdentityChecked(false);
      setIndividualUnitChecked(false);
      setReceipt(null);
      setPreselectSku(sku);
    }
  }, [searchString]);

  const ruleBaseSignature = useMemo(() => JSON.stringify({
    supplier, incoming: incoming.trim(), destination: destination.trim(),
  }), [supplier, incoming, destination]);
  const ruleInputsValid = incoming.trim().length > 0 && destination.trim().length > 0
    && incoming.trim().length <= 30 && destination.trim().length <= 30;
  const previewSignatureKey = useMemo(() => JSON.stringify({
    base: ruleBaseSignature, search: ruleSearch, status: ruleStatus, page: rulePage,
  }), [ruleBaseSignature, ruleSearch, ruleStatus, rulePage]);
  const currentPreview = preview && previewSignature === previewSignatureKey
    && ruleSearch === ruleSearchDraft.trim() ? preview : null;

  useEffect(() => {
    setPreview(null);
    setPreviewSignature("");
    setRuleIdentityChecked(false);
    setRuleUnitChecked(false);
    setReceipt(null);
    setPreviewBaseSignature("");
  }, [ruleBaseSignature]);

  const sourceParams = useMemo(() => ({
    search: sourceSearch,
    supplier: supplier || undefined,
    page: sourcePage,
  }), [sourceSearch, supplier, sourcePage]);
  const sourceQuery = useSearchCenterSources(sourceParams, {
    query: {
      enabled: workflow === "individual" && sourceSearch.length >= 2,
      queryKey: getSearchCenterSourcesQueryKey(sourceParams),
      staleTime: 20_000,
    },
  });
  useEffect(() => {
    if (workflow !== "individual" || !preselectSku || !sourceQuery.data) return;
    const exact = sourceQuery.data.items.find(row =>
      row.sku.toLowerCase() === preselectSku.toLowerCase()
      && (!supplier || row.supplier === supplier),
    );
    if (exact) {
      setSelectedSource(exact);
      setPreselectSku("");
    }
  }, [workflow, preselectSku, supplier, sourceQuery.data]);

  const catalogParams = useMemo(() => ({ search: catalogSearch, source: "historical" as const }), [catalogSearch]);
  const catalogQuery = useSearchMappingCatalog(catalogParams, {
    query: {
      enabled: workflow === "individual" && catalogSearch.length >= 2,
      queryKey: getSearchMappingCatalogQueryKey(catalogParams),
      staleTime: 30_000,
    },
  });

  const canSaveRule = Boolean(currentPreview && currentPreview.affected > 0 && ruleIdentityChecked && ruleUnitChecked && reason.trim().length >= 12 && authorized);
  const canSaveIndividual = Boolean(selectedSource && selectedCatalog?.skuStatus === "unique" && individualIdentityChecked && individualUnitChecked && individualReason && authorized);
  const isPreviewPending = previewRequestPending || previewMutation.isPending;

  const startPreview = () => {
    if (!ruleInputsValid) return;
    setPreviewBaseSignature(ruleBaseSignature);
    setRulePage(1);
    setPreview(null);
    setPreviewSignature("");
    setRuleIdentityChecked(false);
    setRuleUnitChecked(false);
    setWriteError("");
    setPreviewRefresh(value => value + 1);
  };

  useEffect(() => {
    if (!ruleInputsValid || !previewBaseSignature || previewBaseSignature !== ruleBaseSignature) {
      setPreviewRequestPending(false);
      return;
    }
    const requestKey = previewSignatureKey;
    const timer = window.setTimeout(() => {
      const sequence = ++previewRequestSequence.current;
      setPreviewRequestPending(true);
      setPreview(null);
      setPreviewSignature("");
      setRuleIdentityChecked(false);
      setRuleUnitChecked(false);
      setReceipt(null);
      const payload: CenterRulePreviewInput = {
        supplier,
        incoming: incoming.trim(),
        destination: destination.trim(),
        search: ruleSearch || undefined,
        status: ruleStatus,
        page: rulePage,
      };
      previewMutationRef.current({ data: payload }).then(result => {
        if (sequence === previewRequestSequence.current) {
          setPreview(result);
          setPreviewSignature(requestKey);
        }
      }).catch(() => {
        if (sequence === previewRequestSequence.current) setPreview(null);
      }).finally(() => {
        if (sequence === previewRequestSequence.current) setPreviewRequestPending(false);
      });
    }, 60);
    return () => {
      window.clearTimeout(timer);
      previewRequestSequence.current += 1;
    };
  }, [ruleInputsValid, previewBaseSignature, ruleBaseSignature, previewSignatureKey, supplier, incoming, destination, ruleSearch, ruleStatus, rulePage, previewRefresh]);

  const clearIndividualSelection = () => {
    setSelectedSource(null);
    setSelectedCatalog(null);
    setIndividualIdentityChecked(false);
    setIndividualUnitChecked(false);
    setReceipt(null);
  };

  const save = async () => {
    const kind: CenterProposalInput["kind"] = workflow === "rule" ? "rule" : "individual";
    if (kind === "rule" && !canSaveRule) return;
    if (kind === "individual" && !canSaveIndividual) return;
    const data: CenterProposalInput = kind === "rule" ? {
      kind, supplier, incoming: incoming.trim(), destination: destination.trim(),
      reason: reason.trim(), identityChecked: true, unitChecked: true,
    } : {
      kind, supplier: selectedSource!.supplier, originalSku: selectedSource!.sku,
      catalogKey: selectedCatalog!.key, reason: individualReason,
      identityChecked: true, unitChecked: true,
    };
    setWriteError("");
    setReceipt(null);
    try {
      const saved = await saveProposal.mutateAsync({ data });
      setReceipt(saved);
      await queryClient.invalidateQueries({ queryKey: getListCenterProposalsQueryKey() });
      await proposals.refetch();
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : "Proposal could not be saved. No mapping was activated.");
    }
  };

  const switchWorkflow = (next: Workflow) => {
    setWorkflow(next);
    setReason("");
    setReceipt(null);
    setWriteError("");
    if (next === "rule") clearIndividualSelection();
  };

  return <main className="sku-mapping-center" data-testid="page-sku-mapping-center">
    <header className="center-header">
      <div className="center-heading">
        <h1>SKU Mapping Center</h1>
        <p>Top Speed Hobbies <span>·</span> Inventory Sync</p>
      </div>
      <Link href="/sku-mappings" className="center-back-link" data-testid="link-back-mapping-manager"><ArrowLeft size={15} /> Mapping Manager</Link>
    </header>

    <section className="center-stats" aria-label="Mapping overview">
      {config.isLoading ? <div className="center-stat-skeleton" aria-label="Loading mapping summary"><i /><i /><i /></div> : config.isError
        ? <div className="center-inline-error" role="alert">Mapping summary unavailable. <button onClick={() => void config.refetch()}>Retry</button></div>
        : <>
          <Stat label="Manufacturer rules" value={config.data?.ruleCount ?? "—"} note="Current rules" />
          <Stat label="Rejected mappings" value={config.data?.rejectedCount ?? "—"} note="Reported records" />
          <Stat label="Protected holds" value={config.data?.heldCount ?? "—"} note="Remain protected" />
        </>}
    </section>

    <nav className="center-workflow-tabs" aria-label="Mapping workflows">
      <button type="button" aria-pressed={workflow === "rule"} className={workflow === "rule" ? "selected" : ""} onClick={() => switchWorkflow("rule")} data-testid="tab-manufacturer-rules">
        <GitBranch size={19} /><span><strong>Manufacturer Rules</strong><small>Primary · For entire SKU patterns</small></span>{workflow === "rule" && <em>Selected</em>}
      </button>
      <button type="button" aria-pressed={workflow === "individual"} className={workflow === "individual" ? "selected" : ""} onClick={() => switchWorkflow("individual")} data-testid="tab-fix-individual">
        <Wrench size={19} /><span><strong>Fix Individual SKU</strong><small>Fallback · Correct one product</small></span>{workflow === "individual" && <em>Selected</em>}
      </button>
    </nav>

    {workflow === "rule" ? <>
      <section className="center-panel rule-editor">
        <div className="center-panel-heading">
          <div><h2>Manufacturer Prefix Rule</h2><p>Preserve the original supplier SKU; replace only the exact leading prefix.</p></div>
          <span className="center-tag primary-tag">Primary workflow</span>
        </div>
        <div className="center-form-grid">
          <label className="center-field"><span>Supplier scope</span>
            <select value={supplier} onChange={event => { setSupplier(event.target.value); setRulePage(1); }} data-testid="select-center-supplier">
              <option value="">All suppliers</option>
              {(config.data?.suppliers ?? []).map(name => <option key={name} value={name}>{name}</option>)}
            </select><small>Supplier list is supplied dynamically.</small>
          </label>
          <div className="center-prefix-fields">
            <label className="center-field"><span>Incoming supplier prefix</span><input value={incoming} maxLength={30} onChange={event => { setIncoming(event.target.value); setRulePage(1); }} placeholder="Prefix" data-testid="input-incoming-prefix" /></label>
            <label className="center-field"><span>Destination catalog prefix</span><input value={destination} maxLength={30} onChange={event => { setDestination(event.target.value); setRulePage(1); }} placeholder="Prefix" data-testid="input-destination-prefix" /></label>
          </div>
        </div>
        <div className="center-transformation" aria-live="polite">
          <span>RULE TRANSFORMATION</span>
          <strong><b>{incoming.trim() || "Incoming"}</b><ArrowRight size={22} /><b>{destination.trim() || "Destination"}</b></strong>
          <small>Only an exact leading prefix is replaced. Separators and remaining SKU text are retained.</small>
        </div>
        <div className="center-future-note"><span><ShieldCheck size={15} /> Future supplier imports</span><small>Would apply only after an independently verified approval. Activation is unavailable.</small></div>
        <button className="center-primary-button" type="button" disabled={!ruleInputsValid || isPreviewPending} onClick={startPreview} data-testid="button-preview-center-rule">
          <Search size={15} /> {isPreviewPending ? "Preparing preview…" : "Preview affected products"}
        </button>
        {!ruleInputsValid && <p className="center-control-hint">Enter both prefixes (1–30 characters) to prepare a server-side preview.</p>}
        {previewMutation.isError && <div className="center-inline-error" role="alert">Could not prepare the preview. <button onClick={startPreview}>Retry</button></div>}
      </section>

      <section className="center-panel">
        <div className="center-panel-heading">
          <div><h2>Product Match Preview</h2><p>Compare source and historical catalog records before saving an inactive proposal.</p></div>
          {currentPreview && <span className="center-tag">{currentPreview.affected.toLocaleString()} affected</span>}
        </div>
        <div className="center-toolbar">
          <label className="center-search"><Search size={15} /><input value={ruleSearchDraft} onChange={event => {
            setRuleSearchDraft(event.target.value); setRulePage(1); setPreview(null); setPreviewSignature("");
            setRuleIdentityChecked(false); setRuleUnitChecked(false);
            setReceipt(null);
          }} placeholder="Search SKU or product title" aria-label="Search preview" data-testid="input-center-preview-search" /></label>
          <label className="center-filter"><span>Status</span><select value={ruleStatus} onChange={event => { setRuleStatus(event.target.value as PreviewStatus); setRulePage(1); setRuleIdentityChecked(false); setRuleUnitChecked(false); setReceipt(null); }} data-testid="select-center-preview-status">{statusChoices.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
        {currentPreview ? <>
          {currentPreview.conflicts.length > 0 && <div className="center-conflicts"><AlertTriangle size={14} /><span><strong>{currentPreview.conflicts.length} {currentPreview.conflicts.length === 1 ? "conflict" : "conflicts"} detected</strong> · {currentPreview.conflicts.slice(0, 3).join(" · ")}{currentPreview.conflicts.length > 3 ? " · More conflicts are included in the preview." : ""}</span></div>}
          <ResultRows rows={currentPreview.items} emptyLabel="No records match these preview filters." />
          <Pager page={currentPreview.page} totalPages={currentPreview.totalPages} disabled={isPreviewPending} onPage={setRulePage} />
          <p className="center-preview-meta">{currentPreview.total.toLocaleString()} source records in this view · {currentPreview.affected.toLocaleString()} affected records</p>
        </> : isPreviewPending
          ? <div className="center-loading"><i /><i /><i /></div>
          : <div className="center-empty"><Search size={19} /><strong>Preview required</strong><span>Set both prefixes, then preview the affected products. Changes to the rule or filters clear this preview.</span></div>}
        <div className="center-checks">
          <label><input type="checkbox" checked={ruleIdentityChecked} disabled={!currentPreview} onChange={event => setRuleIdentityChecked(event.target.checked)} data-testid="check-center-rule-identity" /> I checked manufacturer and product identity in the comparison.</label>
          <label><input type="checkbox" checked={ruleUnitChecked} disabled={!currentPreview} onChange={event => setRuleUnitChecked(event.target.checked)} data-testid="check-center-rule-unit" /> I checked scale, size, and selling unit / pack quantity.</label>
        </div>
        <label className="center-field center-reason"><span>Reason for proposed rule <b>Required · at least 12 characters</b></span><textarea value={reason} onChange={event => { setReason(event.target.value); setReceipt(null); }} rows={3} maxLength={2000} placeholder="Describe the evidence supporting this exact prefix relationship." data-testid="input-center-reason" /></label>
        <div className="center-safety-note"><LockKeyhole size={16} /><span><strong>Approval unavailable</strong>{config.data?.approvalBlocker || "Historical catalog matches are unverified. Rules cannot be approved or activated from this catalog."} No inventory or Shopify changes are made.</span></div>
        <div className="center-actions">
          <button type="button" className="center-secondary-button" disabled data-testid="button-approve-center-rule" title={config.data?.approvalBlocker || "Historical catalog cannot verify product identity."}>Approve manufacturer rule</button>
          <button type="button" className="center-primary-button" disabled={!canSaveRule || saveProposal.isPending} onClick={() => void save()} data-testid="button-save-center-rule">{saveProposal.isPending ? "Saving proposal…" : "Save proposed rule"}</button>
        </div>
        <p className="center-control-hint align-right">A saved proposal is private, inactive, and does not change mappings.</p>
      </section>
    </> : <>
      <section className="center-panel individual-editor">
        <div className="center-panel-heading">
          <div><h2>Individual SKU Correction</h2><p>Use when a manufacturer rule cannot correctly resolve one source product.</p></div>
          <span className="center-tag fallback-tag">Fallback workflow</span>
        </div>
        <label className="center-field"><span>Search supplier SKU or product title</span>
          <div className="center-search"><Search size={15} /><input value={sourceSearchDraft} onChange={event => {
            setSourceSearchDraft(event.target.value); setSourcePage(1);
            setPreselectSku("");
            clearIndividualSelection(); setReason(""); setWriteError("");
          }} placeholder="Search supplier feed…" data-testid="input-center-source-search" /></div>
          <small>Searches imported supplier records. Enter at least 2 characters.</small>
        </label>
        <label className="center-field center-source-scope"><span>Supplier filter</span>
          <select value={supplier} onChange={event => { setSupplier(event.target.value); setSourcePage(1); setPreselectSku(""); clearIndividualSelection(); setReason(""); }} data-testid="select-center-source-supplier">
            <option value="">All suppliers</option>
            {(config.data?.suppliers ?? []).map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      {sourceSearch.length >= 2 && <div className="center-choice-list" aria-live="polite">
          {sourceQuery.isLoading ? <div className="center-list-state">Searching supplier records…</div>
            : sourceQuery.isError ? <div className="center-list-state error">Supplier records unavailable. <button onClick={() => void sourceQuery.refetch()}>Retry</button></div>
            : sourceQuery.data?.items.length ? sourceQuery.data.items.map((source, index) => <button type="button" key={`${source.supplier}-${source.sku}-${index}`} className={`center-choice ${selectedSource?.supplier === source.supplier && selectedSource.sku === source.sku ? "selected" : ""}`} onClick={() => {
              setPreselectSku("");
              setSelectedSource(source); setSelectedCatalog(null); setIndividualIdentityChecked(false); setIndividualUnitChecked(false); setReceipt(null);
            }} data-testid={`button-select-center-source-${index}`}>
              <span className="center-radio">{selectedSource?.supplier === source.supplier && selectedSource.sku === source.sku && <Check size={12} />}</span>
              <span><strong className="center-mono">{source.sku}</strong><small>{source.title || "No supplier title supplied"} · {source.supplier}</small></span>
              {selectedSource?.supplier === source.supplier && selectedSource.sku === source.sku && <em>Selected</em>}
            </button>)
            : <div className="center-list-state">No imported supplier records match this search.</div>}
          {sourceQuery.data && sourceQuery.data.totalPages > 1 && <Pager page={sourceQuery.data.page} totalPages={sourceQuery.data.totalPages} disabled={sourceQuery.isFetching} onPage={setSourcePage} />}
          {sourceQuery.data && <small className="center-result-count">{sourceQuery.data.total.toLocaleString()} matching source records</small>}
        </div>}
        {selectedSource && <div className="center-side-by-side">
          <div className="center-product-card">
            <span className="center-product-kicker">Supplier product</span><strong className="center-mono">{selectedSource.sku}</strong>
            <span>{selectedSource.title || "No supplier title supplied"}</span><small>{selectedSource.supplier} · imported source</small>
          </div>
          <ArrowRightLeft className="center-compare-arrow" size={17} />
          <div className="center-product-card catalog-card">
            <span className="center-product-kicker">Proposed catalog product</span>
            {selectedCatalog ? <><strong className="center-mono">{selectedCatalog.sku}</strong><span>{selectedCatalog.title}</span><small>{selectedCatalog.vendor || "Vendor unavailable"} · historical · unverified</small></>
              : <><strong className="center-muted">Choose a historical destination</strong><span>Not selected</span><small>Historical catalog only</small></>}
          </div>
        </div>}
        <label className="center-field center-catalog-field"><span>Choose historical catalog destination</span>
          <div className="center-search"><Search size={15} /><input value={catalogSearchDraft} onChange={event => {
            setCatalogSearchDraft(event.target.value); setSelectedCatalog(null); setIndividualIdentityChecked(false); setIndividualUnitChecked(false); setReceipt(null);
          }} placeholder="Search historical catalog by SKU, title, or vendor" data-testid="input-center-catalog-search" /></div>
          <small>Historical October 5 catalog. Search results are actual catalog records; no live catalog requests.</small>
        </label>
        {catalogSearch.length >= 2 && <div className="center-choice-list center-catalog-results" aria-live="polite">
          {catalogQuery.isLoading ? <div className="center-list-state">Searching historical catalog…</div>
            : catalogQuery.isError ? <div className="center-list-state error">Historical catalog search unavailable. <button onClick={() => void catalogQuery.refetch()}>Retry</button></div>
            : catalogQuery.data?.source !== "historical" || catalogQuery.data.verified ? <div className="center-list-state error">Catalog provenance could not be confirmed. Results are hidden.</div>
            : catalogQuery.data.items.length ? catalogQuery.data.items.slice(0, 50).map(item => <button type="button" key={item.key} disabled={item.skuStatus !== "unique"} className={`center-choice ${selectedCatalog?.key === item.key ? "selected" : ""}`} onClick={() => {
              if (item.skuStatus !== "unique") return;
              setSelectedCatalog({ key: item.key, sku: item.sku, title: item.title, vendor: item.vendor, skuStatus: item.skuStatus }); setIndividualIdentityChecked(false); setIndividualUnitChecked(false); setReceipt(null);
            }} data-testid={`button-select-center-catalog-${item.key}`}>
              <span className="center-radio">{selectedCatalog?.key === item.key && <Check size={12} />}</span>
              <span><strong>{item.title}</strong><small className="center-mono">{item.sku || "No SKU"} · {item.vendor || "Vendor unavailable"}</small></span>
              <em>{item.skuStatus === "unique" ? "Unique SKU" : `${item.skuStatus} · unavailable`}</em>
            </button>)
            : <div className="center-list-state">No historical catalog products match this search.</div>}
        </div>}
        <section className="center-verification">
          <h3><ShieldCheck size={15} /> Product verification</h3>
          <label><input type="checkbox" checked={individualIdentityChecked} disabled={!selectedSource || !selectedCatalog} onChange={event => setIndividualIdentityChecked(event.target.checked)} data-testid="check-center-individual-identity" /> I compared the manufacturer, SKU, and product identity.</label>
          <label><input type="checkbox" checked={individualUnitChecked} disabled={!selectedSource || !selectedCatalog} onChange={event => setIndividualUnitChecked(event.target.checked)} data-testid="check-center-individual-unit" /> I checked scale, size, and selling unit or pack quantity.</label>
          <small>Historical title similarity is not identity verification.</small>
        </section>
        <IndividualCorrectionReasonField choice={individualReasonChoice} other={individualOtherReason}
          onChoice={value => { setIndividualReasonChoice(value); setReceipt(null); }}
          onOther={value => { setIndividualOtherReason(value); setReceipt(null); }} />
        <div className="center-safety-note"><LockKeyhole size={16} /><span><strong>Protected and unverified</strong>A historical catalog selection is only a proposed match. Rejected mappings and protected holds remain blocked. No activation or publishing is possible.</span></div>
        <div className="center-actions">
          <button type="button" className="center-primary-button" disabled={!canSaveIndividual || saveProposal.isPending} onClick={() => void save()} data-testid="button-save-center-individual">{saveProposal.isPending ? "Saving proposal…" : "Save proposed individual correction"}</button>
        </div>
        <p className="center-control-hint align-right">Saved proposals remain inactive and do not alter existing review decisions.</p>
      </section>
    </>}

    {!authorized && <div className="center-auth-hint"><LockKeyhole size={14} /><span>Only an authorized reviewer can save a private proposal. Sign in to continue.</span><ReviewerSignIn /></div>}
    {writeError && <div className="center-write-error" role="alert">{writeError}</div>}
    {receipt && <section className="center-receipt" role="status" data-testid="status-center-proposal-receipt">
      <Check size={17} /><div><strong>{receipt.active ? "Proposal saved · verify status" : "Inactive proposal saved"}</strong><span>Reference {receipt.id} · {new Date(receipt.createdAt).toLocaleString()} · State: {receipt.state}</span>
      <small>Private development journal · {receipt.active ? "unexpected active flag returned" : "inactive"} · no inventory or publishing changes · SHA-256 {receipt.sha256}</small></div>
    </section>}

    <section className="center-panel center-history">
      <div className="center-panel-heading"><div><h2>Saved proposals</h2><p>Private reviewer journal · inactive proposals only</p></div><span className="center-tag">Latest 50</span></div>
      {!authorized ? <div className="center-list-state">Sign in as an authorized reviewer to view private proposal history.</div>
        : proposals.isLoading ? <div className="center-loading compact"><i /><i /></div>
          : proposals.isError ? <div className="center-list-state error">Could not load proposal history. <button onClick={() => void proposals.refetch()}>Retry</button></div>
            : proposals.data?.items.length ? <div className="center-history-list">{proposals.data.items.map(item => <article key={item.id} data-testid={`row-center-proposal-${item.id}`}>
              <div><strong>{item.summary}</strong><small>{item.kind === "rule" ? "Manufacturer rule proposal" : "Individual SKU proposal"} · {new Date(item.createdAt).toLocaleString()}</small></div><span className="center-badge">{statusLabel(item.state)}</span>
            </article>)}</div>
              : <div className="center-list-state">No saved proposals yet.</div>}
    </section>
    <footer className="center-footer"><CircleHelp size={14} /><span>Historical catalog is unverified. This center never approves rules, activates mappings, changes inventory, or publishes to Shopify.</span></footer>
  </main>;
}
