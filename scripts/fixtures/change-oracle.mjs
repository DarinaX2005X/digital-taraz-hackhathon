import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseCsv, scaled, exactMoney } from "./oracle.mjs";

const fingerprint = (row) => JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));
const recordId = (collection, key) => `fixture:${collection}:${key}`;

// These functions describe fixture expectations, never apply a production import.
export function catalogChangeOracle(baseCsv, incomingCsv, { collection, mode, complete = false, hasKey = true, delimiter = ",", columnMapping } = {}) {
  const base = parseCsv(baseCsv);
  const raw = parseCsv(incomingCsv, delimiter);
  const incoming = columnMapping ? raw.map((row) => Object.fromEntries(Object.entries(columnMapping).map(([source, target]) => [target, row[source]]))) : raw;
  const result = { preservedRecordIds: [], updated: [], createdRecordIds: [], tombstonedRecordIds: [], retainedAbsentRecordIds: [], unresolved: [], lineage: [] };
  if (!hasKey) {
    const baseFingerprints = new Map();
    base.forEach((row, index) => {
      const key = fingerprint(row);
      baseFingerprints.set(key, [...(baseFingerprints.get(key) ?? []), index + 1]);
    });
    incoming.forEach((row, index) => {
      const candidates = baseFingerprints.get(fingerprint(row)) ?? [];
      if (candidates.length === 1) result.lineage.push({ sourceRecordNumber: index + 1, matchedBaselineRecordNumber: candidates[0], confidence: "exact-row-candidate-requires-confirmation" });
      else result.unresolved.push({ sourceRecordNumber: index + 1, reason: "no-confirmed-business-key", automaticIdentity: null });
    });
    return result;
  }
  assert.ok(base.every(({ sku }) => /^\d{6}$/.test(sku)), "Baseline SKU keys must retain leading zeros.");
  const baseByKey = new Map(base.map((row) => [row.sku, row]));
  assert.equal(baseByKey.size, base.length, "Duplicate baseline key.");
  const incomingGroups = new Map();
  incoming.forEach((row, index) => {
    assert.ok(/^\d{6}$/.test(row.sku), "Incoming SKU key is absent or destructively normalized.");
    incomingGroups.set(row.sku, [...(incomingGroups.get(row.sku) ?? []), { row, number: index + 1 }]);
  });
  for (const [key, candidates] of incomingGroups) {
    const stableId = recordId(collection, key);
    if (candidates.length !== 1) {
      result.unresolved.push({ key, sourceRecordNumbers: candidates.map(({ number }) => number), reason: "non-unique-record-key", existingRecordId: baseByKey.has(key) ? stableId : null });
      continue;
    }
    const [{ row, number }] = candidates;
    const old = baseByKey.get(key);
    result.lineage.push({ sourceRecordNumber: number, recordId: stableId });
    if (!old) result.createdRecordIds.push(stableId);
    else {
      result.preservedRecordIds.push(stableId);
      const fields = Object.keys(old).filter((field) => old[field] !== row[field]);
      if (fields.length) result.updated.push({ recordId: stableId, fields: fields.map((fieldId) => ({ fieldId, before: old[fieldId], after: row[fieldId] })) });
    }
  }
  for (const { sku } of base) if (!incomingGroups.has(sku)) {
    const target = mode === "replace-snapshot" && complete && result.unresolved.length === 0 ? result.tombstonedRecordIds : result.retainedAbsentRecordIds;
    target.push(recordId(collection, sku));
  }
  for (const key of ["preservedRecordIds", "createdRecordIds", "tombstonedRecordIds", "retainedAbsentRecordIds"]) result[key].sort();
  return result;
}

