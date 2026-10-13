import Decimal from "decimal.js";
import { BUSINESSES, DEFAULT_SEED, SNAPSHOT_DATE, SYNTHETIC_NOTICE } from "./definitions.mjs";

export const HISTORY_COLUMNS = [
  ["operationId", "Операция"], ["lineId", "Строка"], ["date", "Дата"],
  ["kind", "Вид"], ["sku", "Артикул"], ["name", "Наименование"],
  ["quantity", "Количество"], ["unit", "Единица"], ["unitPrice", "Цена KZT"],
  ["discountPercent", "Скидка %"], ["netAmount", "Сумма KZT"], ["costAmount", "Затраты KZT"],
  ["currency", "Валюта"], ["originalOperationId", "Исходная операция"], ["channel", "Канал"],
];

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const money = (value) => new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const dateLabel = (iso) => iso.split("-").reverse().join(".");
const localDecimal = (value) => String(value ?? "").replace(".", ",");

export function csvBuffer(headers, rows, { delimiter = ",", bom = false } = {}) {
  const encode = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return Buffer.from(`${bom ? "\uFEFF" : ""}${[headers, ...rows].map((row) => row.map(encode).join(delimiter)).join("\r\n")}\r\n`, "utf8");
}

export function historyCsv(rows) {
  return csvBuffer(HISTORY_COLUMNS.map(([, title]) => title), rows.map((row) => HISTORY_COLUMNS.map(([key]) => {
    if (key === "date") return row[key] ? dateLabel(row[key]) : "";
    if (["quantity", "unitPrice", "discountPercent", "netAmount", "costAmount"].includes(key)) return localDecimal(row[key]);
    return row[key];
  })), { delimiter: ";", bom: true });
}

