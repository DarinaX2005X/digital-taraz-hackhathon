import Decimal from 'decimal.js';
import { z } from 'zod';
import { SourceRefSchema, type SourceRef } from '../../../contracts/artifacts';
import { currencyMinorUnitScale } from '../../../contracts/calculations';
import { CalendarDateSchema, ElementIdSchema, IdSchema, InstantSchema } from '../../../contracts/primitives';
import { ArtifactContentSchema } from '../../artifacts/domain/content-models';
import { OfferSchema, buildOffer, verifyObservedNumber, type EvidenceArtifact, type EvidenceSource, type OfferInput } from './offer';

const Money = Decimal.clone({ precision: 200, rounding: Decimal.ROUND_HALF_UP });
const SignedDecimalSchema = z.string().max(80).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const DecisionKeySchema = z.string().min(1).max(50).regex(/^[a-z][a-z0-9_-]*$/);

export const BusinessSourceRoleSchema = z.enum(['request', 'catalog', 'conditions', 'availability']);
export const BusinessSourceRoleAssignmentSchema = z.strictObject({
  sourceId: IdSchema,
  roles: z.array(BusinessSourceRoleSchema).min(1).max(4),
}).superRefine((value, context) => {
  if (new Set(value.roles).size !== value.roles.length) context.addIssue({ code: 'custom', message: 'Duplicate source role.' });
});

export const DecisionEvidenceSchema = z.strictObject({
  origin: z.enum(['goal', 'source', 'artifact']),
  sourceId: IdSchema.nullable(),
  artifactId: IdSchema.nullable(),
  fragmentId: z.string().min(1).max(160).nullable(),
  raw: z.string().min(1).max(1000),
});
export const DecisionClaimSchema = z.strictObject({
  id: DecisionKeySchema,
  status: z.enum(['fact', 'assumption', 'unknown']),
  impact: z.enum(['blocking', 'condition', 'context']),
  text: z.string().min(1).max(1500),
  evidence: DecisionEvidenceSchema.nullable(),
  question: z.string().min(1).max(1000).nullable(),
}).superRefine((value, context) => {
  if (value.status === 'fact' && !value.evidence) context.addIssue({ code: 'custom', message: 'A fact requires evidence.' });
  if (value.status === 'unknown' && value.evidence) context.addIssue({ code: 'custom', message: 'An unknown cannot claim evidence.' });
  if (value.status === 'unknown' && value.impact === 'blocking' && !value.question) context.addIssue({ code: 'custom', message: 'A blocking unknown requires a question.' });
  if (value.status !== 'unknown' && value.question) context.addIssue({ code: 'custom', message: 'Only an unknown may ask a question.' });
});

