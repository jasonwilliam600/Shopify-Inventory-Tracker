import test from "node:test";
import assert from "node:assert/strict";
import { parseMmdStockCsv, parseMmdCatalogPage, parseMmdMoney, parseMmdBrandDirectory } from "./mmd-records";

const header = "Brand,Product Name,Sku,Msrp,Stock Level\n";
const authenticated = '<a href="/login.php?action=logout">Sign out</a>';
const card = (sku: string, price: string, msrp = "$10.99") =>
  `<article data-test="card-1"><p class="card-sku">${sku}</p><span data-product-rrp-price-without-tax>${msrp}</span><span data-product-price-without-tax>${price}</span></article>`;

test("CSV preserves complete SKUs, manufacturer, MSRP, quantities, and quoted multiline names", () => {
  const [record] = parseMmdStockCsv(header + 'Squadron Colors,"Paint, Gold\r\n30mL",SCL107,10.99,24');
  assert.equal(record.sku, "SCL107");
  assert.equal(record.manufacturerName, "Squadron Colors");
  assert.equal(record.productName, "Paint, Gold 30mL");
  assert.equal(record.msrp, "10.99");
  assert.equal(record.stock, 24);
});

test("uncertain quantities remain unknown, never rounded or made negative", () => {
  for (const stock of ["", "-1", "1.5", "2147483648"]) {
    const [record] = parseMmdStockCsv(header + `Brand,Product,SKU,5,${stock}`);
    assert.equal(record.stock, null);
    assert.equal(record.raw["Stock Level"], stock);
  }
  assert.equal(parseMmdStockCsv(header + "Brand,Product,SKU,5,0")[0].stock, 0);
});

test("invalid prices or quantities, missing columns, malformed CSV, and duplicate SKUs fail safely", () => {
  for (const text of [
    header + "Brand,Product,SKU,bad,1", header + "Brand,Product,SKU,5,NaN",
    header + "Brand,Product,SKU,5,1\nBrand,Other,SKU,5,2",
    header + 'Brand,"unterminated,SKU,5,1', "Sku,Stock Level\nSKU,1",
    header + "Brand,Product,,5,1",
  ]) assert.throws(() => parseMmdStockCsv(text));
});

test("authenticated dealer price is distinct from MSRP", () => {
  const page = parseMmdCatalogPage(authenticated + card("SCL107", "$6.59"));
  assert.equal(page.prices.get("SCL107"), "6.59");
  assert.equal(page.next, null);
});

test("missing dealer price stays unknown rather than falling back to MSRP", () => {
  assert.equal(parseMmdCatalogPage(authenticated + card("SKU", "")).prices.get("SKU"), null);
});

test("pagination links decode HTML entities; session loss and foreign links fail", () => {
  const html = authenticated + card("SKU", "$2.00");
  assert.equal(parseMmdCatalogPage(html + '<link rel="next" href="/products/?limit=100&amp;page=2">').next, "/products/?limit=100&page=2");
  assert.throws(() => parseMmdCatalogPage(card("SKU", "$2.00")));
  assert.throws(() => parseMmdCatalogPage(html + '<link rel="next" href="https://evil.example/products/">'));
  assert.throws(() => parseMmdCatalogPage(authenticated + '<link rel="next" href="/products/?page=2">'));
});

test("duplicate catalog identifiers and malformed prices are rejected", () => {
  assert.throws(() => parseMmdCatalogPage(authenticated + card("SKU", "$2") + card("SKU", "$3")));
  for (const price of ["NaN", "-3", "3.123", "Infinity"]) assert.throws(() => parseMmdMoney(price));
  assert.equal(parseMmdMoney("$1,234.50"), "1234.50");
  assert.equal(parseMmdMoney("0"), "0.00");
});

test("native brand tables provide verified dealer prices, live quantities and manufacturers", () => {
  const html = authenticated + `<tr class="tableItem" data-entity-id="1">
    <td class="tableItem-title"><a>Model Kit</a></td>
    <td class="tableItem-sku"><p class="sku">TAM60402</p></td>
    <td class="tableItem-brand"><p class="brand">Tamiya</p></td>
    <td><span data-product-price-without-tax>$51.60</span><span data-product-rrp-price-without-tax>$86</span></td>
    <td data-product-stock="6"></td>
  </tr><link rel="next" href="/tamiya/?page=2">`;
  const page = parseMmdCatalogPage(`<table>${html}</table>`, "/tamiya/");
  assert.equal(page.products.get("TAM60402")?.stock, 6);
  assert.equal(page.products.get("TAM60402")?.manufacturerName, "Tamiya");
  assert.equal(page.prices.get("TAM60402"), "51.60");
  assert.equal(page.next, "/tamiya/?page=2");
});

test("brand sitemap deduplicates native paths and rejects external links or session loss", () => {
  const section = (url: string) => `<main id="main-content"><ul><li><h2>Brands</h2><ul><li><a href="${url}">Brand</a></li><li><a href="${url}">Brand</a></li></ul></li></ul></main>`;
  assert.deepEqual(parseMmdBrandDirectory(authenticated + section("/tamiya/")), ["https://mmdmodels.com/tamiya/"]);
  assert.throws(() => parseMmdBrandDirectory(authenticated + section("https://evil.example/")));
  assert.throws(() => parseMmdBrandDirectory(section("/tamiya/")));
  assert.throws(() => parseMmdBrandDirectory(authenticated + "<main id='main-content'></main>"));
});