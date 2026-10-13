import { parse } from "csv-parse/sync";

// This verifier reads emitted files and uses scaled integers, independently of
// the generator's Decimal arithmetic and in-memory source records.
export function scaled(value, places = 2) {
  const normalized = String(value).replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`Invalid exact decimal: ${value}`);
  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = normalized.replace("-", "").split(".");
  if (fraction.length > places) throw new Error(`Decimal exceeds ${places} places: ${value}`);
  const result = BigInt(whole) * (10n ** BigInt(places)) + BigInt(fraction.padEnd(places, "0"));
  return negative ? -result : result;
}

function roundRatio(numerator, denominator) {
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return sign * ((absolute + denominator / 2n) / denominator);
}

export function exactMoney(value) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function parseCsv(bytes, delimiter = ",") {
  return parse(bytes, { columns: true, bom: true, delimiter, skip_empty_lines: true });
}

export function historyOracle(csv, catalogCsv) {
  const rows = parseCsv(csv, ";");
  const catalog = new Map(parseCsv(catalogCsv).map((row) => [row.sku, row]));
  const groups = new Map();
  for (const [index, row] of rows.entries()) {
    const key = `${row["Операция"]}|${row["Строка"]}`;
    const group = groups.get(key) ?? [];
    group.push({ row, sourceRecordNumber: index + 1 });
    groups.set(key, group);
  }
  const exclusions = [];
  const duplicates = [];
  const monthly = new Map();
  let revenue = 0n;
  let grossSales = 0n;
  let reductions = 0n;
  let cost = 0n;
  let accepted = 0;
  let returnRows = 0;
  for (const [key, candidates] of groups) {
    const distinct = new Set(candidates.map(({ row }) => JSON.stringify(row)));
    if (distinct.size > 1) {
      exclusions.push({ key, reason: "conflicting-event-key", sourceRecordNumbers: candidates.map(({ sourceRecordNumber }) => sourceRecordNumber) });
      continue;
    }
    if (candidates.length > 1) duplicates.push({ key, ignoredCopies: candidates.length - 1 });
    const row = candidates[0].row;
    const absent = ["Дата", "Артикул", "Валюта"].filter((column) => row[column] === "");
    if (absent.length) {
      exclusions.push({ key, reason: "missing-fields", fields: absent, sourceRecordNumbers: [candidates[0].sourceRecordNumber] });
      continue;
    }
    const product = catalog.get(row["Артикул"]);
    if (!product) throw new Error(`Unknown product: ${key}`);
    if (row["Валюта"] !== "KZT" || row["Единица"] !== product.unit) throw new Error(`Currency/unit mismatch: ${key}`);
    const quantity = scaled(row["Количество"], 3);
    const price = scaled(row["Цена KZT"]);
    const discount = scaled(row["Скидка %"]);
    const expectedAmount = roundRatio(quantity * price * (10000n - discount), 1000n * 10000n);
    const actualAmount = scaled(row["Сумма KZT"]);
    if (actualAmount !== expectedAmount) throw new Error(`Incorrect line arithmetic: ${key}`);
    const expectedCost = row["Вид"] === "credit" ? 0n : roundRatio(quantity * scaled(product.costKzt), 1000n);
    if (scaled(row["Затраты KZT"]) !== expectedCost) throw new Error(`Incorrect cost arithmetic: ${key}`);
    if (row["Вид"] !== "sale") {
      if (!groups.has(`${row["Исходная операция"]}|01`) || quantity >= 0n) throw new Error(`Unlinked reduction: ${key}`);
      returnRows++;
    }
    const [day, month, year] = row["Дата"].split(".");
    const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) throw new Error(`Invalid date: ${key}`);
    const period = `${year}-${month}`;
    const aggregate = monthly.get(period) ?? { revenue: 0n, cost: 0n, rows: 0, reductions: 0 };
    aggregate.revenue += actualAmount;
    aggregate.cost += expectedCost;
    aggregate.rows++;
    if (actualAmount < 0n) aggregate.reductions++;
    monthly.set(period, aggregate);
    revenue += actualAmount;
    cost += expectedCost;
    if (actualAmount >= 0n) grossSales += actualAmount;
    else reductions -= actualAmount;
    accepted++;
  }
  return {
    method: "Parse emitted CSV with csv-parse; group exact event keys; quarantine all conflicting candidates; round rational BigInt minor units (tiyn) half away from zero. No Decimal or generator sum reused.",
    rawRows: rows.length, uniqueEventKeys: groups.size, acceptedRows: accepted, reductionRows: returnRows,
    duplicateCopiesRemoved: duplicates.reduce((sum, row) => sum + row.ignoredCopies, 0),
    exclusions, duplicates,
    grossSalesKzt: exactMoney(grossSales), reductionsKzt: exactMoney(reductions), netRevenueKzt: exactMoney(revenue),
    netCostKzt: exactMoney(cost), marginKzt: exactMoney(revenue - cost),
    monthly: [...monthly].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({
      month, netRevenueKzt: exactMoney(value.revenue), netCostKzt: exactMoney(value.cost), acceptedRows: value.rows, reductionRows: value.reductions,
    })),
  };
}