export const OperationsTaskSchema = z.strictObject({
  id: ElementIdSchema,
  title: z.string().min(1).max(1000),
  durationMinutes: z.number().int().positive().max(525_600).nullable(),
  effortMinutes: z.number().int().positive().max(10_000_000).nullable(),
  resourceIds: z.array(IdSchema).max(100),
  dependencies: z.array(ElementIdSchema).max(1000),
  sourceRefs: z.array(SourceRefSchema).max(100),
  startDate: CalendarDateSchema.nullable(),
  endDate: CalendarDateSchema.nullable(),
  startAt: InstantSchema.nullable(),
  endAt: InstantSchema.nullable(),
}).superRefine((value, context) => {
  const dated = value.startDate !== null || value.endDate !== null;
  const timed = value.startAt !== null || value.endAt !== null;
  if (dated === timed || (value.startDate === null) !== (value.endDate === null) || (value.startAt === null) !== (value.endAt === null)) context.addIssue({ code: 'custom', message: 'A task needs one complete date or timestamp range.' });
  if (value.startDate && value.endDate && value.startDate > value.endDate) context.addIssue({ code: 'custom', message: 'Task date range is reversed.' });
  if (value.startAt && value.endAt && Date.parse(value.startAt) > Date.parse(value.endAt)) context.addIssue({ code: 'custom', message: 'Task timestamp range is reversed.' });
});
const PlanContentSchema = ArtifactContentSchema.refine((content) => content.kind === 'plan', { message: 'An operations draft must be a plan artifact.' });
export const OperationsCheckInputSchema = z.strictObject({
  assessmentId: DecisionKeySchema,
  optionId: DecisionKeySchema,
  requestedDate: CalendarDateSchema,
  requestedDateEvidence: DecisionEvidenceSchema,
  openingDate: CalendarDateSchema.nullable(),
  openingDateEvidence: DecisionEvidenceSchema.nullable(),
  availabilitySourceIds: z.array(IdSchema).max(100),
  planArtifact: z.strictObject({ artifactId: IdSchema, revision: z.number().int().nonnegative() }).nullable(),
  planDraft: z.strictObject({ timezone: z.string().min(1).max(80), tasks: z.array(OperationsTaskSchema).min(1).max(2000) }).nullable(),
  planProposalId: DecisionKeySchema.nullable().optional(),
}).refine((value) => [value.planArtifact, value.planDraft, value.planProposalId].filter((item) => item != null).length === 1, { message: 'Use exactly one saved plan, typed plan draft, or checked plan proposal.' });

export const OperationsDecisionReasonSchema = z.strictObject({
  code: DecisionKeySchema,
  message: z.string().min(1).max(1500),
  sourceRefs: z.array(SourceRefSchema).max(100),
  question: z.string().min(1).max(1000).nullable(),
});
export const OperationsCapacityEvidenceSchema = z.discriminatedUnion('origin', [
  z.strictObject({ origin: z.literal('manual'), resourceId: IdSchema, availabilityVersionId: IdSchema, verifiedAt: InstantSchema.nullable(), sourceRefs: z.tuple([]) }),
  z.strictObject({ origin: z.literal('source'), resourceId: IdSchema, availabilityVersionId: IdSchema, verifiedAt: InstantSchema, sourceRefs: z.array(SourceRefSchema).min(1).max(100) }),
  z.strictObject({ origin: z.literal('missing'), resourceId: IdSchema, availabilityVersionId: z.null(), verifiedAt: z.null(), sourceRefs: z.tuple([]) }),
]);
export const OperationsDecisionSchema = z.strictObject({
  assessmentId: DecisionKeySchema,
  optionId: DecisionKeySchema,
  request: OperationsCheckInputSchema,
  verdict: z.enum(['can-meet', 'can-meet-with-conditions', 'cannot-confirm', 'cannot-meet']),
  requestedDate: CalendarDateSchema,
  openingDate: CalendarDateSchema.nullable(),
  earliestCompletionDate: CalendarDateSchema.nullable(),
  reasons: z.array(OperationsDecisionReasonSchema).max(40),
  conditions: z.array(OperationsDecisionReasonSchema).max(40),
  capacity: z.array(z.strictObject({
    scope: z.string().min(1).max(500),
    requiredMinutes: z.number().int().nonnegative().nullable(),
    availableMinutes: z.number().int().nonnegative().nullable(),
    evidence: OperationsCapacityEvidenceSchema,
  })).max(100),
  alternatives: z.array(z.strictObject({
    code: DecisionKeySchema,
    message: z.string().min(1).max(1500),
    entryIds: z.array(ElementIdSchema).max(2000),
    suggestedDate: CalendarDateSchema.nullable(),
    sourceRefs: z.array(SourceRefSchema).max(100),
  })).max(40),
  planDraft: z.strictObject({ title: z.string().min(1).max(240), content: PlanContentSchema, sourceRefs: z.array(SourceRefSchema).max(1000) }).nullable(),
}).superRefine((value, context) => {
  if (value.assessmentId !== value.request.assessmentId || value.optionId !== value.request.optionId || value.requestedDate !== value.request.requestedDate || value.openingDate !== value.request.openingDate) {
    context.addIssue({ code: 'custom', message: 'Operations assessment does not match its request.' });
  }
  if (value.verdict === 'can-meet' && (value.reasons.length || value.conditions.length)) context.addIssue({ code: 'custom', message: 'An unconditional result cannot contain reasons or conditions.' });
  if (value.verdict === 'can-meet-with-conditions' && !value.conditions.length) context.addIssue({ code: 'custom', message: 'A conditional result must name its conditions.' });
  if (['cannot-confirm', 'cannot-meet'].includes(value.verdict) && !value.reasons.length) context.addIssue({ code: 'custom', message: 'A negative result must explain why.' });
  if (['can-meet', 'can-meet-with-conditions'].includes(value.verdict) && !value.planDraft) context.addIssue({ code: 'custom', message: 'A feasible result requires an editable plan draft.' });
  if (['can-meet', 'can-meet-with-conditions'].includes(value.verdict) && value.capacity.some((item) => item.evidence.origin === 'missing')) context.addIssue({ code: 'custom', message: 'Missing capacity evidence cannot support a feasible result.' });
});
export type OperationsCheckInput = z.infer<typeof OperationsCheckInputSchema>;
export type OperationsDecision = z.infer<typeof OperationsDecisionSchema>;

