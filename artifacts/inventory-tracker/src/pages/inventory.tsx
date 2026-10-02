import { useState } from "react"
import { useListInventory, useReviewInventoryItem, getListInventoryQueryKey, getGetDashboardQueryKey, useGetInventoryItem, getGetInventoryItemQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Check, Info, Search, AlertTriangle, ArrowRightLeft, X, Box, ChevronLeft, ChevronRight } from "lucide-react"
import React from "react"

export default function Inventory() {
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<25 | 50 | 100 | 250>(100)
  
  // Debounce search
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  React.useEffect(() => {
    setPage(1)
  }, [debouncedSearch, statusFilter, pageSize])

  const params = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter as any } : {}),
    page,
    pageSize,
  }

  const [selectedSku, setSelectedSku] = useState<string | null>(null)
  
  const { data: inventoryPage, isLoading } = useListInventory(params, { 
    query: { queryKey: getListInventoryQueryKey(params) } 
  })
  const inventory = inventoryPage?.items
  const firstResult = inventoryPage && inventoryPage.total > 0
    ? (inventoryPage.page - 1) * inventoryPage.pageSize + 1
    : 0
  const lastResult = inventoryPage
    ? Math.min(inventoryPage.page * inventoryPage.pageSize, inventoryPage.total)
    : 0

  React.useEffect(() => {
    if (inventoryPage && inventoryPage.page !== page) {
      setPage(inventoryPage.page)
    }
  }, [inventoryPage, page])

  const { data: selectedItemDetails, isLoading: detailsLoading } = useGetInventoryItem(selectedSku || "", {
    query: { 
      enabled: !!selectedSku,
      queryKey: getGetInventoryItemQueryKey(selectedSku || "")
    }
  })
  
  const queryClient = useQueryClient()
  const reviewMutation = useReviewInventoryItem({
    mutation: {
      onSuccess: () => {
        setSelectedSku(null)
        // Invalidate affected queries
        queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() })
      }
    }
  })

  const handleReview = (sku: string) => {
    reviewMutation.mutate({ sku, data: { reviewed: true } })
  }

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'ready': return <Badge variant="success">Ready</Badge>
      case 'low': return <Badge variant="warning">Low Stock</Badge>
      case 'unavailable': return <Badge variant="destructive">Unavailable</Badge>
      case 'mismatch': return <Badge variant="warning" className="animate-pulse">Mismatch</Badge>
      case 'pending': return <Badge variant="secondary" className="border-warning border text-warning">Pending Review</Badge>
      default: return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Inventory Master</h2>
          <p className="text-sm text-muted-foreground">Search and review inventory discrepancies.</p>
        </div>
        
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-inventory-search"
              placeholder="Search SKU or Product..." 
              className="pl-9 font-mono"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-inventory-status">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="mismatch">Mismatch</SelectItem>
              <SelectItem value="pending">Pending Review</SelectItem>
              <SelectItem value="low">Low Stock</SelectItem>
              <SelectItem value="unavailable">Unavailable</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <div className="border-b bg-muted/20 p-4 font-mono text-xs text-muted-foreground flex justify-between items-center">
          <span data-testid="text-inventory-total">
            {inventoryPage?.total ?? 0} RECORDS FOUND
          </span>
          <span className="uppercase tracking-wider">Sync Priority: High</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Shopify Stock</TableHead>
              <TableHead>Supplier Stock</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <div className="flex justify-center items-center gap-2 text-muted-foreground">
                    <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                    Loading inventory...
                  </div>
                </TableCell>
              </TableRow>
            ) : inventory?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center font-mono text-sm text-muted-foreground">
                  No records found matching criteria.
                </TableCell>
              </TableRow>
            ) : (
              inventory?.map((item) => (
                <TableRow key={item.sku} className="group">
                  <TableCell className="font-mono text-sm font-medium">{item.sku}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium truncate max-w-[200px]" title={item.productName}>{item.productName}</span>
                      <span className="text-xs text-muted-foreground">{item.variant}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-base">{item.shopifyStock}</span>
                  </TableCell>
                  <TableCell>
                    <span className={`font-mono text-base ${item.supplierStock !== item.shopifyStock ? 'text-warning font-bold' : ''}`}>
                      {item.supplierStock !== null ? item.supplierStock : '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(item.status)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedSku(item.sku)}>
                      Details
                    </Button>
                    {(item.status === 'mismatch' || item.status === 'pending') && (
                      <Button 
                        variant="warning" 
                        size="sm" 
                        className="ml-2"
                        onClick={() => handleReview(item.sku)}
                        disabled={reviewMutation.isPending}
                      >
                        Accept
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="flex flex-col gap-3 border-t bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground" data-testid="text-inventory-range">
            Showing {firstResult.toLocaleString()}–{lastResult.toLocaleString()} of {(inventoryPage?.total ?? 0).toLocaleString()}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={String(pageSize)}
              onValueChange={(value) => setPageSize(Number(value) as 25 | 50 | 100 | 250)}
            >
              <SelectTrigger className="w-[125px]" data-testid="select-inventory-page-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 per page</SelectItem>
                <SelectItem value="50">50 per page</SelectItem>
                <SelectItem value="100">100 per page</SelectItem>
                <SelectItem value="250">250 per page</SelectItem>
              </SelectContent>
            </Select>
            <span className="min-w-[110px] text-center text-sm font-medium" data-testid="text-inventory-page">
              Page {inventoryPage?.page ?? page} of {inventoryPage?.totalPages ?? 1}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={isLoading || page <= 1}
              aria-label="Previous inventory page"
              data-testid="button-inventory-previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((current) => current + 1)}
              disabled={isLoading || page >= (inventoryPage?.totalPages ?? 1)}
              aria-label="Next inventory page"
              data-testid="button-inventory-next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedSku} onOpenChange={(open) => !open && setSelectedSku(null)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Item Details: {selectedSku}</DialogTitle>
            <DialogDescription>
              Detailed view of Shopify vs Supplier data.
            </DialogDescription>
          </DialogHeader>
          
          {detailsLoading ? (
            <div className="py-12 flex justify-center text-muted-foreground">
              <span className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
            </div>
          ) : selectedItemDetails ? (
            <div className="grid gap-6 py-4">
              <div className="flex items-start gap-4">
                {selectedItemDetails.image ? (
                  <img src={selectedItemDetails.image} alt={selectedItemDetails.productName} className="w-16 h-16 object-cover rounded-md border" />
                ) : (
                  <div className="w-16 h-16 bg-muted rounded-md flex items-center justify-center border text-muted-foreground">
                    <Box className="w-8 h-8 opacity-50" />
                  </div>
                )}
                <div>
                  <h4 className="font-semibold text-lg leading-tight">{selectedItemDetails.productName}</h4>
                  <p className="text-muted-foreground text-sm">{selectedItemDetails.variant}</p>
                  <Badge variant="outline" className="mt-2">{selectedItemDetails.category}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Card className="shadow-none border-primary/20 bg-primary/5">
                  <CardContent className="p-4 flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Shopify Record</span>
                    <div className="text-3xl font-mono font-bold">{selectedItemDetails.shopifyStock}</div>
                    <span className="text-xs text-muted-foreground">Available to sell</span>
                  </CardContent>
                </Card>
                
                <Card className={`shadow-none border ${selectedItemDetails.supplierStock !== selectedItemDetails.shopifyStock ? 'border-warning bg-warning/5' : 'border-muted bg-muted/20'}`}>
                  <CardContent className="p-4 flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Supplier Record</span>
                    <div className="text-3xl font-mono font-bold flex items-center gap-2">
                      {selectedItemDetails.supplierStock !== null ? selectedItemDetails.supplierStock : '—'}
                      {selectedItemDetails.supplierStock !== selectedItemDetails.shopifyStock && (
                        <AlertTriangle className="w-5 h-5 text-warning" />
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground truncate" title={selectedItemDetails.supplier || 'Unknown Supplier'}>
                      {selectedItemDetails.supplier || 'Unknown Supplier'}
                    </span>
                  </CardContent>
                </Card>
              </div>

              <div className="text-sm bg-muted/30 p-4 rounded-md border font-mono">
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Supplier ETA:</span>
                  <span>{selectedItemDetails.supplierEta || 'N/A'}</span>
                  
                  <span className="text-muted-foreground">Supplier Price:</span>
                  <span>{selectedItemDetails.supplierPrice ? `$${selectedItemDetails.supplierPrice.toFixed(2)}` : 'N/A'}</span>
                  
                  <span className="text-muted-foreground">Last Updated:</span>
                  <span>{new Date(selectedItemDetails.updatedAt).toLocaleString()}</span>
                </div>
              </div>
            </div>
          ) : (
             <div className="py-8 text-center text-muted-foreground">Item details not found.</div>
          )}

          <DialogFooter>
            {(selectedItemDetails?.status === 'mismatch' || selectedItemDetails?.status === 'pending') && (
              <Button 
                variant="warning" 
                onClick={() => handleReview(selectedItemDetails.sku)}
                disabled={reviewMutation.isPending}
                className="w-full sm:w-auto"
              >
                {reviewMutation.isPending ? "Syncing..." : "Accept Supplier Stock & Sync"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
