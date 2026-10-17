import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileSpreadsheet,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  downloadMatrixifyWorkbook,
  getGetMatrixifyStatusQueryKey,
  getGetReviewerSessionQueryKey,
  getRetrieveMatrixifyPreviewPageQueryKey,
  useCreateMatrixifyPreview,
  useGetMatrixifyStatus,
  useGetReviewerSession,
  useRetrieveMatrixifyPreviewPage,
} from "@workspace/api-client-react";
import type {
  MatrixifyDownloadInputProfile,
  MatrixifyPreview,
  RetrieveMatrixifyPreviewPageParams,
} from "@workspace/api-client-react";
import { ReviewerSignIn } from "@/lib/clerk-host";
import "./matrixify.css";

type PreviewView = "changes" | "exceptions";
const requiredColumns = [
  "ID",
  "Variant ID",
  "Variant SKU",
  "Variant Price",
  "Variant Inventory Tracker",
  "Title", "Vendor", "Status",
  "Option1 Name", "Option1 Value",
  "Inventory Available: EXACT LOCATION",
  "Inventory Committed: EXACT LOCATION",
];

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function isExpired(error: unknown) {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === 409);
}

function dateValue(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

export default function Matrixify() {
  const session = useGetReviewerSession({
    query: { queryKey: getGetReviewerSessionQueryKey(), staleTime: 15_000 },
  });
  const authorized = session.data?.configured === true
    && session.data.authenticated
    && session.data.authorized;
  const status = useGetMatrixifyStatus({
    query: {
      queryKey: getGetMatrixifyStatusQueryKey(),
      enabled: authorized,
      staleTime: 20_000,
    },
  });
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [variantIdInput, setVariantIdInput] = useState("");
  const [baselineConfirmed, setBaselineConfirmed] = useState(false);
  const [formError, setFormError] = useState("");
  const [preview, setPreview] = useState<MatrixifyPreview | null>(null);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<PreviewView>("changes");
  const [downloadBusy, setDownloadBusy] = useState<MatrixifyDownloadInputProfile | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [expired, setExpired] = useState(false);
  const createPreview = useCreateMatrixifyPreview();

  const previewParams = useMemo<RetrieveMatrixifyPreviewPageParams>(
    () => ({ previewId: preview?.id ?? "", page, view }),
    [page, view, preview?.id],
  );
  const currentPreview = useRetrieveMatrixifyPreviewPage(previewParams, {
    query: {
      queryKey: getRetrieveMatrixifyPreviewPageQueryKey(previewParams),
      enabled: authorized && Boolean(preview?.id),
      staleTime: 0,
      retry: false,
    },
  });
  const shownPreview = currentPreview.data ?? preview;
  const statusBlockers = status.data?.blockers ?? [];
  const variantIds = useMemo(
    () => variantIdInput.split(/[,\s]+/).map(value => value.trim()).filter(Boolean),
    [variantIdInput],
  );
  const invalidVariantIds = variantIds.filter(id => !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id));
  const invalidVariantIdList = invalidVariantIds.length > 0
    || new Set(variantIds).size !== variantIds.length
    || variantIds.length > 10_000;
  const blockers = shownPreview?.blockers ?? [];
  const expiresAt = shownPreview ? Date.parse(shownPreview.expiresAt) : 0;
  const isPreviewExpired = expired || (Boolean(expiresAt) && expiresAt <= Date.now());
  const canDownloadBase = Boolean(
    authorized && shownPreview && !isPreviewExpired
    && blockers.length === 0 && statusBlockers.length === 0,
  );

  const pickFile = async (selected: File | undefined) => {
    setFormError("");
    setFile(selected ?? null);
    setCsvText("");
    setPreview(null);
    setExpired(false);
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".csv")) {
      setFormError("Choose a CSV export. XLSX files are not accepted for this baseline.");
      setFile(null);
      return;
    }
    if (selected.size > 20_000_000) {
      setFormError("This CSV exceeds the 20 MB request limit.");
      setFile(null);
      return;
    }
    try {
      setCsvText(await selected.text());
    } catch {
      setFormError("The selected CSV could not be read.");
      setFile(null);
    }
  };

  const buildPreview = async () => {
    setFormError("");
    if (!authorized) {
      setFormError("Sign in with an allowlisted reviewer account before creating a preview.");
      return;
    }
    if (!file || !csvText || !observedAt || !baselineConfirmed) {
      setFormError("Select a CSV, enter when it was exported, and confirm the shop and baseline.");
      return;
    }
    if (invalidVariantIdList) {
      setFormError(variantIds.length > 10_000
        ? "Select at most 10,000 ProductVariant GIDs."
        : "Variant IDs must be unique full gid://shopify/ProductVariant/... identifiers.");
      return;
    }
    const timestamp = new Date(observedAt);
    if (Number.isNaN(timestamp.getTime()) || timestamp.getTime() > Date.now()) {
      setFormError("Enter a valid export time that is not in the future.");
      return;
    }
    try {
      const result = await createPreview.mutateAsync({
        data: {
          baselineCsv: csvText,
          baselineObservedAt: timestamp.toISOString(),
          baselineConfirmed: true,
          ...(variantIds.length ? { variantIds } : {}),
        },
      });
      setPreview(result);
      setPage(1);
      setView("changes");
      setExpired(false);
      setDownloadError("");
    } catch (error) {
      setFormError(errorText(error));
    }
  };

  const changePage = (newPage: number) => {
    setPage(Math.max(1, newPage));
    setExpired(false);
  };

  const downloadWorkbook = async (profile: MatrixifyDownloadInputProfile) => {
    if (!shownPreview || !canDownloadBase) return;
    setDownloadBusy(profile);
    setDownloadError("");
    try {
      const blob = await downloadMatrixifyWorkbook(
        { previewId: shownPreview.id, digest: shownPreview.digest, profile },
        { credentials: "include", responseType: "blob" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tsh-matrixify-${profile}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setDownloadError(errorText(error));
      if (isExpired(error)) setExpired(true);
    } finally {
      setDownloadBusy(null);
    }
  };

  const retryPreviewPage = async () => {
    const result = await currentPreview.refetch();
    if (result.error && isExpired(result.error)) setExpired(true);
  };
  const pageRows = shownPreview?.rows ?? [];
  const exceptionRows = shownPreview?.exceptions ?? [];

  return (
    <div className="matrixify-page" data-testid="page-matrixify">
      <section className="matrixify-intro">
        <div>
          <p className="matrixify-eyebrow"><FileSpreadsheet size={15} /> MANUAL EXPORT WORKFLOW</p>
          <h2>Matrixify <em>review</em></h2>
          <p>Prepare separate, owner-reviewed UPDATE workbooks from a fresh Products CSV. This app never sends Shopify writes.</p>
        </div>
        <div className="matrixify-readonly-mark"><ShieldCheck size={18} /><span>Preview + download only</span></div>
      </section>

      {session.isLoading ? (
        <section className="matrixify-panel matrixify-auth-state"><div className="matrixify-skeleton" /><div className="matrixify-skeleton short" /></section>
      ) : session.isError ? (
        <section className="matrixify-notice error" role="alert">
          <AlertTriangle size={19} /><div><strong>Reviewer session unavailable</strong><p>{errorText(session.error)}. Retry to check server-verified authentication.</p>
            <button type="button" onClick={() => void session.refetch()}>Retry session check</button></div>
        </section>
      ) : !session.data?.configured ? (
        <section className="matrixify-notice warning" data-testid="notice-auth-not-configured">
          <LockKeyhole size={19} /><div><strong>Authentication is not configured</strong>
            <p>{session.data?.message || "Set up Clerk on the canonical host and configure server-side reviewer authentication before using mapping approval or Matrixify."}</p>
            {session.data?.subject && <code>Signed-in subject: {session.data.subject}</code>}</div>
        </section>
      ) : !session.data.authenticated ? (
        <section className="matrixify-notice">
          <LockKeyhole size={19} /><div><strong>Reviewer sign-in required</strong><p>The dashboard remains public. Sign-in is required to create Matrixify previews or download workbooks.</p><ReviewerSignIn /></div>
        </section>
      ) : !session.data.authorized ? (
        <section className="matrixify-notice warning">
          <LockKeyhole size={19} /><div><strong>This account is not an authorized reviewer</strong>
            <p>{session.data.message} Ask an owner to allowlist this Clerk subject in <code>MAPPING_REVIEWER_SUBJECTS</code>.</p>
            {session.data.subject && <code className="matrixify-subject">Reviewer subject: {session.data.subject}</code>}</div>
        </section>
      ) : (
        <>
          <section className="matrixify-status-grid" aria-label="Matrixify prerequisites">
            <StatusTile label="Verified catalog" value={status.data ? `${status.data.catalogCount.toLocaleString()} variants` : "Checking"} ready={status.data?.catalogReady} />
            <StatusTile label="Inventory policy" value={status.data?.policyReady ? "Configured" : "Blocked"} ready={status.data?.policyReady} />
            <StatusTile label="Supplier metafields" value={status.data?.metafieldsReady ? "Evidence ready" : "Read-only definition needed"} ready={status.data?.metafieldsReady} />
            <StatusTile label="Price updates" value={status.data?.pricingApproved ? "Owner approved" : "Preserve current price"} ready={status.data?.pricingApproved} />
          </section>

          {status.isLoading && <div className="matrixify-loading"><span /> Checking server configuration and verified catalog…</div>}
          {status.isError && <div className="matrixify-notice error" role="alert"><AlertTriangle size={18} /><div><strong>Prerequisites could not be loaded</strong><p>{errorText(status.error)}</p><button type="button" onClick={() => void status.refetch()}>Retry</button></div></div>}
          {status.data && (statusBlockers.length > 0 || status.data.catalogCount === 0) && (
            <section className="matrixify-blockers" data-testid="panel-matrixify-blockers">
              <h3><AlertTriangle size={17} /> Backend prerequisites</h3>
              {statusBlockers.length ? <ul>{statusBlockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}</ul> : <p>Verified catalog is empty. No demo catalog or ready state is substituted.</p>}
              <p>{status.data.policySummary}</p>
              <small>Shop: {status.data.shopDomain || "Not configured"}{status.data.locationName ? ` · Exact inventory location: ${status.data.locationName}` : ""}</small>
            </section>
          )}

          <section className="matrixify-panel matrixify-source-panel">
            <header className="matrixify-panel-heading"><div><span className="matrixify-step">01</span><div><p>OWNER-SUPPLIED SOURCE</p><h3>Choose a fresh Matrixify Products CSV</h3></div></div><span className="file-limit">CSV · 20 MB max</span></header>
            <label className="matrixify-file-picker">
              <FileSpreadsheet size={20} />
              <span><strong>{file?.name ?? "Select a Products export"}</strong><small>{file ? `${(file.size / 1024).toFixed(1)} KB · read in this browser only` : "CSV only. This file is sent for a temporary preview, never imported into the database."}</small></span>
              <input type="file" accept=".csv,text/csv" data-testid="input-matrixify-csv" onChange={(event) => void pickFile(event.currentTarget.files?.[0])} />
            </label>
            <div className="matrixify-columns">
              <strong>Required baseline columns</strong>
              <div>{requiredColumns.map((column) => <code key={column}>{column}</code>)}</div>
              <small>Use the exact inventory location returned by the server. Export time is entered manually; file metadata is not used as provenance.</small>
            </div>
            <div className="matrixify-form-row">
              <label>Export observed at<input type="datetime-local" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} data-testid="input-baseline-observed-at" /></label>
              <label className="matrixify-confirm"><input type="checkbox" checked={baselineConfirmed} onChange={(event) => setBaselineConfirmed(event.target.checked)} data-testid="check-confirm-matrixify-baseline" />
                <span>I confirm this is a fresh Products export from <strong>{status.data?.shopDomain || "the configured shop"}</strong>, and the timestamp above is when it was observed.</span></label>
            </div>
            <label className="matrixify-batch-field">Optional controlled batch — ProductVariant GIDs
              <textarea value={variantIdInput} onChange={event => setVariantIdInput(event.target.value)} rows={3} placeholder={"gid://shopify/ProductVariant/…\nOne full variant GID per line, up to 10,000"} data-testid="input-matrixify-variant-ids" />
              <small>{variantIds.length ? `${variantIds.length.toLocaleString()} unique variant IDs selected` : "Omit to preview all variants. Baseline identity and catalog checks always cover the full export."} · {variantIds.length > 10_000 ? "Limit exceeded." : invalidVariantIds.length ? `${invalidVariantIds.length} invalid GID(s).` : "No quantity defaults are inferred."}</small>
            </label>
            {formError && <p className="matrixify-form-error" role="alert">{formError}</p>}
            <button className="matrixify-primary" type="button" onClick={() => void buildPreview()} disabled={!authorized || createPreview.isPending || !file || !observedAt || !baselineConfirmed} data-testid="button-build-matrixify-preview">
              {createPreview.isPending ? <><RefreshCw size={15} className="matrixify-spin" /> Validating CSV…</> : <><Check size={16} /> Build read-only preview</>}
            </button>
          </section>

          {shownPreview && (
            <section className="matrixify-panel matrixify-preview-panel" data-testid="panel-matrixify-preview">
              <header className="matrixify-panel-heading">
                <div><span className="matrixify-step">02</span><div><p>REVIEW BEFORE MANUAL IMPORT</p><h3>{shownPreview.shopDomain} <span>·</span> {shownPreview.locationName || "Location not configured"}</h3></div></div>
                <button className="matrixify-quiet-button" type="button" onClick={() => void buildPreview()} disabled={createPreview.isPending}><RefreshCw size={14} /> Recompute preview</button>
              </header>
              <div className="matrixify-metrics">
                <Metric label="Variants checked" value={shownPreview.counts.variants} />
                <Metric label="Inventory rows" value={shownPreview.counts.inventoryRows} />
                <Metric label="Supplier metadata" value={shownPreview.counts.metafieldRows} />
                <Metric label="Price rows" value={shownPreview.counts.priceRows} />
                <Metric label="Exceptions" value={shownPreview.counts.exceptions} caution={shownPreview.counts.exceptions > 0} />
              </div>
              <div className="matrixify-preview-meta"><span><Clock3 size={14} /> Expires {dateValue(shownPreview.expiresAt)}</span><span>Preview digest <code>{shownPreview.digest}</code></span><span>{shownPreview.totalRows} rows in this view</span></div>
              {isPreviewExpired && <div className="matrixify-notice error"><AlertTriangle size={17} /><div><strong>This preview is stale or expired</strong><p>Create a fresh preview from the owner-supplied export before downloading.</p></div></div>}
              {blockers.length > 0 && <div className="matrixify-blockers compact"><h3><AlertTriangle size={16} /> Downloads blocked</h3><ul>{blockers.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
              {shownPreview.warnings.length > 0 && <div className="matrixify-warnings"><strong><CircleHelp size={15} /> Review notes</strong><ul>{shownPreview.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></div>}
              <div className="matrixify-tabs" role="tablist" aria-label="Preview rows">
                <button role="tab" aria-selected={view === "changes"} onClick={() => { setView("changes"); changePage(1); }}>Changes <b>{shownPreview.totalRows}</b></button>
                <button role="tab" aria-selected={view === "exceptions"} onClick={() => { setView("exceptions"); changePage(1); }}>Exceptions <b>{shownPreview.counts.exceptions}</b></button>
                {currentPreview.isFetching && <span>Updating page…</span>}
              </div>
              {currentPreview.isError && <div className="matrixify-notice error" role="alert"><AlertTriangle size={17} /><div><strong>{isExpired(currentPreview.error) ? "Preview expired" : "Preview page could not be loaded"}</strong><p>{errorText(currentPreview.error)} {isExpired(currentPreview.error) ? "Recompute a fresh preview to continue." : ""}</p><button type="button" onClick={() => void retryPreviewPage()}>Retry page</button></div></div>}
              {view === "changes" ? (
                pageRows.length === 0 ? <div className="matrixify-empty">No changed rows on this page. Unchanged values are omitted to avoid overwriting live data.</div> : (
                  <div className="matrixify-table-wrap"><table className="matrixify-table"><thead><tr><th>Product / variant</th><th>SKU</th><th>Inventory · before → proposed</th><th>Price · before → proposed</th><th>Supplier evidence · separately</th></tr></thead>
                    <tbody>{pageRows.map((item) => <tr key={item.variantId}><td><strong>{item.title || "Untitled product"}</strong><small>{item.variantId}</small></td><td><code>{item.sku || "—"}</code></td><td>{item.beforeQuantity ?? "—"} <span>→</span> <strong>{item.afterQuantity ?? "—"}</strong></td><td>{item.beforePrice ?? "—"} <span>→</span> <strong>{item.afterPrice ?? "Preserve"}</strong></td><td><ul>{item.supplierSummary.map((summary, index) => <li key={`${index}-${summary}`}>{summary}</li>)}</ul></td></tr>)}</tbody>
                  </table></div>
                )
              ) : (
                exceptionRows.length === 0 ? <div className="matrixify-empty">No exceptions on this page.</div> : (
                  <div className="matrixify-table-wrap"><table className="matrixify-table exception-table"><thead><tr><th>Variant ID</th><th>Exception</th><th>Supplier</th><th>Original supplier SKU</th></tr></thead><tbody>
                    {exceptionRows.map((item, index) => <tr key={`${item.variantId}-${item.code}-${index}`}><td><code>{item.variantId}</code></td><td><strong>{item.code}</strong></td><td>{item.supplier ?? "—"}</td><td><code>{item.originalSku ?? "—"}</code></td></tr>)}
                  </tbody></table></div>
                )
              )}
              <footer className="matrixify-pagination"><span>Page {shownPreview.page} of {Math.max(shownPreview.totalPages, 1)} · 100 per page</span><div>
                <button aria-label="Previous preview page" disabled={page <= 1 || currentPreview.isFetching} onClick={() => changePage(page - 1)}><ChevronLeft size={16} /></button>
                <button aria-label="Next preview page" disabled={page >= shownPreview.totalPages || currentPreview.isFetching} onClick={() => changePage(page + 1)}><ChevronRight size={16} /></button>
              </div></footer>
              <section className="matrixify-downloads">
                <header><div><span className="matrixify-step">03</span><div><p>THREE INDEPENDENT WORKBOOKS</p><h3>Download only the fields you intend to update</h3></div></div></header>
                <p>Each workbook contains only its own update fields, plus TSH Exceptions and TSH Review tabs. Prices default to preserve. Supplier metadata uses proposed merchant-owned <code>tsh_inventory_sync</code> fields only after separate owner approval and definition/theme privacy review. Unlike app-owned fields, these allow other Admin apps access. No definitions or permissions are changed here.</p>
                <div className="matrixify-download-buttons">
                  <DownloadButton label="Inventory UPDATE" detail={`${shownPreview.counts.inventoryRows} changed rows`} profile="inventory" count={shownPreview.counts.inventoryRows} busy={downloadBusy} disabled={!canDownloadBase || currentPreview.isError} onClick={downloadWorkbook} />
                  <DownloadButton label="Supplier metadata UPDATE" detail={`${shownPreview.counts.metafieldRows} changed rows`} profile="supplier_metafields" count={shownPreview.counts.metafieldRows} busy={downloadBusy} disabled={!canDownloadBase || currentPreview.isError} onClick={downloadWorkbook} />
                  <DownloadButton label="Approved price UPDATE" detail={`${shownPreview.counts.priceRows} changed rows`} profile="prices" count={shownPreview.counts.priceRows} busy={downloadBusy} disabled={!canDownloadBase || currentPreview.isError} onClick={downloadWorkbook} />
                </div>
                {downloadError && <p className="matrixify-form-error" role="alert">{downloadError}</p>}
                <div className="matrixify-import-note"><LockKeyhole size={15} /><span>Matrixify <strong>UPDATE</strong> commands only. Downloaded files require a separate manual import by an owner; this app never imports them or sends Shopify writes.</span></div>
              </section>
            </section>
          )}
        </>
      )}
      <p className="matrixify-footnote"><LockKeyhole size={14} /> No database catalog import, Shopify write, automatic retry of approval, or fabricated baseline is performed here.</p>
    </div>
  );
}

function StatusTile({ label, value, ready }: { label: string; value: string; ready?: boolean }) {
  return <article className={`matrixify-status-tile ${ready ? "ready" : "blocked"}`}><span>{label}</span><strong>{value}</strong><small><i />{ready ? "Server verified" : "Needs owner setup"}</small></article>;
}

function Metric({ label, value, caution = false }: { label: string; value: number; caution?: boolean }) {
  return <div className={`matrixify-metric ${caution ? "caution" : ""}`}><strong>{value.toLocaleString()}</strong><span>{label}</span></div>;
}

function DownloadButton({ label, detail, profile, count, busy, disabled, onClick }: {
  label: string;
  detail: string;
  profile: MatrixifyDownloadInputProfile;
  count: number;
  busy: MatrixifyDownloadInputProfile | null;
  disabled: boolean;
  onClick: (profile: MatrixifyDownloadInputProfile) => void;
}) {
  return <button type="button" className="matrixify-download-button" disabled={disabled || count === 0 || busy !== null} onClick={() => onClick(profile)} data-testid={`button-download-${profile}`}>
    {busy === profile ? <RefreshCw size={16} className="matrixify-spin" /> : <ArrowDownToLine size={16} />}
    <span><strong>{label}</strong><small>{detail}</small></span>
  </button>;
}