const CostComponentSchema = z.strictObject({
  id: DecisionKeySchema,
  label: z.string().min(1).max(500),
  quantity: OfferSchema.shape.lines.element.shape.quantity,
  unitCost: OfferSchema.shape.lines.element.shape.price,
});
const CostCoverageSchema = z.strictObject({
  state: z.enum(['complete', 'partial', 'unknown']),
  description: z.string().min(1).max(1500),
  evidence: DecisionEvidenceSchema.nullable(),
}).refine((value) => value.state !== 'complete' || value.evidence !== null, { message: 'Complete cost coverage requires evidence.' });
export const DecisionOptionDraftSchema = z.strictObject({
  id: DecisionKeySchema,
  title: z.string().min(1).max(240),
  offer: OfferSchema,
  costs: z.array(CostComponentSchema).max(80),
  costCoverage: CostCoverageSchema,
  minimumContributionRate: OfferSchema.shape.discountRate,
  operationsAssessmentId: DecisionKeySchema,
  claims: z.array(DecisionClaimSchema).max(80),
  termClaims: z.array(z.strictObject({ termIndex: z.number().int().nonnegative().max(19), claim: DecisionClaimSchema })).max(20),
  tradeoffs: z.array(z.string().min(1).max(1000)).min(1).max(10),
}).superRefine((value, context) => {
  const indexes = value.termClaims.map((item) => item.termIndex);
  if (new Set(indexes).size !== indexes.length || indexes.length !== value.offer.terms.length || indexes.some((index) => index >= value.offer.terms.length)) context.addIssue({ code: 'custom', message: 'Every customer-facing term requires exactly one fact, assumption or unknown claim.' });
});
export const CompareDecisionOptionsSchema = z.strictObject({
  options: z.array(DecisionOptionDraftSchema).min(2).max(5),
}).superRefine((value, context) => {
  if (new Set(value.options.map((option) => option.id)).size !== value.options.length) context.addIssue({ code: 'custom', message: 'Decision option IDs must be unique.' });
});

