import { Fragment, useEffect, useMemo, useState } from "react"
import {
  getGetInventoryGroupQueryKey,
  getListInventoryGroupsQueryKey,
  useGetInventoryGroup,
  useListInventoryGroups,
} from "@workspace/api-client-react"
import type { InventoryGroup, ListInventoryGroupsParams } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { AlertCircle, ChevronLeft, ChevronRight, CircleHelp, Database, PackageSearch, RefreshCw, Search, Store, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SkuManufacturerLabel } from "@/components/sku-manufacturer-label"
import { getSkuManufacturer } from "@/lib/sku-manufacturer"
import "./inventory-groups.css"

const showQty = (qty: number | null, bounded: boolean) => qty === null ? "—" : bounded ? `≥${qty}` : qty.toLocaleString()
const statusName = (status: InventoryGroup["status"]) => status === "available" ? "Available" : status === "unavailable" ? "Unavailable" : "Needs review"

function GroupStatus({ status }: { status: InventoryGroup["status"] }) {
  const variant = status === "available" ? "success" : status === "unavailable" ? "secondary" : "warning"
  return <Badge variant={variant}>{statusName(status)}</Badge>
}

function GroupManufacturer({ group }: { group: InventoryGroup }) {
  const source = group.distributors.find((d) => getSkuManufacturer(d.sourceSku, d.supplier).name) ?? group.distributors[0]
  const prefix = source ? getSkuManufacturer(source.sourceSku, source.supplier).prefix : null
  const variant = group.variant?.trim()
  return <>
    <SkuManufacturerLabel sku={source?.sourceSku ?? ""} supplier={source?.supplier} manufacturerName={source?.manufacturerName} className="subtle-label mt-1" />
    {variant && variant.toLowerCase() !== "default" && variant.toUpperCase() !== prefix &&
      <div className="subtle-label mt-1">Variant: {variant}</div>}
  </>
}

function DistributorBreakdown({ group }: { group: InventoryGroup }) {
  return <div className="pt-3">
    <div className="mb-2 flex items-center justify-between gap-3">
      <div className="inventory-kicker">Distributor feed breakdown</div>
      <span className="subtle-label">Location labels are proposed, not assigned in Shopify</span>
    </div>
    {group.distributors.map((d, i) => <div className="supplier-line" key={`${d.supplier}-${d.sourceSku}-${i}`}>
      <div>
        <div className="text-sm font-semibold">{d.supplier}</div>
        <SkuManufacturerLabel sku={d.sourceSku} supplier={d.supplier} manufacturerName={d.manufacturerName} className="subtle-label mt-1" />
        <div className="mt-1 flex flex-wrap items-center gap-1.5"><span className="subtle-label">{d.locationName}</span><Badge variant="outline" className="h-5 border-amber-300 bg-amber-50 px-1.5 text-[10px] text-amber-900">Not assigned</Badge></div>
      </div>
      <div className="supplier-source">
        <div className="subtle-label">Original supplier SKU</div>
        <div className="sku-value text-[12px]">{d.sourceSku}</div>
      </div>
      <div className="text-right">
        <div className="sku-value">{showQty(d.reportedQuantity, d.boundedQuantity)}</div>
        <div className="subtle-label">{d.boundedQuantity ? "Feed lower bound" : "Reported quantity"}</div>
      </div>
      <div className="supplier-price text-right">
        <div className="sku-value">{d.wholesalePrice == null ? "—" : `$${d.wholesalePrice.toFixed(2)}`}</div>
        <div className="subtle-label">Wholesale</div>
      </div>
      {d.countedQuantity !== null && <div className="subtle-label">Counted quantity: {showQty(d.countedQuantity, d.boundedQuantity)}</div>}
      {d.supplierStatus && <div className="subtle-label">Feed status: {d.supplierStatus}</div>}
      {d.mappingConflict && <div className="subtle-label text-amber-800">SKU mapping collision — quantity cannot be fully combined</div>}
      {d.supplierUpdatedAt && <div className="subtle-label">{new Date(d.supplierUpdatedAt).toLocaleString()}</div>}
    </div>)}
    {group.missingSuppliers.length > 0 && <div className="mt-3 rounded-md border border-dashed border-amber-300 bg-amber-50/70 p-3">
      <div className="flex gap-2 text-sm font-semibold text-amber-950"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />No matching feed record</div>
      <p className="subtle-label mt-1 text-amber-900">These distributors did not provide a matching record for this product. This is unknown availability, not zero stock.</p>
      <div className="mt-2 flex flex-wrap gap-2">{group.missingSuppliers.map((name) => <Badge key={name} variant="outline" className="border-amber-300 bg-transparent">{name}</Badge>)}</div>
    </div>}
  </div>
}