export function quoteOracle(csv, discountPercent, deliveryKzt) {
  const rows = parseCsv(csv);
  const lineAmounts = rows.map((row) => roundRatio(scaled(row.quantity, 3) * scaled(row.unitPriceKzt), 1000n));
  rows.forEach((row, index) => {
    if (scaled(row.amountKzt) !== lineAmounts[index]) throw new Error(`Incorrect quote amount: ${row.sku}`);
  });
  const subtotal = lineAmounts.reduce((sum, value) => sum + value, 0n);
  const discount = roundRatio(subtotal * scaled(discountPercent), 10000n);
  return {
    subtotalKzt: exactMoney(subtotal), discountKzt: exactMoney(discount),
    deliveryKzt, knownTotalKzt: exactMoney(subtotal - discount + scaled(deliveryKzt)),
    finalTotalKzt: null, unresolvedCosts: ["tax-status", "optional-packaging-or-scope"],
  };
}

export function procurementOracle(csv, target, asOf = "2026-01-01") {
  return parseCsv(csv).filter((row) => row.sku === target.sku).map((row) => {
    const missing = ["packQuantity", "deliveryKzt", "leadDays"].filter((key) => row[key] === "");
    const expired = row.validThrough < asOf;
    if (missing.length || expired) return { supplierId: row.supplierId, eligibleForCompleteCostRanking: false, missing, expired, totalKzt: null };
    const needed = scaled(target.needed, 3);
    const pack = scaled(row.packQuantity, 3);
    const roundedPacks = (needed + pack - 1n) / pack;
    const minimum = BigInt(row.minPacks);
    const packs = roundedPacks > minimum ? roundedPacks : minimum;
    const total = packs * scaled(row.packPriceKzt) + scaled(row.deliveryKzt);
    return {
      supplierId: row.supplierId, eligibleForCompleteCostRanking: true, packs: Number(packs),
      deliveredQuantity: `${Number(packs * pack) / 1000}`, totalKzt: exactMoney(total), leadDays: Number(row.leadDays),
    };
  });
}

export function forecastOracle(splitFiles) {
  const rows = Object.values(splitFiles).flatMap((bytes) => parseCsv(bytes));
  const dates = rows.map(({ month }) => month);
  if (new Set(dates).size !== dates.length) throw new Error("Forecast observation dates overlap.");
  if (rows.some(({ enquiries }) => !/^\d+$/.test(enquiries))) throw new Error("Invalid enquiry count.");
  for (let index = 0; index < rows.length; index++) {
    const expected = `${2021 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}-01`;
    if (rows[index].month !== expected) throw new Error(`Missing or unordered forecast month: ${expected}`);
  }
  return Object.fromEntries(Object.entries(splitFiles).map(([split, bytes]) => {
    const observations = parseCsv(bytes);
    const sum = observations.reduce((total, { enquiries }) => total + BigInt(enquiries), 0n);
    return [split, { count: observations.length, totalEnquiries: sum.toString(), from: observations[0].month, to: observations.at(-1).month }];
  }));
}