export const DecisionReasonSchema = z.strictObject({
  code: DecisionKeySchema,
  message: z.string().min(1).max(1500),
  sourceRefs: z.array(SourceRefSchema).max(100),
});
export const DecisionBlockerSchema = z.strictObject({
  id: DecisionKeySchema,
  optionIds: z.array(DecisionKeySchema).min(1).max(5),
  question: z.string().min(1).max(1000).nullable(),
  whyDecisionChanges: z.string().min(1).max(1500),
  userResolvable: z.boolean(),
});
const CommercialMetricsSchema = z.strictObject({
  state: z.enum(['verified', 'incomplete']),
  currency: z.string().length(3),
  quotedSubtotal: z.string().nullable(),
  discount: z.string().nullable(),
  tax: z.string().nullable(),
  quotedTotal: z.string().nullable(),
  directCost: z.string().nullable(),
  contribution: SignedDecimalSchema.nullable(),
  contributionRate: SignedDecimalSchema.nullable(),
  minimumContributionRate: z.string().nullable(),
});
export const DecisionOptionResultSchema = z.strictObject({
  id: DecisionKeySchema,
  title: z.string().min(1).max(240),
  verdict: z.enum(['can', 'can-with-conditions', 'cannot-confirm']),
  metrics: CommercialMetricsSchema,
  reasons: z.array(DecisionReasonSchema).max(80),
  conditions: z.array(DecisionReasonSchema).max(80),
  blockers: z.array(DecisionBlockerSchema).max(40),
  sourceRefs: z.array(SourceRefSchema).min(1).max(100),
  operations: OperationsDecisionSchema,
  draft: DecisionOptionDraftSchema,
}).superRefine((value, context) => {
  if (value.reasons.length + value.conditions.length > 100) context.addIssue({ code: 'custom', message: 'At most 100 public decision factors are allowed.' });
});
export const DecisionDifferenceSchema = z.strictObject({
  leftOptionId: DecisionKeySchema,
  rightOptionId: DecisionKeySchema,
  dimensions: z.array(z.enum(['price', 'scope', 'deadline', 'capacity', 'conditions'])).min(1).max(5),
});
export const DecisionPortfolioSchema = z.strictObject({
  options: z.array(DecisionOptionResultSchema).min(2).max(5),
  differences: z.array(DecisionDifferenceSchema).min(1).max(10),
  blockers: z.array(DecisionBlockerSchema).max(100),
});
export const DecisionPresentationSchema = z.strictObject({
  options: z.array(z.strictObject({
    id: DecisionKeySchema,
    title: z.string().min(1).max(240),
    verdict: z.enum(['can', 'can-with-conditions', 'cannot-confirm']),
    metrics: CommercialMetricsSchema,
    reasons: z.array(DecisionReasonSchema).max(80),
    conditions: z.array(DecisionReasonSchema).max(80),
  })).min(2).max(5),
  differences: z.array(DecisionDifferenceSchema).min(1).max(10),
});
export type DecisionPortfolio = z.infer<typeof DecisionPortfolioSchema>;
export type DecisionOptionDraft = z.infer<typeof DecisionOptionDraftSchema>;

export type DecisionSource = EvidenceSource & {
  title: string;
  coverage: { loadedFragments: number; totalFragments: number; complete: boolean; truncated: boolean };
};
export type DecisionContext = {
  goal: string;
  locale: 'ru' | 'kk' | 'en';
  sources: DecisionSource[];
  artifacts: EvidenceArtifact[];
  sourceRoles: z.infer<typeof BusinessSourceRoleAssignmentSchema>[];
  operations: OperationsDecision[];
  id?: () => string;
};

function containsText(haystack: string, needle: string) {
  return haystack.toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase());
}
export function verifyDecisionEvidence(evidence: z.infer<typeof DecisionEvidenceSchema>, context: Pick<DecisionContext, 'goal' | 'sources' | 'artifacts'>): SourceRef | null {
  if (evidence.origin === 'goal') {
    if (evidence.sourceId || evidence.artifactId || evidence.fragmentId || !containsText(context.goal, evidence.raw)) throw new Error('commercial.errors.claimEvidence');
    return null;
  }
  if (evidence.origin === 'artifact') {
    const target = context.artifacts.find((artifact) => artifact.artifactId === evidence.artifactId)?.targets.find((item) => item.targetId === evidence.fragmentId);
    if (evidence.sourceId || !target || !containsText(target.text, evidence.raw)) throw new Error('commercial.errors.claimEvidence');
    return target.sourceRef;
  }
  const source = context.sources.find((item) => item.sourceRef.sourceId === evidence.sourceId);
  const fragment = source?.fragments.find((item) => item.id === evidence.fragmentId);
  if (evidence.artifactId || !source || !fragment || fragment.review !== 'observed' || ![fragment.text ?? '', ...(fragment.values ?? [])].some((text) => containsText(text, evidence.raw))) throw new Error('commercial.errors.claimEvidence');
  return source.sourceRef;
}

