import { describe, expect, it } from 'vitest';
import {
  evaluateDecisionPortfolio,
  OperationsDecisionSchema,
  selectedDecision,
  type DecisionContext,
  type DecisionOptionDraft,
  type OperationsDecision,
} from '../../src/features/commercial/domain/decision';

const ids = {
  request: '00000000-0000-4000-8000-000000000001', requestVersion: '00000000-0000-4000-8000-000000000011',
  catalog: '00000000-0000-4000-8000-000000000002', catalogVersion: '00000000-0000-4000-8000-000000000012',
  conditions: '00000000-0000-4000-8000-000000000003', conditionsVersion: '00000000-0000-4000-8000-000000000013',
  availability: '00000000-0000-4000-8000-000000000004', availabilityVersion: '00000000-0000-4000-8000-000000000014',
  resource: '00000000-0000-4000-8000-000000000005',
};
const ref = (sourceId: string, sourceVersionId: string) => ({ sourceId, sourceVersionId, revision: 1 });
const source = (sourceId: string, sourceVersionId: string, title: string, id: string, text: string) => ({
  sourceRef: ref(sourceId, sourceVersionId), title, chunkCount: 1,
  manifest: { fragmentCount: 1, rowCount: 1, pageCount: 0, complete: true }, windows: [{ ordinal: 0, offset: 0, count: 1 }],
  coverage: { loadedFragments: 1, totalFragments: 1, complete: true, truncated: false }, fragments: [{ id, text, review: 'observed' as const }],
});
const evidence = (sourceId: string, fragmentId: string, raw: string) => ({ origin: 'source' as const, sourceId, artifactId: null, fragmentId, raw });
const number = (value: string, sourceId: string, fragmentId: string, raw = value) => ({ value, evidence: { ...evidence(sourceId, fragmentId, raw), decimalSeparator: '.' as const, groupSeparator: 'none' as const } });

function fixture() {
  const sources = [
    source(ids.request, ids.requestVersion, 'Synthetic request', 'request-row', 'Need 2 custom service units by 2026-11-05.'),
    source(ids.catalog, ids.catalogVersion, 'Synthetic catalog', 'catalog-row', 'Standard 1250 KZT; accelerated 1500 KZT.'),
    source(ids.conditions, ids.conditionsVersion, 'Synthetic conditions', 'conditions-row', 'Direct costs cover labor and materials. Unit direct cost is 900 KZT. Delivery is excluded and billed separately.'),
    source(ids.availability, ids.availabilityVersion, 'Synthetic availability', 'availability-row', 'Workshop opens 2026-11-01 and has 960 available minutes before 2026-11-05.'),
  ];
  const operations = (optionId: string, assessmentId: string, durationMinutes: number, price: string): OperationsDecision => ({
    assessmentId, optionId,
    request: {
      assessmentId, optionId, requestedDate: '2026-11-05', requestedDateEvidence: evidence(ids.request, 'request-row', '2026-11-05'),
      openingDate: '2026-11-01', openingDateEvidence: evidence(ids.availability, 'availability-row', '2026-11-01'),
      availabilitySourceIds: [ids.availability], planArtifact: null,
      planDraft: { timezone: 'Asia/Qyzylorda', tasks: [{ id: `${optionId}_work`, title: `${optionId} work`, durationMinutes, effortMinutes: durationMinutes, resourceIds: [], dependencies: [], sourceRefs: [ref(ids.request, ids.requestVersion)], startDate: '2026-11-02', endDate: '2026-11-04', startAt: null, endAt: null }] },
    },
    verdict: 'can-meet', requestedDate: '2026-11-05', openingDate: '2026-11-01', earliestCompletionDate: '2026-11-04', reasons: [], conditions: [],
    capacity: [{ scope: `${optionId} work`, requiredMinutes: durationMinutes, availableMinutes: 960, evidence: { origin: 'source', resourceId: ids.resource, availabilityVersionId: ids.availabilityVersion, verifiedAt: '2026-10-15T00:00:00.000Z', sourceRefs: [ref(ids.availability, ids.availabilityVersion)] } }], alternatives: [],
    planDraft: { title: `${optionId} operational plan`, sourceRefs: [ref(ids.request, ids.requestVersion), ref(ids.availability, ids.availabilityVersion)], content: { kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries: [{ id: `${optionId}_work`, title: `${optionId} work`, status: 'todo', startDate: '2026-11-02', endDate: '2026-11-04', resourceIds: [], dependencies: [], durationMinutes, checklist: [], availabilityVersionIds: [], notes: `Quoted at ${price} KZT.` }] } },
  });
  const option = (id: string, title: string, price: '1250' | '1500', assessmentId: string): DecisionOptionDraft => ({
    id, title,
    offer: { title: `${title} proposal`, currency: 'KZT', introduction: 'Synthetic reviewed option.', lines: [{ label: 'Custom service', unit: 'unit', quantity: { value: '2', evidence: { origin: 'goal', sourceId: null, artifactId: null, fragmentId: null, raw: '2', decimalSeparator: '.', groupSeparator: 'none' } }, price: number(price, ids.catalog, 'catalog-row') }], discountRate: null, taxRate: null, terms: ['Delivery is excluded and billed separately.'], requirements: [{ text: 'Two units by the requested date', status: 'answered', response: 'Included and checked.' }] },
    costs: [{ id: 'direct_cost', label: 'Labor and materials', quantity: { value: '2', evidence: { origin: 'goal', sourceId: null, artifactId: null, fragmentId: null, raw: '2', decimalSeparator: '.', groupSeparator: 'none' } }, unitCost: number('900', ids.conditions, 'conditions-row') }],
    costCoverage: { state: 'complete', description: 'The conditions define the complete direct-cost basis.', evidence: evidence(ids.conditions, 'conditions-row', 'Direct costs cover labor and materials') },
    minimumContributionRate: null, operationsAssessmentId: assessmentId,
    claims: [{ id: 'requested_date', status: 'fact', impact: 'context', text: 'Requested date is 2026-11-05.', evidence: evidence(ids.request, 'request-row', '2026-11-05'), question: null }],
    termClaims: [{ termIndex: 0, claim: { id: 'delivery_excluded', status: 'fact', impact: 'condition', text: 'Delivery is excluded and billed separately.', evidence: evidence(ids.conditions, 'conditions-row', 'Delivery is excluded and billed separately'), question: null } }],
    tradeoffs: [id === 'standard' ? 'Lower price and longer preparation.' : 'Higher price and shorter preparation.'],
  });
  const standard = option('standard', 'Standard', '1250', 'capacity_standard');
  const accelerated = option('accelerated', 'Accelerated', '1500', 'capacity_accelerated');
  const context: DecisionContext = {
    goal: 'Need 2 custom service units by 2026-11-05 without a loss.', locale: 'en', sources, artifacts: [],
    sourceRoles: [
      { sourceId: ids.request, roles: ['request'] }, { sourceId: ids.catalog, roles: ['catalog'] },
      { sourceId: ids.conditions, roles: ['conditions'] }, { sourceId: ids.availability, roles: ['availability'] },
    ],
    operations: [operations('standard', 'capacity_standard', 480, '1250'), operations('accelerated', 'capacity_accelerated', 360, '1500')],
  };
  return { context, standard, accelerated };
}

