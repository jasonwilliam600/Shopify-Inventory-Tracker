import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCenterProposal, getGetCenterProposalQueryKey, getListCenterProposalsQueryKey,
  useUpdateCenterProposal, useDeleteCenterProposal, useSearchMappingCatalog, getSearchMappingCatalogQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { IndividualCorrectionReasonField, INDIVIDUAL_CORRECTION_REASONS, resolveIndividualReason } from "@/lib/individual-correction-reason";
import type { IndividualCorrectionReason } from "@/lib/individual-correction-reason";

export function duplicateProposalId(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const data = error.data;
  return data && typeof data === "object" && "existingId" in data && typeof data.existingId === "string" ? data.existingId : null;
}

export function MappingProposalDetails({ id, onClose, onOpenExisting, returnFocus }: {
  id: string; onClose: () => void; onOpenExisting: (id: string) => void; returnFocus: () => void;
}) {
  const queryClient = useQueryClient();
  const detail = useGetCenterProposal(id, { query: { queryKey: getGetCenterProposalQueryKey(id), staleTime: 0 } });
  const update = useUpdateCenterProposal(), remove = useDeleteCenterProposal();
  const [editing, setEditing] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  const [searchDraft, setSearchDraft] = useState(""), [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<{ key: string; sku: string; title: string } | null>(null);
  const [choice, setChoice] = useState<IndividualCorrectionReason>(INDIVIDUAL_CORRECTION_REASONS[0]);
  const [other, setOther] = useState(""), [identity, setIdentity] = useState(false), [units, setUnits] = useState(false);
  const [error, setError] = useState(""), [duplicate, setDuplicate] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editRevision, setEditRevision] = useState(0);
  const [deleteRevision, setDeleteRevision] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);
  const params = { search, source: "historical" as const };
  const results = useSearchMappingCatalog(params, { query: {
    queryKey: getSearchMappingCatalogQueryKey(params), enabled: editing && search.length >= 2,
  } });
  const data = detail.data;
  const busy = update.isPending || remove.isPending;
  const editable = data?.state === "proposed" && data.active === false;
  const reason = resolveIndividualReason(choice, other);
  const startEdit = () => {
    if (!data || !editable || data.kind !== "individual") return;
    setCatalog(data.catalogSku ? { key: data.catalogKey, sku: data.catalogSku, title: data.catalogTitle ?? "" } : null);
    const known = INDIVIDUAL_CORRECTION_REASONS.find(item => item === data.reason && item !== "Other reason");
    setChoice(known ?? "Other reason"); setOther(known ? "" : data.reason);
    setIdentity(data.identityChecked); setUnits(data.unitChecked); setEditRevision(data.revision);
    setSearchDraft(""); setSearch(""); setError(""); setDuplicate(null); setMessage(""); setEditing(true);
  };
  const refreshList = () => queryClient.invalidateQueries({ queryKey: getListCenterProposalsQueryKey() });
  const save = async () => {
    if (!catalog || !reason || !identity || !units || !editable) return;
    setError(""); setDuplicate(null);
    try {
      const saved = await update.mutateAsync({ id, data: { revision: editRevision, catalogKey: catalog.key,
        reason, identityChecked: identity, unitChecked: units } });
      queryClient.setQueryData(getGetCenterProposalQueryKey(id), saved);
      setEditing(false); setMessage("Inactive proposal updated. No mapping was activated."); await refreshList();
    } catch (e) {
      setDuplicate(duplicateProposalId(e));
      setError(e instanceof Error ? e.message : "Proposal could not be updated. Reload details before retrying.");
    }
  };
  const deleteProposal = async () => {
    if (!data || !editable) return;
    setError("");
    try {
      await remove.mutateAsync({ id, data: { revision: deleteRevision, confirmed: true } });
      queryClient.removeQueries({ queryKey: getGetCenterProposalQueryKey(id) });
      await refreshList(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Deletion failed. No confirmation of deletion was received."); }
  };
  const shown = (value: string | null | undefined) => value || "Not recorded";
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sku-mapping-center center-proposal-modal"
      onCloseAutoFocus={event => { event.preventDefault(); returnFocus(); }}
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <DialogTitle>Saved proposal details</DialogTitle>
      <DialogDescription>Private, inactive proposal only. No approval, mapping activation, or Shopify publishing.</DialogDescription>
      {detail.isLoading ? <p role="status">Loading proposal…</p> : detail.isError ? <div role="alert">
        Could not load this private proposal. <button onClick={() => void detail.refetch()}>Retry</button>
      </div> : data && <>
        <dl className="center-proposal-facts">
          <div><dt>Supplier</dt><dd>{shown(data.supplier)}</dd></div>
          <div><dt>Original supplier SKU</dt><dd>{shown(data.originalSku)}</dd></div>
          <div><dt>Supplier product title</dt><dd>{shown(data.supplierTitle)}</dd></div>
          <div><dt>Historical catalog SKU</dt><dd>{shown(data.catalogSku)}</dd></div>
          <div><dt>Historical catalog product title</dt><dd>{shown(data.catalogTitle)}</dd></div>
          <div><dt>Correction reason</dt><dd>{data.reason}</dd></div>
          <div><dt>Verification confirmations</dt><dd>Product identity: {data.identityChecked ? "Confirmed" : "Not confirmed"} · Selling unit / package quantity: {data.unitChecked ? "Confirmed" : "Not confirmed"}</dd></div>
          <div><dt>Status</dt><dd>{data.state} · {data.active ? "Active" : "Inactive"} · Revision {data.revision}</dd></div>
          <div><dt>Created</dt><dd>{new Date(data.createdAt).toLocaleString()}</dd></div>
          {data.updatedAt && <div><dt>Last modified</dt><dd>{new Date(data.updatedAt).toLocaleString()}</dd></div>}
          <div><dt>Original reviewer</dt><dd>{shown(data.reviewerSubject)}{data.reviewerIssuer && <small> · {data.reviewerIssuer}</small>}</dd></div>
          <div><dt>Proposal reference</dt><dd>{data.id}</dd></div>
        </dl>
        {message && <p role="status">{message}</p>}
        {editing && <section className="center-proposal-editor" aria-label="Edit inactive proposal">
          <h3>Edit inactive proposal</h3>
          <label className="center-field"><span>Search historical catalog destination</span>
            <input value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="Search by SKU, title, or vendor" />
          </label>
          <p>Selected destination: <strong>{catalog?.sku ?? "None selected"}</strong> · {catalog?.title || "Title not recorded"}</p>
          {searchDraft.trim().length >= 2 && <div className="center-choice-list">
            {search !== searchDraft.trim() || results.isFetching ? <p role="status">Searching historical catalog…</p>
              : results.isError ? <p role="alert">Historical lookup failed. <button onClick={() => void results.refetch()}>Retry</button></p>
              : results.data?.source !== "historical" || results.data.verified ? <p role="alert">Historical provenance could not be confirmed.</p>
              : results.data.items.length ? results.data.items.map(item => <button key={item.key} type="button"
                className={`center-choice ${catalog?.key === item.key ? "selected" : ""}`}
                disabled={item.skuStatus !== "unique"} onClick={() => {
                  if (item.key !== catalog?.key) { setIdentity(false); setUnits(false); }
                  setCatalog({ key: item.key, sku: item.sku, title: item.title });
                }}><span><strong>{item.sku || "Missing SKU"}</strong><small>{item.title}</small></span><em>{item.skuStatus}</em></button>)
                : <p>No matching historical products.</p>}
          </div>}
          <IndividualCorrectionReasonField choice={choice} other={other} onChoice={setChoice} onOther={setOther} />
          <section className="center-verification">
            <h3>Product verification</h3>
            <label><input type="checkbox" checked={identity} disabled={!catalog} onChange={event => setIdentity(event.target.checked)} /> I compared the manufacturer, SKU, and product identity.</label>
            <label><input type="checkbox" checked={units} disabled={!catalog} onChange={event => setUnits(event.target.checked)} /> I checked scale, size, and selling unit or pack quantity.</label>
            <small>Changing the destination clears both confirmations. Historical selections remain unverified.</small>
          </section>
          <div className="center-proposal-controls">
            <button disabled={busy} onClick={() => { setEditing(false); setError(""); setDuplicate(null); }}>Cancel Edit</button>
            <button className="center-primary-button" disabled={busy || !catalog || !reason || !identity || !units} onClick={() => void save()}>{update.isPending ? "Saving…" : "Save Changes"}</button>
          </div>
        </section>}
        {!editing && !confirmDelete && <div className="center-proposal-controls">
          {editable && data.kind === "individual" && <button onClick={startEdit}>Edit Proposal</button>}
          {editable && <button className="center-delete-proposal" onClick={() => { setDeleteRevision(data.revision); setConfirmDelete(true); setMessage(""); setError(""); }}>Delete Proposal</button>}
          <button onClick={onClose}>Close Details</button>
        </div>}
        {confirmDelete && <section className="center-delete-confirmation" role="alertdialog" aria-labelledby="center-delete-title" aria-describedby="center-delete-description">
          <h3 id="center-delete-title">Delete Proposal?</h3>
          <p id="center-delete-description">Supplier SKU: <strong>{data.originalSku || "Not recorded"}</strong> → Proposed destination: <strong>{data.catalogSku || "Not recorded"}</strong>.
            This removes only the inactive proposal from the active list. Its audit history is retained.</p>
          <div className="center-proposal-controls">
            <button autoFocus disabled={busy} onClick={() => { setConfirmDelete(false); setError(""); }}>Cancel</button>
            <button className="center-delete-proposal" disabled={busy} onClick={() => void deleteProposal()}>{remove.isPending ? "Deleting…" : "Confirm Delete"}</button>
          </div>
        </section>}
        <section aria-label="Proposal audit history" className="center-proposal-audit"><h3>Modification history</h3>
          {data.history.map((event, index) => <article key={index}>
            <strong>{event.action} · {new Date(event.at).toLocaleString()}</strong>
            <p>{event.catalogSku || "Destination not recorded"} · {event.catalogTitle || "Title not recorded"}</p>
            <p>{event.reason}</p><small>Reviewer: {shown(event.reviewerSubject)}{event.reviewerIssuer && ` · ${event.reviewerIssuer}`}</small>
          </article>)}
        </section>
      </>}
      {error && <div role="alert" className="center-write-error">{error}
        {duplicate && <button onClick={() => onOpenExisting(duplicate)}>Open existing proposal</button>}
        {!duplicate && <button onClick={() => { setEditing(false); setConfirmDelete(false); void detail.refetch(); }}>Reload Details</button>}
      </div>}
    </DialogContent>
  </Dialog>;
}