const uniqueRefs = (refs: (SourceRef | null | undefined)[]) => [...new Map(refs.filter((ref): ref is SourceRef => Boolean(ref)).map((ref) => [JSON.stringify(ref), ref])).values()];
const blockerId = (prefix: string, optionId: string, suffix = '') => `${prefix}_${optionId}${suffix ? `_${suffix}` : ''}`.replace(/[^a-z0-9_-]/g, '_').slice(0, 50);
const amount = (value: Decimal, scale = 2) => value.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);

function optionResult(option: DecisionOptionDraft, context: DecisionContext): z.infer<typeof DecisionOptionResultSchema> {
  const operations = context.operations.find((item) => item.assessmentId === option.operationsAssessmentId && item.optionId === option.id);
  if (!operations) throw new Error('commercial.errors.operationsAssessment');
  const expectedRequest = OperationsCheckInputSchema.parse(operations.request);
  if (expectedRequest.optionId !== option.id || expectedRequest.assessmentId !== option.operationsAssessmentId) throw new Error('commercial.errors.operationsAssessment');
  verifyDecisionEvidence(expectedRequest.requestedDateEvidence, context);
  if (expectedRequest.openingDateEvidence) verifyDecisionEvidence(expectedRequest.openingDateEvidence, context);
  if ((expectedRequest.openingDate === null) !== (expectedRequest.openingDateEvidence === null)) throw new Error('commercial.errors.openingDateEvidence');
  for (const sourceId of expectedRequest.availabilitySourceIds) {
    const role = context.sourceRoles.find((item) => item.sourceId === sourceId);
    if (!role?.roles.includes('availability')) throw new Error('commercial.errors.availabilityEvidence');
  }
  const counter = { value: 0 };
  const scale = currencyMinorUnitScale(option.offer.currency);
  const offer = buildOffer(option.offer, { goal: context.goal, sources: context.sources, artifacts: context.artifacts, locale: context.locale, id: context.id ?? (() => `decision_${++counter.value}`) });
  const sourceRefs: SourceRef[] = [...offer.sourceRefs];
  const reasons: z.infer<typeof DecisionReasonSchema>[] = [], conditions: z.infer<typeof DecisionReasonSchema>[] = [], blockers: z.infer<typeof DecisionBlockerSchema>[] = [];
  const addBlocker = (id: string, whyDecisionChanges: string, question: string | null, userResolvable: boolean) => blockers.push({ id, optionIds: [option.id], whyDecisionChanges, question, userResolvable });
  for (const assignment of context.sourceRoles) {
    const source = context.sources.find((item) => item.sourceRef.sourceId === assignment.sourceId);
    if (!source) throw new Error('commercial.errors.sourceRole');
    if (!source.coverage.complete) for (const role of assignment.roles) addBlocker(blockerId('coverage', option.id, role), `${role} source coverage is partial (${source.coverage.loadedFragments}/${source.coverage.totalFragments} fragments).`, null, false);
  }
  let directCost: Decimal | null = new Money(0);
  for (const cost of option.costs) {
    const quantityRef = verifyObservedNumber(cost.quantity, context.goal, context.sources, context.artifacts);
    const costRef = verifyObservedNumber(cost.unitCost, context.goal, context.sources, context.artifacts);
    sourceRefs.push(...uniqueRefs([quantityRef, costRef]));
    if (cost.quantity.value === null || cost.unitCost.value === null) {
      directCost = null;
      addBlocker(blockerId('cost', option.id, cost.id), `The direct cost for ${cost.label} changes whether this option is loss-making.`, `What quantity and unit cost should be used for ${cost.label}?`, true);
    } else if (directCost) directCost = directCost.plus(amount(new Money(cost.quantity.value).times(cost.unitCost.value), scale));
  }
  if (option.costCoverage.evidence) sourceRefs.push(...uniqueRefs([verifyDecisionEvidence(option.costCoverage.evidence, context)]));
  if (option.costCoverage.state !== 'complete') addBlocker(blockerId('cost_coverage', option.id), option.costCoverage.description, 'Which direct cost categories must be included before checking the price?', true);
  let minimumContributionRate: Decimal | null = null;
  if (option.minimumContributionRate) {
    const ref = verifyObservedNumber(option.minimumContributionRate, context.goal, context.sources, context.artifacts);
    sourceRefs.push(...uniqueRefs([ref]));
    minimumContributionRate = option.minimumContributionRate.value === null ? null : new Money(option.minimumContributionRate.value);
    if (minimumContributionRate === null) addBlocker(blockerId('margin_rule', option.id), 'The required contribution threshold changes whether the proposed price is acceptable.', 'What minimum contribution rate should this option meet?', true);
  }
  for (const claim of [...option.claims, ...option.termClaims.map((item) => item.claim)]) {
    const ref = claim.evidence ? verifyDecisionEvidence(claim.evidence, context) : null;
    sourceRefs.push(...uniqueRefs([ref]));
    if (claim.status === 'unknown' && claim.impact === 'blocking') addBlocker(blockerId('unknown', option.id, claim.id), claim.text, claim.question, true);
    else if (claim.status === 'assumption' || claim.impact === 'condition') conditions.push({ code: claim.id, message: claim.text, sourceRefs: uniqueRefs([ref]) });
  }
  for (const item of [...operations.reasons, ...operations.conditions, ...operations.alternatives]) sourceRefs.push(...item.sourceRefs);
  for (const item of operations.capacity) sourceRefs.push(...item.evidence.sourceRefs);
  for (const reason of operations.reasons) reasons.push({ code: reason.code, message: reason.message, sourceRefs: reason.sourceRefs });
  for (const condition of operations.conditions) conditions.push({ code: condition.code, message: condition.message, sourceRefs: condition.sourceRefs });
  if (operations.verdict === 'cannot-confirm') for (const reason of operations.reasons) addBlocker(blockerId('capacity', option.id, reason.code), reason.message, reason.question, reason.question !== null);
  const calculation = offer.calculation;
  const sheetId = offer.table.workbook.sheetOrder[0]!;
  const spec = offer.table.workbook.sheets[sheetId]!.calculation!;
  const discount = spec.discount ? calculation.values[spec.discount.amountCellId] : new Money(0).toFixed(scale);
  const tax = spec.tax ? calculation.values[spec.tax.amountCellId] : new Money(0).toFixed(scale);
  const subtotal = calculation.subtotal;
  const total = calculation.total;
  if (calculation.state !== 'verified' || subtotal === null || total === null || discount === null || tax === null) {
    for (const line of option.offer.lines.filter((line) => line.price.value === null || line.quantity.value === null)) addBlocker(blockerId('price', option.id, line.label), `The price or quantity for ${line.label} changes the commercial decision.`, `What exact price and quantity should be used for ${line.label}?`, true);
  }
  const netQuoted = typeof subtotal === 'string' && typeof discount === 'string' ? new Money(subtotal).minus(discount) : null;
  const contribution = netQuoted && directCost ? amount(netQuoted.minus(directCost), scale) : null;
  const contributionRate = contribution && netQuoted && !netQuoted.isZero() ? contribution.div(netQuoted).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : null;
  if (contribution?.isNegative()) reasons.push({ code: 'loss', message: `Known direct costs exceed the quoted amount by ${contribution.abs().toFixed(scale)} ${option.offer.currency}.`, sourceRefs: uniqueRefs(sourceRefs) });
  if (minimumContributionRate && contributionRate && contributionRate.lessThan(minimumContributionRate)) reasons.push({ code: 'margin_below_rule', message: `Contribution rate ${contributionRate.toFixed(2)}% is below the evidenced ${minimumContributionRate.toFixed(2)}% rule.`, sourceRefs: uniqueRefs(sourceRefs) });
  if (operations.verdict === 'cannot-meet') reasons.push({ code: 'deadline_conflict', message: 'The requested date conflicts with the checked operational availability.', sourceRefs: uniqueRefs(operations.reasons.flatMap((reason) => reason.sourceRefs)) });
  const commercialVerified = calculation.state === 'verified' && directCost !== null && option.costCoverage.state === 'complete' && contribution !== null;
  const commerciallyAllowed = commercialVerified && !contribution.isNegative() && (!minimumContributionRate || (contributionRate !== null && !contributionRate.lessThan(minimumContributionRate)));
  const operationallyAllowed = ['can-meet', 'can-meet-with-conditions'].includes(operations.verdict);
  const verdict = !commerciallyAllowed || !operationallyAllowed || blockers.length ? 'cannot-confirm' : conditions.length || operations.verdict === 'can-meet-with-conditions' ? 'can-with-conditions' : 'can';
  if (!commercialVerified && !blockers.length) addBlocker(blockerId('commercial', option.id), 'Commercial inputs are incomplete, so loss cannot be ruled out.', null, false);
  return DecisionOptionResultSchema.parse({
    id: option.id, title: option.title, verdict,
    metrics: {
      state: commercialVerified ? 'verified' : 'incomplete', currency: option.offer.currency,
      quotedSubtotal: subtotal, discount, tax, quotedTotal: total,
      directCost: directCost?.toFixed(scale) ?? null, contribution: contribution?.toFixed(scale) ?? null,
      contributionRate: contributionRate?.toFixed(2) ?? null,
      minimumContributionRate: minimumContributionRate?.toFixed(2) ?? null,
    },
    reasons, conditions, blockers, sourceRefs: uniqueRefs(sourceRefs), operations, draft: option,
  });
}

