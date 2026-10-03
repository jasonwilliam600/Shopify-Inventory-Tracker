import { getSkuManufacturer } from "@/lib/sku-manufacturer"
import { cn } from "@/lib/utils"

/** Resolve the brand from the original identifier, never a converted store SKU. */
export function SkuManufacturerLabel({ sku, supplier, manufacturerName, sourceFields, className }: {
  sku: string
  supplier?: string | null
  manufacturerName?: string | null
  sourceFields?: Record<string, unknown> | null
  className?: string
}) {
  const suppliedName = manufacturerName ?? (typeof sourceFields?.manufacturerName === "string" ? sourceFields.manufacturerName : null)
  const manufacturer = getSkuManufacturer(sku, supplier, suppliedName)
  const label = manufacturer.name ?? (manufacturer.prefix
    ? `Unmapped prefix: ${manufacturer.prefix}`
    : "Unknown")
  return <div className={cn("text-xs text-muted-foreground", className)} data-testid={`text-manufacturer-${supplier}-${sku}`}>
    Manufacturer: {label}
    {manufacturer.sharedPrefix && <span className="block">Shared manufacturer code</span>}
  </div>
}