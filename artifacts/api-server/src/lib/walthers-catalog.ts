import { normalizeWalthersItem, type WalthersItem } from "./walthers-records";

interface Facet { id: string; values: { url: string }[] }
export interface CatalogPage { total: number; items: WalthersItem[]; facets?: Facet[] }
interface Task { filters: Record<string, string>; offset: number; expectedTotal?: number }
const PAGE_SIZE = 100;
const SEARCH_LIMIT = 5_000;
const PARTITIONS = [
  "custitem_walthers_item_brand", "custitem_walthers_item_scale",
  "custitem_walthers_item_web_cat", "custitem_walthers_item_instock",
  "custitem_walthers_item_disc", "custitem_walthers_item_road_name",
];

/** Native single-value facets avoid SuiteCommerce's 5,000-result search cap. */
export async function readWalthersCatalog(
  fetchPage: (filters: Record<string, string>, offset: number, includeFacets: boolean) => Promise<CatalogPage>,
  progress: (fetched: number, total: number) => void,
) {
  const records: WalthersItem[] = [];
  const ids = new Set<number>();
  const tasks: Task[] = [];
  let total = 0;
  let failed = false;

  async function read(task: Task, root = false) {
    const page = await fetchPage(task.filters, task.offset, task.expectedTotal === undefined);
    if (!Number.isSafeInteger(page.total) || page.total < 0 || page.total > 200_000 || !Array.isArray(page.items)) {
      throw new Error("Walthers returned an unexpected catalog response; previous inventory preserved");
    }
    if (root) {
      total = page.total;
      if (!total) throw new Error("Walthers catalog is empty; previous inventory preserved");
      progress(0, total);
    }
    if (task.expectedTotal !== undefined && page.total !== task.expectedTotal) {
      throw new Error("Walthers catalog changed during download; please retry");
    }
    if (page.total > SEARCH_LIMIT) {
      const facet = PARTITIONS
        .filter((key) => !(key in task.filters))
        .map((key) => page.facets?.find((facet) => facet.id === key))
        .find((facet) => facet && Array.isArray(facet.values) && facet.values.length > 1);
      if (!facet || facet.values.some((value) => !value.url)) {
        throw new Error("Walthers search cannot be fully partitioned; previous inventory preserved");
      }
      for (const value of facet.values) {
        tasks.push({ filters: { ...task.filters, [facet.id]: value.url }, offset: 0 });
      }
      return;
    }
    const length = Math.min(PAGE_SIZE, Math.max(0, page.total - task.offset));
    if (page.items.length !== length) throw new Error("Walthers download is incomplete; previous inventory preserved");
    for (const item of page.items) {
      normalizeWalthersItem(item);
      if (ids.has(item.internalid)) throw new Error("Walthers search repeated a product; previous inventory preserved");
      ids.add(item.internalid);
      records.push(item);
    }
    progress(records.length, total);
    if (task.offset === 0) {
      for (let offset = PAGE_SIZE; offset < page.total; offset += PAGE_SIZE) {
        tasks.push({ filters: task.filters, offset, expectedTotal: page.total });
      }
    }
  }

  await read({ filters: {}, offset: 0 }, true);
  const workers = await Promise.allSettled(Array.from({ length: 2 }, async () => {
    while (!failed && tasks.length) {
      const task = tasks.shift()!;
      try { await read(task); }
      catch (error) { failed = true; throw error; }
    }
  }));
  const rejected = workers.find((worker) => worker.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  // Some live products have no manufacturer facet. Read SKU-code searches
  // as well, merging by native identity rather than adding overlapping stock.
  if (records.length < total) {
    const knownPrefixes = records.map((item) => item.itemid.match(/^([A-Z0-9+]+)[-/:]/i)?.[1]).filter((value): value is string => Boolean(value));
    const prefixes = [...new Set([...knownPrefixes, ...Array.from({ length: 1000 }, (_, index) => String(index).padStart(3, "0"))])];
    let next = 0;
    const searches = await Promise.allSettled(Array.from({ length: 2 }, async () => {
      while (!failed && records.length < total && next < prefixes.length) {
        const q = `${prefixes[next++]}-`;
        try {
          let expected: number | undefined;
          for (const sort of ["itemid:asc", "itemid:desc"]) {
            for (let offset = 0; offset < SEARCH_LIMIT && records.length < total; offset += PAGE_SIZE) {
              const page = await fetchPage({ q, sort }, offset, false);
              if (!Number.isSafeInteger(page.total) || page.total < 0 || !Array.isArray(page.items)) throw new Error("Walthers returned an invalid SKU search");
              if (expected !== undefined && expected !== page.total) throw new Error("Walthers catalog changed during download; please retry");
              expected = page.total;
              if (page.items.length !== Math.min(PAGE_SIZE, Math.max(0, page.total - offset))) throw new Error("Walthers SKU search is incomplete");
              for (const item of page.items) {
                normalizeWalthersItem(item);
                if (!ids.has(item.internalid)) { ids.add(item.internalid); records.push(item); }
              }
              progress(records.length, total);
              if (offset + PAGE_SIZE >= page.total) break;
            }
            if ((expected ?? 0) <= SEARCH_LIMIT) break;
          }
        } catch (error) { failed = true; throw error; }
      }
    }));
    const rejected = searches.find((search) => search.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
  }
  if (records.length !== total) throw new Error("Walthers catalog partitions are incomplete; previous inventory preserved");
  return records;
}