function difference(left: z.infer<typeof DecisionOptionResultSchema>, right: z.infer<typeof DecisionOptionResultSchema>) {
  const dimensions: z.infer<typeof DecisionDifferenceSchema>['dimensions'] = [];
  if (left.metrics.quotedTotal !== right.metrics.quotedTotal || left.metrics.contribution !== right.metrics.contribution) dimensions.push('price');
  const scope = (option: typeof left) => option.draft.offer.lines.map((line) => `${line.label}:${line.unit}:${line.quantity.value ?? '?'}`).sort().join('|');
  if (scope(left) !== scope(right)) dimensions.push('scope');
  if (left.operations.requestedDate !== right.operations.requestedDate || left.operations.earliestCompletionDate !== right.operations.earliestCompletionDate) dimensions.push('deadline');
  const capacity = (option: typeof left) => option.operations.capacity.map((item) => `${item.scope}:${item.requiredMinutes ?? '?'}:${item.availableMinutes ?? '?'}`).sort().join('|');
  if (capacity(left) !== capacity(right) || left.operations.verdict !== right.operations.verdict) dimensions.push('capacity');
  const terms = (option: typeof left) => [...option.draft.offer.terms, ...option.conditions.map((item) => item.message)].sort().join('|');
  if (terms(left) !== terms(right)) dimensions.push('conditions');
  if (!dimensions.length) throw new Error('commercial.errors.indistinguishableOptions');
  return DecisionDifferenceSchema.parse({ leftOptionId: left.id, rightOptionId: right.id, dimensions });
}

