import { MANUFACTURERS } from "./manufacturer-prefixes"
import { HEARTLAND_MANUFACTURERS } from "./heartland-manufacturer-prefixes"

const knownPrefixes = Object.keys(MANUFACTURERS).sort((a, b) => b.length - a.length)
const heartlandPrefixes = [...HEARTLAND_MANUFACTURERS.keys()].sort((a, b) => b.length - a.length)

export function getSkuManufacturer(sku: string, supplier?: string | null, sourceName?: string | null): { prefix: string | null; name: string | null; sharedPrefix?: boolean } {
  const identifier = sku.trim().toUpperCase()
  if (sourceName?.trim()) return { prefix: identifier.match(/^([A-Z0-9+]+)[/:\s_-]/)?.[1] ?? null, name: sourceName.trim() }
  if (supplier === "Walthers") return { prefix: identifier.match(/^([A-Z0-9+]+)[/:\s_-]/)?.[1] ?? null, name: null }
  if (supplier === "Heartland Hobby Wholesale") {
    // Heartland part numbers can start with letters (AANA103), and the
    // six-character RMXCCN code must take precedence over RMX.
    const knownPrefix = heartlandPrefixes.find((prefix) => identifier.startsWith(prefix))
    const prefix = knownPrefix ?? identifier.match(/^([A-Z+]+)(?=\d|[/:\s_-]|$)/)?.[1] ?? null
    const names = prefix ? HEARTLAND_MANUFACTURERS.get(prefix) : undefined
    return { prefix, name: names?.join(" / ") ?? null, sharedPrefix: Boolean(names && names.length > 1) }
  }
  const separatedPrefix = identifier.match(/^([A-Z0-9+]+)[/:\s_-]/)?.[1]
  const knownCompactPrefix = knownPrefixes
    .find((prefix) => identifier.startsWith(prefix) && /^\d/.test(identifier.slice(prefix.length)))
  const prefix = separatedPrefix ?? knownCompactPrefix ?? identifier.match(/^([A-Z+]+)(?=\d)/)?.[1] ?? null
  return { prefix, name: prefix ? MANUFACTURERS[prefix] ?? null : null }
}