function InventoryGroupDetail({ groupKey, onClose }: { groupKey: string | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const query = useGetInventoryGroup(groupKey ?? "", {
    query: { enabled: !!groupKey, queryKey: getGetInventoryGroupQueryKey(groupKey ?? ""), staleTime: 30_000, refetchInterval: groupKey ? 60_000 : false },
  })
  const detail = query.data
  const group = detail?.item
  return <Dialog open={!!groupKey} onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="grouped-inventory max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <div className="inventory-kicker">Grouped distributor inventory</div>
        <DialogTitle className="text-xl">{group?.mappedStoreSku ?? group?.sku ?? "Loading product…"}</DialogTitle>
        <DialogDescription>{group?.productName}{group?.variant ? ` · ${group.variant}` : ""}. Proposed distributor stock total pending Shopify product matching and location assignment.</DialogDescription>
        {group && <GroupManufacturer group={group} />}
        {group && <Button className="w-fit" size="sm" variant="outline" onClick={async () => {
          await query.refetch()
          await queryClient.invalidateQueries({ queryKey: getListInventoryGroupsQueryKey() })
        }} disabled={query.isFetching} data-testid="button-refresh-group-detail"><RefreshCw className={`mr-2 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />Refresh detail</Button>}
      </DialogHeader>
      {query.isLoading ? <div className="space-y-3 py-4" aria-label="Loading distributor details"><div className="h-16 animate-pulse rounded-md bg-muted" /><div className="h-28 animate-pulse rounded-md bg-muted" /></div>
        : query.isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 p-4">
          <p className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" />Distributor detail could not be loaded</p>
          <Button className="mt-3" variant="outline" onClick={() => query.refetch()}>Retry</Button>
        </div> : group ? <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="shadow-none"><CardContent className="p-4">
              <div className="subtle-label">Proposed feed total</div>
              <div className="mt-1 quantity-value">{group.distributorTotal === null ? "Unknown" : showQty(group.distributorTotal, group.boundedQuantity)}</div>
              {group.distributorTotal === null && <div className="subtle-label mt-1">Known subtotal: {showQty(group.knownSubtotal, group.boundedQuantity)} · partial only</div>}
            </CardContent></Card>
            <Card className="shadow-none"><CardContent className="p-4">
              <div className="flex items-center gap-1.5 subtle-label"><Store className="h-3.5 w-3.5" />Live Shopify sellable</div>
              <div className="mt-1 quantity-value">{group.shopifySellableStock === null ? "—" : group.shopifySellableStock}</div>
              <div className="subtle-label mt-1">{group.shopifySellableStock === null ? "Unavailable until connected and matched" : "Verified store quantity"}</div>
            </CardContent></Card>
            <Card className="shadow-none"><CardContent className="p-4">
              <div className="subtle-label">Store SKU mapping</div>
              <div className="mt-1 sku-value">{group.mappedStoreSku ?? "No candidate"}</div>
              <div className="subtle-label mt-1">{group.mappingState === "candidate" ? "Candidate only · not verified" : group.mappingState === "conflict" ? "Mapping conflict" : "Unmapped"}</div>
            </CardContent></Card>
          </div>
          <div className="rounded-md border border-[#dce7e7] bg-[#f5f9f8] p-3 text-sm leading-relaxed text-[#49605f]">
            This is a proposed distributor-location stock total, not live Shopify inventory. Store product matching and actual location assignment are still required; no Shopify stock has been changed.
          </div>
          <DistributorBreakdown group={group} />
        </div> : null}
    </DialogContent>
  </Dialog>
}

export default function InventoryGroups() {
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "")
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const [status, setStatus] = useState<NonNullable<ListInventoryGroupsParams["status"]>>("all")
  const [supplier, setSupplier] = useState("all")
  const [page, setPage] = useState(1)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const url = new URL(window.location.href)
    if (search.trim()) url.searchParams.set("search", search.trim())
    else url.searchParams.delete("search")
    window.history.replaceState({}, "", url)
  }, [search])
  useEffect(() => { setPage(1) }, [debouncedSearch, status, supplier])

  const params = useMemo<ListInventoryGroupsParams>(() => ({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(status && status !== "all" ? { status } : {}),
    ...(supplier !== "all" ? { supplier } : {}),
    page,
    pageSize: 25,
  }), [debouncedSearch, status, supplier, page])
  const list = useListInventoryGroups(params, {
    query: { queryKey: getListInventoryGroupsQueryKey(params), staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: false },
  })
  const data = list.data
  useEffect(() => {
    if (data && data.page !== page) setPage(data.page)
  }, [data, page])
  const items = data?.items ?? []
  const first = data && data.total ? (data.page - 1) * data.pageSize + 1 : 0
  const last = data ? Math.min(data.page * data.pageSize, data.total) : 0
  const noFilters = !debouncedSearch && status === "all" && supplier === "all"

  return <div className="grouped-inventory space-y-5">
    <div className="flex flex-col gap-4 border-b border-[#dce5e8] pb-5 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="inventory-kicker mb-2">Distributor stock · grouped view</div>
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">One row per converted SKU candidate, with every contributing distributor visible.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void list.refetch()} disabled={list.isFetching} data-testid="button-refresh-grouped-inventory">
          <RefreshCw className={`mr-2 h-4 w-4 ${list.isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>
    </div>

    <div className="grid gap-3 rounded-lg border border-[#dce5e8] bg-[#f4f8f8] p-4 md:grid-cols-[minmax(240px,1.4fr)_minmax(170px,.7fr)_minmax(170px,.7fr)] md:items-end">
      <label className="space-y-1.5 text-xs font-semibold text-[#536979]">
        Find a product
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input data-testid="input-grouped-inventory-search" maxLength={200} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product or either SKU" className="bg-background pl-9 pr-9" />
          {search && <button type="button" aria-label="Clear search" data-testid="button-clear-grouped-search" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>}
        </div>
      </label>
      <label className="space-y-1.5 text-xs font-semibold text-[#536979]">Availability
        <Select value={status} onValueChange={(value) => setStatus(value as NonNullable<ListInventoryGroupsParams["status"]>)}>
          <SelectTrigger aria-label="Filter availability" data-testid="select-grouped-status" className="bg-background"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="available">Available</SelectItem><SelectItem value="unavailable">Unavailable</SelectItem><SelectItem value="review">Needs review</SelectItem></SelectContent>
        </Select>
      </label>
      <label className="space-y-1.5 text-xs font-semibold text-[#536979]">Distributor
        <Select value={supplier} onValueChange={setSupplier}>
          <SelectTrigger aria-label="Filter distributor" data-testid="select-grouped-supplier" className="bg-background"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All distributors</SelectItem>{(data?.suppliers ?? []).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
        </Select>
      </label>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span data-testid="text-grouped-inventory-total"><span className="font-mono font-semibold text-foreground">{(data?.total ?? 0).toLocaleString()}</span> product groups · distributor filter limits groups, not contributors to each total</span>
      {data?.publishing && <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-900"><Database className="h-3.5 w-3.5" />Shopify publishing unavailable</span>}
    </div>

    {data?.publishing && <div className="rounded-md border border-[#dce7e7] bg-white px-3.5 py-3 text-sm text-[#566b78]">
      <div className="flex items-start gap-2"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-[#527b77]" /><div><p><strong className="text-[#263d4c]">Feed preview only.</strong> Distributor quantities are proposed for locations and are not currently matched or assigned in Shopify. Live Shopify sellable totals are unavailable{data.publishing.blockingReason ? `: ${data.publishing.blockingReason}` : "."} No inventory is being synced.</p>
        {data.publishing.prerequisites.length > 0 && <p className="mt-1.5 text-xs">Before publishing: {data.publishing.prerequisites.join(" · ")}</p>}
      </div></div>
    </div>}

    {list.isError ? <Card className="border-destructive/25 bg-destructive/[.025]"><CardContent className="flex flex-col items-center py-12 text-center">
      <AlertCircle className="h-8 w-8 text-destructive" /><h2 className="mt-3 font-semibold">Inventory groups could not be loaded</h2><p className="mt-1 max-w-md text-sm text-muted-foreground">The distributor stock list is temporarily unavailable. Your filters are preserved; try again.</p><Button className="mt-4" variant="outline" onClick={() => void list.refetch()}>Retry</Button>
    </CardContent></Card> : list.isLoading ? <div className="space-y-2" aria-label="Loading inventory groups">{[0,1,2,3,4].map((i) => <div key={i} className="h-[76px] animate-pulse rounded-md border border-[#e1e9eb] bg-[#f4f8f8]" />)}</div> :
      items.length === 0 ? <Card className="border-dashed"><CardContent className="flex flex-col items-center py-14 text-center">
        <PackageSearch className="h-9 w-9 text-[#799297]" /><h2 className="mt-3 font-semibold">{noFilters ? "No distributor inventory yet" : "No product groups found"}</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{noFilters ? "Once supplier feeds are imported, full converted SKU candidates will appear here." : "Try a different search or widen the filters. Distributor records with no match are not treated as zero stock."}</p>
        {!noFilters && <Button variant="outline" className="mt-4" onClick={() => { setSearch(""); setStatus("all"); setSupplier("all") }}>Clear filters</Button>}
      </CardContent></Card> : <div className="group-table-wrap">
        <table className="group-table">
          <thead><tr><th>Converted SKU candidate</th><th>Product</th><th>Proposed feed total</th><th>Shopify sellable</th><th>Status</th><th className="text-right">Details</th></tr></thead>
          <tbody>{items.map((group) => {
            const totalText = group.distributorTotal === null ? "Unknown" : showQty(group.distributorTotal, group.boundedQuantity)
            return <Fragment key={group.groupKey}><tr data-testid={`row-inventory-group-${group.groupKey}`}>
              <td>
                <button type="button" className="sku-value text-left text-primary underline-offset-4 hover:underline" onClick={() => setSelectedKey(group.groupKey)} data-testid={`button-group-details-${group.groupKey}`}>{group.mappedStoreSku ?? group.sku}</button>
                <div className="mt-1 subtle-label">
                  Supplier SKUs: {[...new Set(group.distributors.map((d) => d.sourceSku))].join(" · ")}
                  {group.mappingState === "candidate" ? " · candidate, not verified" : group.mappingState === "conflict" ? " · mapping conflict" : ""}
                </div>
              </td>
              <td><div className="max-w-[260px] font-medium leading-snug">{group.productName}</div><GroupManufacturer group={group} /></td>
              <td>
                <button type="button" className="text-left" onClick={() => setExpandedKey(expandedKey === group.groupKey ? null : group.groupKey)} aria-expanded={expandedKey === group.groupKey} aria-label={`Toggle distributor breakdown for ${group.mappedStoreSku ?? group.sku}`}>
                  <span className={`quantity-value ${group.distributorTotal === null ? "text-amber-800" : ""}`}>{totalText}</span>
                  <span className="subtle-label block">{group.distributorTotal === null ? `Known subtotal ${showQty(group.knownSubtotal, group.boundedQuantity)} · partial` : `${new Set(group.distributors.map((d) => d.supplier)).size} distributor${new Set(group.distributors.map((d) => d.supplier)).size === 1 ? "" : "s"}`} · {expandedKey === group.groupKey ? "Hide breakdown" : "Show breakdown"}</span>
                </button>
              </td>
              <td><span className="quantity-value text-[#7c8991]">{group.shopifySellableStock === null ? "—" : group.shopifySellableStock}</span><span className="subtle-label block">{group.shopifySellableStock === null ? "Shopify: unavailable" : "Live sellable"}</span></td>
              <td><GroupStatus status={group.status} /></td>
              <td className="text-right"><Button size="sm" variant="outline" onClick={() => setSelectedKey(group.groupKey)} data-testid={`button-group-open-${group.groupKey}`}>Details</Button></td>
            </tr>{expandedKey === group.groupKey && <tr><td colSpan={6} className="!px-5 !py-4 !bg-[#fbfdfd]"><DistributorBreakdown group={group} /></td></tr>}</Fragment>
          })}</tbody>
        </table>
      </div>}

    {!list.isLoading && !list.isError && items.length > 0 && <div className="flex flex-col gap-3 border-t border-[#dce5e8] pt-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-muted-foreground" data-testid="text-grouped-inventory-range">Showing {first.toLocaleString()}–{last.toLocaleString()} of {(data?.total ?? 0).toLocaleString()}</span>
      <div className="flex items-center justify-end gap-2">
        <span className="mr-2 text-sm text-muted-foreground">Page {data?.page ?? page} of {data?.totalPages ?? 1}</span>
        <Button variant="outline" size="icon" aria-label="Previous inventory page" data-testid="button-group-previous-page" disabled={list.isFetching || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" aria-label="Next inventory page" data-testid="button-group-next-page" disabled={list.isFetching || page >= (data?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>}
    <InventoryGroupDetail groupKey={selectedKey} onClose={() => setSelectedKey(null)} />
  </div>
}