export function evaluateDecisionPortfolio(raw: z.input<typeof CompareDecisionOptionsSchema>, context: DecisionContext): DecisionPortfolio {
  const input = CompareDecisionOptionsSchema.parse(raw);
  for (const role of BusinessSourceRoleSchema.options) {
    if (!context.sourceRoles.some((assignment) => assignment.roles.includes(role))) throw new Error(`commercial.errors.missingSourceRole.${role}`);
  }
  const options = input.options.map((option) => optionResult(option, context));
  const first = options[0]!;
  const differences = options.slice(1).map((option) => difference(first, option));
  const blockers = options.flatMap((option) => option.blockers);
  const viable = options.filter((option) => option.verdict !== 'cannot-confirm');
  if (viable.length > 1) blockers.push({
    id: 'select_option', optionIds: viable.map((option) => option.id), userResolvable: true,
    question: `Which option should be used: ${viable.map((option) => `${option.id} (${option.title})`).join(', ')}?`,
    whyDecisionChanges: 'The selected trade-off determines the estimate, offer and operational plan that will be created.',
  });
  for (const option of viable.filter((item) => item.verdict === 'can-with-conditions')) blockers.push({
    id: blockerId('accept_conditions', option.id), optionIds: [option.id], userResolvable: true,
    question: `Use ${option.title} with the explicitly listed conditions?`,
    whyDecisionChanges: 'Accepting the named conditions determines whether the conditional estimate, offer and plan may be created.',
  });
  return DecisionPortfolioSchema.parse({ options, differences, blockers });
}