describe('commercial decision procedure', () => {
  it('returns can when exact economics and capacity are verified with no extra condition', () => {
    const { context, standard, accelerated } = fixture();
    for (const option of [standard, accelerated]) { option.offer.terms = []; option.termClaims = []; }
    const result = evaluateDecisionPortfolio({ options: [standard, accelerated] }, context);
    expect(result.options.map((option) => option.verdict)).toEqual(['can', 'can']);
  });

  it('separates verified economics from conditions and produces materially different selectable options', () => {
    const { context, standard, accelerated } = fixture();
    const result = evaluateDecisionPortfolio({ options: [standard, accelerated] }, context);
    expect(result.options.map((option) => ({ id: option.id, verdict: option.verdict, contribution: option.metrics.contribution }))).toEqual([
      { id: 'standard', verdict: 'can-with-conditions', contribution: '700.00' },
      { id: 'accelerated', verdict: 'can-with-conditions', contribution: '1200.00' },
    ]);
    expect(result.differences[0]?.dimensions).toEqual(expect.arrayContaining(['price', 'capacity']));
    expect(result.blockers).toContainEqual(expect.objectContaining({ id: 'select_option', userResolvable: true }));
    expect(() => selectedDecision(result, 'standard', null, [], [])).toThrow('selectionRequired');
    expect(() => selectedDecision(result, 'accelerated', 'standard', [], [])).toThrow('selectionRequired');
    expect(selectedDecision(result, 'standard', 'standard', ['accept_conditions_standard'], []).id).toBe('standard');
  });

  it('keeps a missing price as a decision-changing unknown rather than an offer success', () => {
    const { context, standard, accelerated } = fixture();
    standard.offer.lines[0]!.price = { value: null, evidence: null };
    const result = evaluateDecisionPortfolio({ options: [standard, accelerated] }, context);
    expect(result.options[0]).toMatchObject({ verdict: 'cannot-confirm', metrics: { state: 'incomplete', quotedTotal: null } });
    expect(result.options[0]!.blockers.some((blocker) => blocker.id.startsWith('price_standard'))).toBe(true);
  });

  it('finds a requested-date/opening-date conflict and does not turn it into capacity', () => {
    const { context, standard, accelerated } = fixture();
    const availability = context.sources.find((item) => item.sourceRef.sourceId === ids.availability)!;
    availability.fragments[0]!.text = 'The prior calendar listed 2026-11-01; the reviewed opening date is 2026-11-07, after the requested 2026-11-05 date.';
    const conflicted = context.operations[0]!;
    conflicted.request.openingDate = '2026-11-07'; conflicted.request.openingDateEvidence = evidence(ids.availability, 'availability-row', '2026-11-07');
    conflicted.openingDate = '2026-11-07'; conflicted.verdict = 'cannot-meet'; conflicted.planDraft = null;
    conflicted.reasons = [{ code: 'opens_after_deadline', message: 'The workshop opens after the requested date.', sourceRefs: [ref(ids.availability, ids.availabilityVersion)], question: null }];
    conflicted.capacity = [{ scope: 'standard work', requiredMinutes: 480, availableMinutes: 0, evidence: { origin: 'source', resourceId: ids.resource, availabilityVersionId: ids.availabilityVersion, verifiedAt: '2026-10-15T00:00:00.000Z', sourceRefs: [ref(ids.availability, ids.availabilityVersion)] } }];
    const result = evaluateDecisionPortfolio({ options: [standard, accelerated] }, context);
    expect(result.options[0]).toMatchObject({ verdict: 'cannot-confirm', operations: { verdict: 'cannot-meet' } });
    expect(result.options[0]!.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(['opens_after_deadline', 'deadline_conflict']));
  });

  it('rejects options whose price, scope, capacity and conditions are indistinguishable', () => {
    const { context, standard } = fixture();
    const duplicate = structuredClone(standard); duplicate.id = 'duplicate'; duplicate.operationsAssessmentId = 'capacity_duplicate';
    const assessment = structuredClone(context.operations[0]!); assessment.assessmentId = 'capacity_duplicate'; assessment.optionId = 'duplicate'; assessment.request.assessmentId = 'capacity_duplicate'; assessment.request.optionId = 'duplicate';
    if (assessment.planDraft?.content.kind === 'plan') assessment.planDraft.content.entries[0]!.id = 'duplicate_work';
    context.operations.push(assessment);
    expect(() => evaluateDecisionPortfolio({ options: [standard, duplicate] }, context)).toThrow('indistinguishableOptions');
  });

  it('does not confirm a decision from a partially read required source', () => {
    const { context, standard, accelerated } = fixture();
    const availability = context.sources.find((item) => item.sourceRef.sourceId === ids.availability)!;
    availability.coverage = { loadedFragments: 1, totalFragments: 2, complete: false, truncated: false };
    const result = evaluateDecisionPortfolio({ options: [standard, accelerated] }, context);
    expect(result.options.every((option) => option.verdict === 'cannot-confirm')).toBe(true);
    expect(result.blockers.some((blocker) => blocker.id.startsWith('coverage_') && !blocker.userResolvable)).toBe(true);
  });

  it('requires explicit condition acceptance separately from canonical option selection', () => {
    const { context, standard, accelerated } = fixture();
    const standardCapacity = context.operations.find((item) => item.optionId === 'standard')!;
    standardCapacity.verdict = 'can-meet-with-conditions';
    standardCapacity.conditions = [{ code: 'known_scope_only', message: 'Only saved availability was checked.', sourceRefs: [ref(ids.availability, ids.availabilityVersion)], question: null }];
    const acceleratedCapacity = context.operations.find((item) => item.optionId === 'accelerated')!;
    acceleratedCapacity.verdict = 'cannot-meet'; acceleratedCapacity.planDraft = null;
    acceleratedCapacity.reasons = [{ code: 'capacity_conflict', message: 'Accelerated scope exceeds capacity.', sourceRefs: [ref(ids.availability, ids.availabilityVersion)], question: null }];
    const result = evaluateDecisionPortfolio({ options: [standard, accelerated] }, context);
    const consent = result.blockers.find((blocker) => blocker.id === 'accept_conditions_standard')!;
    expect(consent).toMatchObject({ optionIds: ['standard'], userResolvable: true });
    expect(() => selectedDecision(result, 'standard', 'standard', [], [])).toThrow('conditionAcceptanceRequired');
    expect(selectedDecision(result, 'standard', 'standard', [consent.id], []).id).toBe('standard');
  });

  it('accepts source-backed or immutable manual capacity evidence and rejects missing evidence for success', () => {
    const { context } = fixture();
    const sourceBacked = context.operations[0]!;
    expect(OperationsDecisionSchema.parse(sourceBacked).capacity[0]!.evidence.origin).toBe('source');
    const manual = structuredClone(sourceBacked);
    manual.capacity[0]!.evidence = { origin: 'manual', resourceId: ids.resource, availabilityVersionId: ids.availabilityVersion, verifiedAt: null, sourceRefs: [] };
    expect(OperationsDecisionSchema.parse(manual).capacity[0]!.evidence.origin).toBe('manual');
    const missing = structuredClone(sourceBacked);
    missing.capacity[0]!.evidence = { origin: 'missing', resourceId: ids.resource, availabilityVersionId: null, verifiedAt: null, sourceRefs: [] };
    expect(() => OperationsDecisionSchema.parse(missing)).toThrow('Missing capacity evidence');
    missing.verdict = 'cannot-confirm'; missing.planDraft = null;
    missing.reasons = [{ code: 'availability_missing', message: 'Availability is missing.', sourceRefs: [], question: 'Which availability should be used?' }];
    expect(OperationsDecisionSchema.parse(missing).capacity[0]!.evidence.origin).toBe('missing');
  });
});