function buildHistory(business, seed) {
  const random = seededRandom(seed + business.seedOffset);
  const rows = [];
  const outliers = [];
  const billable = business.catalog.filter((product) => product.historyBase > 0);
  let sequence = 0;
  for (let month = 0; month < 60; month++) {
    const year = 2021 + Math.floor(month / 12);
    const monthOfYear = month % 12;
    for (let productIndex = 0; productIndex < billable.length; productIndex++) {
      const product = billable[productIndex];
      for (let batch = 0; batch < 3; batch++) {
        sequence++;
        const id = `${business.id.toUpperCase()}-${String(sequence).padStart(6, "0")}`;
        const day = 3 + batch * 8 + productIndex % 5;
        const date = `${year}-${String(monthOfYear + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const isOutlier = [17, 43].includes(month) && productIndex === 0 && batch === 1;
        const seasonalQuantity = product.historyBase * business.seasons[monthOfYear] / 100;
        const trend = 1 + Math.floor(month / 12) * 0.045;
        const jitter = 0.82 + random() * 0.36;
        let quantity = Math.max(1, Math.round(seasonalQuantity * trend * jitter));
        if (product.unit === "meter" || product.unit === "square_meter" || product.unit === "hour") quantity += 0.25 * (sequence % 4);
        if (isOutlier) quantity *= 4;
        const discountPercent = ["0.00", "2.50", "5.00"][sequence % 3];
        const row = {
          operationId: id, lineId: "01", date, kind: "sale", sku: product.sku, name: product.name,
          quantity: String(quantity), unit: product.unit, unitPrice: product.price, discountPercent,
          netAmount: money(new Decimal(quantity).times(product.price).times(new Decimal(1).minus(new Decimal(discountPercent).div(100)))),
          costAmount: money(new Decimal(quantity).times(product.cost)), currency: "KZT", originalOperationId: "",
          channel: ["existing-shop", "existing-messenger", "existing-contract"][sequence % 3],
        };
        rows.push(row);
        if (isOutlier) outliers.push({ operationId: id, month: `${year}-${String(monthOfYear + 1).padStart(2, "0")}`, reason: "Synthetic exceptional batch: four times the seeded regular quantity; not a business effect claim." });
        if (sequence % 17 === 0) {
          const returned = Decimal.max(1, new Decimal(quantity).div(4).floor());
          rows.push({
            ...row, operationId: `${id}-R`, kind: business.sector === "service" ? "credit" : "return",
            quantity: returned.neg().toFixed(),
            netAmount: money(returned.neg().times(product.price).times(new Decimal(1).minus(new Decimal(discountPercent).div(100)))),
            costAmount: business.sector === "service" ? "0.00" : money(returned.neg().times(product.cost)),
            originalOperationId: id,
          });
        }
      }
    }
  }
  const raw = rows.map((row) => ({ ...row }));
  const issues = [];
  for (const [index, field, type] of [[13, "currency", "missing-currency"], [27, "sku", "missing-sku"], [41, "date", "missing-date"]]) {
    raw[index][field] = "";
    issues.push({ type, operationId: raw[index].operationId, lineId: "01", field, expectedAction: "exclude-until-reviewed", sourceRecordNumber: index + 1 });
  }
  raw.push({ ...raw[3] });
  issues.push({ type: "exact-duplicate", operationId: raw[3].operationId, lineId: "01", sourceRecordNumbers: [4, raw.length], expectedAction: "deduplicate-by-confirmed-event-key" });
  raw.push({ ...raw[8], netAmount: money(new Decimal(raw[8].netAmount).plus(100)) });
  issues.push({ type: "conflicting-event-key", operationId: raw[8].operationId, lineId: "01", field: "netAmount", sourceRecordNumbers: [9, raw.length], expectedAction: "quarantine-both-candidates-until-reviewed" });
  return { rows: raw, issues, outliers };
}

function calculateQuote(business) {
  const lines = business.quote.lines.map((line) => {
    const item = business.catalog.find(({ sku }) => sku === line.sku);
    return { ...line, name: item.name, unit: item.unit, unitPrice: item.price, amount: money(new Decimal(line.quantity).times(item.price)) };
  });
  const subtotal = lines.reduce((total, line) => total.plus(line.amount), new Decimal(0));
  const discount = subtotal.times(business.quote.discountPercent).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return {
    ...business.quote, lines, subtotal: money(subtotal), discount: money(discount),
    knownTotal: money(subtotal.minus(discount).plus(business.quote.delivery)),
    finalTotal: null, finality: "incomplete-terms", calculation: "Round each line to 2 decimal places half-up; discount on the sum of lines; add entered delivery; no inferred tax or packaging.",
  };
}

function commitments(business) {
  return Array.from({ length: 12 }, (_, index) => {
    const payable = index % 3 !== 0;
    const amount = new Decimal(business.catalog[index % business.catalog.length].cost).times(5 + index);
    return {
      commitmentId: `${business.id.toUpperCase()}-COM-${String(index + 1).padStart(3, "0")}`,
      kind: payable ? "payable" : "receivable", amount: money(amount), currency: "KZT",
      dueDate: `2026-01-${String(4 + index * 2).padStart(2, "0")}`, status: "open",
      basis: "synthetic-entered-commitment", counterpartyId: `${payable ? "SUP" : "BIZ"}-SYN-${index + 1}`,
      note: "Учебное обязательство. Не прогноз будущих продаж и не подтверждение реальной оплаты.",
    };
  });
}

function enquiries(business, seed) {
  const random = seededRandom(seed + business.seedOffset + 7001);
  const base = { retail: 165, service: 75, manufacturing: 42 }[business.sector];
  return Array.from({ length: 60 }, (_, index) => {
    const regular = Math.round(base * business.seasons[index % 12] / 100 * (1 + index * 0.004) * (0.94 + random() * 0.12));
    const outlier = [18, 40].includes(index);
    return {
      month: `${2021 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}-01`,
      enquiries: outlier ? regular * 3 : regular,
      split: index < 36 ? "train" : index < 48 ? "validation" : "holdout",
      quality: outlier ? "flagged-outlier" : "regular",
      note: outlier ? "Искусственный выброс: отдельный массовый запрос, причина задана генератором." : "Синтетическое наблюдение, не сведения о реальных обращениях.",
    };
  });
}

export function createBusinessData(seed = DEFAULT_SEED) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Seed must be an unsigned 32-bit integer.");
  return BUSINESSES.map((business) => ({
    ...business, seed, synthetic: true, notice: SYNTHETIC_NOTICE, asOf: SNAPSHOT_DATE,
    history: buildHistory(business, seed), quote: calculateQuote(business), commitments: commitments(business), enquiries: enquiries(business, seed),
  }));
}