export function selectedDecision(portfolio: DecisionPortfolio, optionId: string, selectedOptionId: string | null, acceptedConditionIds: string[], answers: { questionId: string; answer: string }[]) {
  const option = portfolio.options.find((item) => item.id === optionId);
  if (!option || option.verdict === 'cannot-confirm' || !option.operations.planDraft) throw new Error('commercial.errors.optionNotSelectable');
  if (selectedOptionId !== option.id) throw new Error('commercial.errors.selectionRequired');
  const requiredConditions = portfolio.blockers.filter((blocker) => blocker.id.startsWith('accept_conditions_') && blocker.optionIds.includes(option.id)).map((blocker) => blocker.id);
  if (requiredConditions.some((id) => !acceptedConditionIds.includes(id))) throw new Error('commercial.errors.conditionAcceptanceRequired');
  const unresolved = option.blockers.filter((blocker) => blocker.id !== 'select_option' && !answers.some((answer) => answer.questionId === blocker.id));
  if (unresolved.length) throw new Error('commercial.errors.blockersRemain');
  return option;
}

export function buildSelectedDecision(option: z.infer<typeof DecisionOptionResultSchema>, context: Pick<DecisionContext, 'goal' | 'locale' | 'sources' | 'artifacts'>, id: () => string) {
  const offer = buildOffer(option.draft.offer as OfferInput, { goal: context.goal, sources: context.sources, artifacts: context.artifacts, locale: context.locale, id });
  if (offer.calculation.state !== 'verified' || offer.calculation.total !== option.metrics.quotedTotal) throw new Error('commercial.errors.decisionChanged');
  const planDraft = option.operations.planDraft;
  if (!planDraft || planDraft.content.kind !== 'plan') throw new Error('commercial.errors.planMissing');
  return { offer, plan: planDraft, sourceRefs: uniqueRefs([...option.sourceRefs, ...planDraft.sourceRefs]) };
}

export function decisionPresentation(portfolio: DecisionPortfolio) {
  return {
    options: portfolio.options.map((option) => ({ id: option.id, title: option.title, verdict: option.verdict, metrics: option.metrics, reasons: option.reasons, conditions: option.conditions })),
    differences: portfolio.differences,
  };
}
