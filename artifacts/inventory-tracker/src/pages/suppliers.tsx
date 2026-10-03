import * as React from "react"
import { useState, useRef } from "react"
import { useListSuppliers, useImportSupplierUpdate, useRefreshHobbyTymeInventory, useRefreshHeartlandInventory, getListSuppliersQueryKey, getListActivityQueryKey, getGetDashboardQueryKey, getListInventoryQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@radix-ui/react-label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { UploadCloud, CheckCircle2, AlertCircle, FileText, ArrowRight, X, RefreshCw } from "lucide-react"
import { useGetWalthersRefreshStatus, useRefreshWalthersInventory, getGetWalthersRefreshStatusQueryKey, getListInventoryGroupsQueryKey } from "@workspace/api-client-react"
import { useGetMmdRefreshStatus, useRefreshMmdInventory, getGetMmdRefreshStatusQueryKey } from "@workspace/api-client-react"

type CsvRow = Record<string, string>

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"' && quoted && next === '"') {
      field += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === "," && !quoted) {
      row.push(field.trim())
      field = ""
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1
      row.push(field.trim())
      if (row.some((cell) => cell.length > 0)) rows.push(row)
      row = []
      field = ""
    } else {
      field += char
    }
  }

  row.push(field.trim())
  if (row.some((cell) => cell.length > 0)) rows.push(row)
  return rows
}

function rowsToObjects(rows: string[][]): { headers: string[]; rows: CsvRow[] } {
  const headers = (rows[0] ?? []).map((header, index) =>
    header || `Column ${index + 1}`,
  )
  return {
    headers,
    rows: rows.slice(1).map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    ),
  }
}