export function overlapOracle(baseCsv, incomingCsv, collection) {
  const base = parseCsv(baseCsv, ";");
  const incoming = parseCsv(incomingCsv, ";");
  const key = (row) => `${row["Операция"]}|${row["Строка"]}`;
  const oldByKey = new Map(base.map((row) => [key(row), row]));
  assert.equal(oldByKey.size, base.length);
  const ids = new Set();
  const result = { repeatedEventKeys: [], addedEventKeys: [], conflicts: [], stableRecordIds: [], acceptedRowsAfter: base.length, netRevenueKztAfter: null };
  let revenue = base.reduce((sum, row) => sum + scaled(row["Сумма KZT"]), 0n);
  for (const [index, row] of incoming.entries()) {
    const eventKey = key(row);
    assert.ok(!ids.has(eventKey), "Overlap fixture contains an accidental internal duplicate.");
    ids.add(eventKey);
    const old = oldByKey.get(eventKey);
    if (old) {
      result.stableRecordIds.push(recordId(collection, eventKey));
      if (fingerprint(old) === fingerprint(row)) result.repeatedEventKeys.push(eventKey);
      else result.conflicts.push({ eventKey, existingRecordId: recordId(collection, eventKey), incomingSourceRecordNumber: index + 1, action: "keep-existing-accepted-revision-and-review-incoming", automaticallyAddedRows: 0 });
    } else {
      result.addedEventKeys.push(eventKey);
      result.acceptedRowsAfter++;
      revenue += scaled(row["Сумма KZT"]);
    }
  }
  result.netRevenueKztAfter = exactMoney(revenue);
  return result;
}

export function eligibilityOracle(csv, { frequency, requestAnnualSeasonality = false }) {
  const rows = parseCsv(csv);
  const minimum = { daily: 56, weekly: 26, monthly: 24 }[frequency];
  assert.ok(minimum);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => /^\d+$/.test(row.enquiries)));
  const dates = rows.map((row) => {
    const value = new Date(`${row.date}T00:00:00Z`);
    assert.equal(value.toISOString().slice(0, 10), row.date);
    return value;
  });
  let regular = true;
  for (let index = 1; index < dates.length; index++) {
    if (frequency === "monthly") {
      const previous = dates[index - 1];
      const expected = new Date(Date.UTC(previous.getUTCFullYear(), previous.getUTCMonth() + 1, previous.getUTCDate()));
      if (expected.getTime() !== dates[index].getTime()) regular = false;
    } else if (dates[index].getTime() - dates[index - 1].getTime() !== (frequency === "daily" ? 1 : 7) * 86400000) regular = false;
  }
  const reasons = [];
  if (rows.length < minimum) reasons.push("insufficient-history");
  if (!regular) reasons.push("irregular-series");
  const annualSeasonalityEligible = frequency === "monthly" && rows.length >= 36 && regular;
  if (requestAnnualSeasonality && !annualSeasonalityEligible) reasons.push("insufficient-annual-seasonal-cycles");
  return {
    observations: rows.length, frequency, regular, minimumObservations: minimum,
    eligibleForRegularModel: rows.length >= minimum && regular,
    eligibleForRequestedModel: reasons.length === 0, annualSeasonalityEligible, reasons,
    fallback: reasons.length ? "explicit-assumption-scenario-or-request-more-observations" : null,
    forecastValues: null, accuracyClaimed: false,
  };
}

export function manualEditOracle(snapshot, refreshedQuote) {
  assert.equal(snapshot.format, "fixture-contract-not-runtime-artifact");
  assert.equal(snapshot.manualField.origin, "human");
  assert.ok(snapshot.staleProposal.baseArtifactRevision < snapshot.currentArtifactRevision);
  assert.equal(snapshot.freshProposal.baseArtifactRevision, snapshot.currentArtifactRevision);
  assert.ok(!snapshot.freshProposal.targets.includes(snapshot.manualField.fieldId));
  return {
    staleProposal: { status: "conflict", appliedOperations: 0, expectedRevision: snapshot.staleProposal.baseArtifactRevision, actualRevision: snapshot.currentArtifactRevision },
    sourceOnlyRefresh: {
      status: "proposal-awaiting-human-acceptance", manualFieldId: snapshot.manualField.fieldId,
      preservedText: snapshot.manualField.value, preservedTextSha256: createHash("sha256").update(snapshot.manualField.value).digest("hex"),
      updatedKnownTotalKzt: refreshedQuote.knownTotalKzt, finalTotalKzt: null,
      automaticOverwriteOfManualText: false, quoteUnknownsRemainUnresolved: true,
    },
  };
}
