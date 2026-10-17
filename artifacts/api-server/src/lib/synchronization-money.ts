export function moneyCents(value: string): number {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)) throw new Error("INVALID_MONEY_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
