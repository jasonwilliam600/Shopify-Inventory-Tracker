import { load } from "cheerio";
import { parse } from "csv-parse/sync";

export interface MmdStockRecord {
  sku: string;
  productName: string;
  manufacturerName: string | null;
  msrp: string | null;
  stock: number | null;
  raw: Record<string, string>;
}

export function parseMmdMoney(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const plain = trimmed.replace(/^\$\s*/, "").replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(plain) || !Number.isFinite(Number(plain))) {
    throw new Error("MMD catalog contains an invalid price; previous inventory preserved");
  }
  return Number(plain).toFixed(2);
}

export function parseMmdStockCsv(text: string): MmdStockRecord[] {
  const rows = parse(text, { columns: true, bom: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  if (!rows.length || !["Brand", "Product Name", "Sku", "Msrp", "Stock Level"].every(key => key in rows[0])) {
    throw new Error("MMD stock export is empty or its columns changed; previous inventory preserved");
  }
  const seen = new Set<string>();
  return rows.map(raw => {
    const sku = raw.Sku.trim();
    const productName = raw["Product Name"].trim().replace(/\s+/g, " ");
    if (!sku || !productName || /[\x00-\x1f]/.test(sku) || seen.has(sku)) {
      throw new Error("MMD stock export contains missing or duplicate identifiers; previous inventory preserved");
    }
    seen.add(sku);
    const value = raw["Stock Level"].trim();
    let stock: number | null = null;
    if (value) {
      if (!/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
        throw new Error("MMD stock export contains an invalid quantity; previous inventory preserved");
      }
      const number = Number(value);
      if (Number.isSafeInteger(number) && number >= 0 && number <= 2_147_483_647) stock = number;
    }
    return {
      sku, productName, manufacturerName: raw.Brand.trim() || null,
      msrp: parseMmdMoney(raw.Msrp), stock, raw,
    };
  });
}

export function isMmdAuthenticated(html: string): boolean {
  return /action=logout|action&#x3D;logout|action=sign_out/i.test(html);
}

export interface MmdDealerProduct {
  sku: string;
  productName: string;
  manufacturerName: string | null;
  dealerPrice: string | null;
  msrp: string | null;
  stock: number | null;
}

export function parseMmdBrandDirectory(html: string): string[] {
  if (!isMmdAuthenticated(html)) throw new Error("MMD dealer session expired");
  const $ = load(html);
  const section = $("#main-content h2").filter((_i, element) => $(element).text().trim() === "Brands").parent();
  const urls = new Set<string>();
  section.find("a[href]").each((_i, element) => {
    const url = new URL($(element).attr("href")!, "https://mmdmodels.com");
    if (url.origin !== "https://mmdmodels.com" || url.pathname === "/" || /(?:login|cart|account|checkout|sitemap)\.?(?:php|\/)/.test(url.pathname)) {
      throw new Error("MMD brand directory contains an unexpected URL");
    }
    url.search = "";
    urls.add(url.href);
  });
  if (!urls.size) throw new Error("MMD brand directory is empty; previous inventory preserved");
  return [...urls];
}

export function parseMmdCatalogPage(html: string, expectedPath = "/products/") {
  if (!isMmdAuthenticated(html)) {
    throw new Error("MMD dealer session expired; previous inventory preserved");
  }
  const $ = load(html);
  const prices = new Map<string, string | null>();
  const products = new Map<string, MmdDealerProduct>();
  $('article[data-test^="card-"]').each((_index, element) => {
    const card = $(element);
    const sku = card.find(".card-sku").text().trim();
    if (!sku || prices.has(sku)) throw new Error("MMD catalog has missing or duplicate SKUs");
    const priceText = card.find("[data-product-price-without-tax]").text().trim();
    // MSRP/rrp and non-sale-price are deliberately NOT cost fallbacks.
    prices.set(sku, parseMmdMoney(priceText));
  });
  $("tr.tableItem[data-entity-id]").each((_index, element) => {
    const row = $(element);
    const sku = row.find(".tableItem-sku .sku").first().text().trim();
    const productName = row.find(".tableItem-title a").text().trim().replace(/\s+/g, " ");
    if (!sku || !productName || prices.has(sku)) throw new Error("MMD dealer table has missing or duplicate identifiers");
    const rawStock = row.find("[data-product-stock]").attr("data-product-stock");
    let stock: number | null = null;
    if (rawStock != null && /^\d+$/.test(rawStock)) {
      const number = Number(rawStock);
      if (Number.isSafeInteger(number) && number <= 2_147_483_647) stock = number;
    }
    const dealerPrice = parseMmdMoney(row.find("[data-product-price-without-tax]").text());
    prices.set(sku, dealerPrice);
    products.set(sku, {
      sku, productName, manufacturerName: row.find(".tableItem-brand .brand").text().trim() || null,
      dealerPrice, stock, msrp: parseMmdMoney(row.find("[data-product-rrp-price-without-tax]").text()),
    });
  });
  const next = $('link[rel="next"]').attr("href") ?? null;
  if (next && !prices.size) throw new Error("MMD catalog pagination returned an empty page");
  if (next) {
    const url = new URL(next, "https://mmdmodels.com");
    if (url.origin !== "https://mmdmodels.com" || url.pathname !== expectedPath) {
      throw new Error("MMD catalog returned an unexpected pagination link");
    }
  }
  return { prices, products, next };
}