export default function Suppliers() {
  const { data: suppliers, isLoading } = useListSuppliers({
    query: { queryKey: getListSuppliersQueryKey(), staleTime: 30_000, refetchInterval: 60_000 },
  })
  const queryClient = useQueryClient()
  const lastCompletedMmdRefresh = useRef<string | null>(null)
  const { data: mmdJob } = useGetMmdRefreshStatus({
    query: {
      queryKey: getGetMmdRefreshStatusQueryKey(),
      refetchInterval: (query) => query.state.data?.state === "running" ? 3_000 : 60_000,
    },
  })
  const mmdMutation = useRefreshMmdInventory({
    mutation: {
      onSuccess: (job) => {
        queryClient.setQueryData(getGetMmdRefreshStatusQueryKey(), job)
        queryClient.invalidateQueries({ queryKey: getGetMmdRefreshStatusQueryKey() })
      },
    },
  })
  React.useEffect(() => {
    if (mmdJob?.state !== "complete" || !mmdJob.startedAt || lastCompletedMmdRefresh.current === String(mmdJob.startedAt)) return
    lastCompletedMmdRefresh.current = String(mmdJob.startedAt)
    for (const key of [getListSuppliersQueryKey(), getListActivityQueryKey(), getGetDashboardQueryKey(), getListInventoryQueryKey(), getListInventoryGroupsQueryKey()]) {
      queryClient.invalidateQueries({ queryKey: key })
    }
  }, [mmdJob, queryClient])
  const lastCompletedWalthersRefresh = useRef<string | null>(null)
  const { data: walthersJob } = useGetWalthersRefreshStatus({
    query: {
      queryKey: getGetWalthersRefreshStatusQueryKey(),
      refetchInterval: (query) => query.state.data?.state === "running" ? 3_000 : 60_000,
    },
  })
  const walthersMutation = useRefreshWalthersInventory({
    mutation: {
      onSuccess: (job) => {
        queryClient.setQueryData(getGetWalthersRefreshStatusQueryKey(), job)
        queryClient.invalidateQueries({ queryKey: getGetWalthersRefreshStatusQueryKey() })
      },
    },
  })
  React.useEffect(() => {
    if (walthersJob?.state !== "complete" || !walthersJob.startedAt || lastCompletedWalthersRefresh.current === String(walthersJob.startedAt)) return
    lastCompletedWalthersRefresh.current = String(walthersJob.startedAt)
    for (const key of [getListSuppliersQueryKey(), getListActivityQueryKey(), getGetDashboardQueryKey(), getListInventoryQueryKey(), getListInventoryGroupsQueryKey()]) {
      queryClient.invalidateQueries({ queryKey: key })
    }
  }, [walthersJob, queryClient])

  // File Import State
  const [file, setFile] = useState<File | null>(null)
  const [supplierName, setSupplierName] = useState("")
  const [rawRows, setRawRows] = useState<CsvRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [importResult, setImportResult] = useState<any>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  const importMutation = useImportSupplierUpdate({
    mutation: {
      onSuccess: (res) => {
        setImportResult(res)
        // Invalidate all affected queries
        queryClient.invalidateQueries({ queryKey: getListSuppliersQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListActivityQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() })
      },
      onError: (err) => {
        console.error("Import failed", err)
        alert("Failed to import CSV. Check console for details.")
      }
    }
  })

  const hobbyTymeMutation = useRefreshHobbyTymeInventory({
    mutation: {
      onSuccess: (result) => {
        setImportResult(result)
        queryClient.invalidateQueries({ queryKey: getListSuppliersQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListActivityQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() })
      }
    }
  })

  // Required mapping fields for the backend
  const heartlandMutation = useRefreshHeartlandInventory({
    mutation: {
      onSuccess: (result) => {
        setImportResult(result)
        queryClient.invalidateQueries({ queryKey: getListSuppliersQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListActivityQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() })
      },
    },
  })

  const requiredFields = [
    { key: 'sku', label: 'SKU (Required)' },
    { key: 'quantity', label: 'Quantity (Required)' }
  ]
  const optionalFields = [
    { key: 'available', label: 'Available Boolean' },
    { key: 'productName', label: 'Product Name' },
    { key: 'variant', label: 'Variant' },
    { key: 'supplierPrice', label: 'Price' },
    { key: 'eta', label: 'ETA' },
  ]

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return

    setFile(selected)
    setImportResult(null)
    
    const text = await selected.text()
    const parsed = rowsToObjects(parseCsv(text))
    if (parsed.headers.length === 0) return
    const parsedHeaders = parsed.headers
    setHeaders(parsedHeaders)
    
    // Auto-map common headers
    const initialMapping: Record<string, string> = {}
    parsedHeaders.forEach(h => {
      const lower = h.toLowerCase()
      if (lower.includes('sku') || lower.includes('item code') || lower.includes('product code')) initialMapping['sku'] = h
      else if (lower.includes('qty') || lower.includes('quantity') || lower.includes('stock') || lower.includes('available units')) initialMapping['quantity'] = h
      else if (lower.includes('available') || lower.includes('status')) initialMapping['available'] = h
      else if (lower.includes('price')) initialMapping['supplierPrice'] = h
      else if (lower.includes('name') || lower.includes('title')) initialMapping['productName'] = h
      else if (lower.includes('variant') || lower.includes('option')) initialMapping['variant'] = h
      else if (lower.includes('eta') || lower.includes('lead time') || lower.includes('restock')) initialMapping['eta'] = h
      else if (lower.includes('note') || lower.includes('comment')) initialMapping['notes'] = h
    })
    setMapping(initialMapping)
    setRawRows(parsed.rows)
  }

  const handleImport = () => {
    if (!file || !supplierName || !mapping.sku || !mapping.quantity) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsedRows = rowsToObjects(parseCsv(text)).rows
      const skippedRows = parsedRows.filter((row) => !row[mapping.sku]?.trim()).length
      const payloadRows = parsedRows.flatMap((rawRow) => {
        const sku = rawRow[mapping.sku]?.trim()
        if (!sku) return []
        const quantity = Number.parseInt(rawRow[mapping.quantity] ?? "0", 10)
        const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0
        const availableValue = mapping.available
          ? rawRow[mapping.available]?.trim().toLowerCase()
          : ""
        const available = mapping.available
          ? !["no", "false", "out", "out of stock", "unavailable", "0"].includes(availableValue)
          : safeQuantity > 0
        const supplierPrice = mapping.supplierPrice
          ? Number.parseFloat(rawRow[mapping.supplierPrice] ?? "")
          : Number.NaN

        return [{
          sku,
          quantity: safeQuantity,
          available,
          productName: mapping.productName ? rawRow[mapping.productName] || null : null,
          variant: mapping.variant ? rawRow[mapping.variant] || null : null,
          supplierPrice: Number.isFinite(supplierPrice) ? supplierPrice : null,
          eta: mapping.eta ? rawRow[mapping.eta] || null : null,
          notes: mapping.notes ? rawRow[mapping.notes] || null : null,
          raw: rawRow,
        }]
      })

      importMutation.mutate({
        data: {
          supplier: supplierName,
          fileName: file.name,
          columnMapping: mapping,
          sourceRowCount: parsedRows.length,
          skippedRows,
          rows: payloadRows
        }
      })
    }
    reader.readAsText(file)
  }

  const resetFlow = () => {
    setFile(null)
    setRawRows([])
    setHeaders([])
    setMapping({})
    setImportResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Supplier Operations</h2>
          <p className="text-sm text-muted-foreground">Manage suppliers and import inventory updates.</p>
        </div>
        <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => mmdMutation.mutate()}
          disabled={mmdMutation.isPending || mmdJob?.state === "running"}
          className="gap-2"
          data-testid="button-refresh-mmd"
        >
          <RefreshCw className={`h-4 w-4 ${mmdMutation.isPending || mmdJob?.state === "running" ? "animate-spin" : ""}`} />
          {mmdMutation.isPending || mmdJob?.state === "running" ? "Refreshing MMD/Squadron..." : "Refresh MMD/Squadron"}
        </Button>
        <Button
          onClick={() => walthersMutation.mutate()}
          disabled={walthersMutation.isPending || walthersJob?.state === "running"}
          className="gap-2"
          data-testid="button-refresh-walthers"
        >
          <RefreshCw className={`h-4 w-4 ${walthersMutation.isPending || walthersJob?.state === "running" ? "animate-spin" : ""}`} />
          {walthersMutation.isPending || walthersJob?.state === "running" ? "Refreshing Walthers..." : "Refresh Walthers"}
        </Button>
        <Button
          onClick={() => heartlandMutation.mutate()}
          disabled={heartlandMutation.isPending}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${heartlandMutation.isPending ? "animate-spin" : ""}`} />
          {heartlandMutation.isPending ? "Refreshing Heartland..." : "Refresh Heartland"}
        </Button>
        <Button
          onClick={() => hobbyTymeMutation.mutate()}
          disabled={hobbyTymeMutation.isPending}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${hobbyTymeMutation.isPending ? "animate-spin" : ""}`} />
          {hobbyTymeMutation.isPending ? "Refreshing HobbyTyme..." : "Refresh HobbyTyme"}
        </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground" data-testid="text-heartland-refresh-schedule">
        Heartland inventory refreshes automatically every 30 minutes while the server is running. You can also refresh it manually at any time.
      </p>
      <p className="text-sm text-muted-foreground" data-testid="text-walthers-refresh-schedule">
        Walthers inventory refreshes automatically every hour while the server is running. You can also refresh it manually at any time. Quantities remain in Walthers product units; store SKU and pack-size mappings are not assumed.
      </p>
      <p className="text-sm text-muted-foreground" data-testid="text-mmd-refresh-schedule">
        MMD/Squadron inventory refreshes automatically every hour while the server is running, using its stock export and authenticated dealer catalog. You can also refresh it manually at any time. Prefix mappings and pack-size rules are not applied.
      </p>
      {mmdJob?.state === "running" && (
        <div role="status" className="rounded-md border bg-muted/30 p-4 text-sm" data-testid="text-mmd-progress">
          Downloading MMD/Squadron inventory and checking dealer prices: {mmdJob.fetchedRows.toLocaleString()} catalog products checked against {mmdJob.totalRows ? mmdJob.totalRows.toLocaleString() : "…"} stock-export SKUs. This may take several minutes; you may leave this page while it continues.
        </div>
      )}
      {mmdJob?.state === "complete" && mmdJob.result && (
        <div role="status" className="rounded-md border border-success/30 bg-success/5 p-4 text-sm" data-testid="text-mmd-success">
          MMD/Squadron refreshed: {mmdJob.result.updated.toLocaleString()} independent supplier SKUs imported. Other suppliers were preserved.
          {mmdJob.warning && <p className="mt-2 font-medium text-amber-800">{mmdJob.warning}</p>}
        </div>
      )}
      {(mmdMutation.isError || mmdJob?.state === "failed") && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm" data-testid="text-mmd-error">
          MMD/Squadron could not be refreshed. Previous inventory was preserved. {mmdJob?.state === "failed" ? mmdJob.error : mmdMutation.error?.message}
        </div>
      )}
      {walthersJob?.state === "running" && (
        <div role="status" className="rounded-md border bg-muted/30 p-4 text-sm" data-testid="text-walthers-progress">
          Downloading Walthers dealer inventory: {walthersJob.fetchedRows.toLocaleString()} of {walthersJob.totalRows ? walthersJob.totalRows.toLocaleString() : "…"} records. This can take several minutes; you may leave this page while the import continues.
        </div>
      )}
      {walthersJob?.state === "complete" && walthersJob.result && (
        <div role="status" className="rounded-md border border-success/30 bg-success/5 p-4 text-sm" data-testid="text-walthers-success">
          Walthers refreshed: {walthersJob.result.updated.toLocaleString()} supplier SKUs imported. Heartland and HobbyTyme inventory was preserved.
          {walthersJob.warning && <p className="mt-2 font-medium text-amber-800">{walthersJob.warning}</p>}
        </div>
      )}
      {(walthersMutation.isError || walthersJob?.state === "failed") && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Walthers could not be refreshed. Previous supplier inventory has been preserved. {walthersJob?.state === "failed" ? walthersJob.error : walthersMutation.error?.message}
        </div>
      )}

      {heartlandMutation.isError && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Heartland could not be refreshed. Previous supplier inventory has been preserved. {heartlandMutation.error.message}
        </div>
      )}

      {hobbyTymeMutation.isError && (
        <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          HobbyTyme could not be refreshed. Confirm the export credentials in project Secrets and try again.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Suppliers List */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Active Suppliers</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="animate-pulse flex flex-col gap-4">
                <div className="h-12 bg-muted rounded"></div>
                <div className="h-12 bg-muted rounded"></div>
              </div>
            ) : suppliers?.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">No suppliers found. Import a file to create one.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>SKUs</TableHead>
                    <TableHead>Last Update</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers?.map(s => (
                    <TableRow key={s.name}>
                      <TableCell className="font-semibold text-primary">{s.name}</TableCell>
                      <TableCell className="font-mono">{s.skuCount}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.lastUpdate ? new Date(s.lastUpdate).toLocaleDateString() : 'Never'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* CSV Import Flow */}
        <Card className="border-primary/20 shadow-md">
          <CardHeader className="bg-primary/5 border-b pb-4">
            <CardTitle className="flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-primary" />
              Import Supplier Data
            </CardTitle>
            <CardDescription>
              Upload a CSV from any wholesaler. Map the columns on the next step.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            {!file ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Supplier Name</Label>
                  <Input 
                    placeholder="e.g. Acme Wholesale" 
                    value={supplierName} 
                    onChange={e => setSupplierName(e.target.value)} 
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>CSV File</Label>
                  <div 
                    className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FileText className="w-8 h-8 text-muted-foreground mb-4" />
                    <p className="text-sm font-medium">Click to select CSV file</p>
                    <p className="text-xs text-muted-foreground mt-1">Accepts any column structure.</p>
                  </div>
                  <input 
                    type="file" 
                    accept=".csv" 
                    className="hidden" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                  />
                </div>
              </div>
            ) : !importResult ? (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center justify-between bg-muted/50 p-3 rounded-md border">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium truncate max-w-[200px]">{file.name}</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={resetFlow}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <div className="space-y-4">
                  <div className="flex items-end justify-between border-b pb-2">
                    <h4 className="text-sm font-semibold">Map Columns</h4>
                    <span className="text-xs font-mono text-muted-foreground">{rawRows.length} source rows detected</span>
                  </div>
                  <div className="grid gap-4">
                    {requiredFields.map(f => (
                      <div key={f.key} className="grid grid-cols-2 gap-4 items-center">
                        <Label className="text-sm font-medium text-muted-foreground">{f.label}</Label>
                        <Select 
                          value={mapping[f.key] || ""} 
                          onValueChange={(v) => setMapping(prev => ({...prev, [f.key]: v}))}
                        >
                          <SelectTrigger className={!mapping[f.key] ? "border-warning bg-warning/5" : ""}>
                            <SelectValue placeholder="Select column..." />
                          </SelectTrigger>
                          <SelectContent>
                            {headers.map(h => (
                              <SelectItem key={h} value={h}>{h}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                    <div className="pt-2">
                      <p className="text-xs text-muted-foreground mb-2">Optional Fields</p>
                      {optionalFields.map(f => (
                        <div key={f.key} className="grid grid-cols-2 gap-4 items-center mb-2">
                          <Label className="text-xs text-muted-foreground">{f.label}</Label>
                          <Select 
                            value={mapping[f.key] || "none"} 
                            onValueChange={(v) => {
                              if (v === "none") {
                                const newMapping = {...mapping}
                                delete newMapping[f.key]
                                setMapping(newMapping)
                              } else {
                                setMapping(prev => ({...prev, [f.key]: v}))
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Ignore" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">-- Ignore --</SelectItem>
                              {headers.map(h => (
                                <SelectItem key={h} value={h}>{h}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Source preview</h4>
                    <span className="text-xs text-muted-foreground">All columns are preserved</span>
                  </div>
                  <div className="overflow-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {headers.slice(0, 5).map((header) => <TableHead key={header}>{header}</TableHead>)}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rawRows.slice(0, 5).map((row, rowIndex) => (
                          <TableRow key={rowIndex}>
                            {headers.slice(0, 5).map((header) => (
                              <TableCell key={header} className="max-w-40 truncate text-xs">{row[header] || "—"}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
                
                <div className="pt-4 border-t flex justify-end gap-2">
                  <Button variant="outline" onClick={resetFlow}>Cancel</Button>
                  <Button 
                    onClick={handleImport} 
                    disabled={!mapping.sku || !mapping.quantity || importMutation.isPending}
                    className="gap-2"
                  >
                    {importMutation.isPending ? "Processing..." : "Process Import"}
                    {!importMutation.isPending && <ArrowRight className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6 text-center py-4 animate-in zoom-in-95 duration-300">
                <div className="w-16 h-16 bg-success/20 text-success rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-semibold">Import Complete</h3>
                
                <div className="grid grid-cols-2 gap-4 text-left p-4 bg-muted/30 rounded-lg border">
                  <div>
                    <p className="text-xs text-muted-foreground">Total Rows</p>
                    <p className="text-lg font-mono font-bold">{importResult.totalRows}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Matched (Updated)</p>
                    <p className="text-lg font-mono font-bold text-success">{importResult.matched}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Unmatched</p>
                    <p className="text-lg font-mono font-bold text-warning">{importResult.unmatched}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Skipped</p>
                    <p className="text-lg font-mono font-bold">{importResult.skipped}</p>
                  </div>
                </div>
                
                {importResult.unmatchedSkus && importResult.unmatchedSkus.length > 0 && (
                  <div className="text-left text-sm">
                    <p className="font-semibold text-warning mb-1 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      Unmatched SKUs ({importResult.unmatchedSkus.length})
                    </p>
                    <div className="bg-background border rounded p-2 max-h-32 overflow-y-auto font-mono text-xs text-muted-foreground">
                      {importResult.unmatchedSkus.join(", ")}
                    </div>
                  </div>
                )}
                
                <Button onClick={resetFlow} className="w-full" variant="outline">
                  Import Another File
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
