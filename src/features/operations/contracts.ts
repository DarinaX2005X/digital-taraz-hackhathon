import { z } from 'zod';

import { SourceRefSchema } from '@/contracts/artifacts';
import { PlanEntrySchema } from '@/features/artifacts/domain/content-models';
import {
  CalendarDateSchema,
  ElementIdSchema,
  IdSchema,
  InstantSchema,
  RevisionSchema,
} from '@/contracts/primitives';

export const ResourceAccessClassSchema = z.enum(['internal', 'confidential']);
export const WorkResourceKindSchema = z.enum(['person', 'equipment', 'place', 'other']);
export const WorkResourceStatusSchema = z.enum(['active', 'archived']);

export const WorkResourceSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  displayName: z.string().trim().min(1).max(160),
  kind: WorkResourceKindSchema,
  status: WorkResourceStatusSchema,
  membershipId: IdSchema.nullable(),
  timezone: z.string().trim().min(1).max(80),
  accessClass: ResourceAccessClassSchema,
  notes: z.string().max(4000).optional(),
  revision: RevisionSchema,
  currentAvailabilityVersionId: IdSchema.nullable(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});

/** Immutable display metadata used by historical plans and fixed exports. */
export const WorkResourceVersionSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  resourceId: IdSchema,
  revision: RevisionSchema,
  displayName: z.string().trim().min(1).max(160),
  kind: WorkResourceKindSchema,
  membershipId: IdSchema.nullable(),
  timezone: z.string().trim().min(1).max(80),
  accessClass: ResourceAccessClassSchema,
  notes: z.string().max(4000).optional(),
  status: WorkResourceStatusSchema,
  currentAvailabilityVersionId: IdSchema.nullable(),
  createdBy: IdSchema,
  createdAt: InstantSchema,
}).refine((version) => version.revision >= 1, { path: ['revision'], message: 'Resource revisions start at one.' });

export const AvailabilityIntervalSchema = z.strictObject({
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
}).refine((interval) => interval.startMinute < interval.endMinute, {
  message: 'Availability intervals must have positive length.',
});

export const AvailabilityWeekdaySchema = z.strictObject({
  weekday: z.number().int().min(1).max(7),
  intervals: z.array(AvailabilityIntervalSchema).max(24),
});

export const AvailabilityExceptionSchema = z.strictObject({
  date: CalendarDateSchema,
  intervals: z.array(AvailabilityIntervalSchema).max(24),
  label: z.string().trim().min(1).max(240).optional(),
});

export const AvailabilityVersionSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  resourceId: IdSchema,
  revision: RevisionSchema,
  timezone: z.string().trim().min(1).max(80),
  effectiveFrom: CalendarDateSchema,
  effectiveTo: CalendarDateSchema.nullable(),
  weekdays: z.array(AvailabilityWeekdaySchema).max(7),
  exceptions: z.array(AvailabilityExceptionSchema).max(730),
  sourceRefs: z.array(SourceRefSchema).max(100),
  verifiedAt: InstantSchema.nullable(),
  note: z.string().max(4000).optional(),
  createdBy: IdSchema,
  createdAt: InstantSchema,
}).superRefine((version, context) => {
  if (version.revision < 1) context.addIssue({ code: 'custom', path: ['revision'], message: 'Availability revisions start at one.' });
  if (version.effectiveTo !== null && version.effectiveTo < version.effectiveFrom) {
    context.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'The effective range is reversed.' });
  }
  if (new Set(version.weekdays.map((day) => day.weekday)).size !== version.weekdays.length) {
    context.addIssue({ code: 'custom', path: ['weekdays'], message: 'A weekday may be defined once.' });
  }
  if (new Set(version.exceptions.map((day) => day.date)).size !== version.exceptions.length) {
    context.addIssue({ code: 'custom', path: ['exceptions'], message: 'An exception date may be defined once.' });
  }
  for (const [index, day] of version.weekdays.entries()) validateIntervals(day.intervals, context, ['weekdays', index, 'intervals']);
  for (const [index, day] of version.exceptions.entries()) validateIntervals(day.intervals, context, ['exceptions', index, 'intervals']);
});

function validateIntervals(
  intervals: readonly z.infer<typeof AvailabilityIntervalSchema>[],
  context: z.RefinementCtx,
  path: (string | number)[],
) {
  const sorted = [...intervals].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]!.startMinute < sorted[index - 1]!.endMinute) {
      context.addIssue({ code: 'custom', path, message: 'Availability intervals may not overlap.' });
      break;
    }
  }
}

// These aliases deliberately consume the canonical PlanEntry contract. The
// artifact service remains the single persistence validator for every editor.
export const ResourceAssignmentSchema = PlanEntrySchema.shape.assignments.unwrap().element;
export const PlanCalendarIdentitySchema = PlanEntrySchema.shape.calendar.unwrap();
export const CapacityOverrideSchema = PlanEntrySchema.shape.capacityOverride.unwrap();
export const OperationalPlanEntrySchema = PlanEntrySchema;

export const WorkResourceListInputSchema = z.strictObject({
  workspaceId: IdSchema,
  query: z.string().trim().max(200).default(''),
  kinds: z.array(WorkResourceKindSchema).max(4).default([]),
  status: WorkResourceStatusSchema.default('active'),
  after: z.string().regex(/^[A-Za-z0-9_-]+$/).max(2048).optional(),
  limit: z.number().int().min(1).max(50).default(30),
});

export const ResourceViewerSchema = z.strictObject({
  userId: IdSchema,
  workspaceId: IdSchema,
  authzVersion: z.number().int().positive(),
});

export const WorkResourceListSchema = z.strictObject({
  viewer: ResourceViewerSchema,
  resources: z.array(WorkResourceSchema).max(50),
  nextAfter: z.string().nullable(),
});

export const CreateWorkResourceSchema = z.strictObject({
  workspaceId: IdSchema,
  expectedAuthzVersion: z.number().int().positive(),
  displayName: z.string().trim().min(1).max(160),
  kind: WorkResourceKindSchema,
  membershipId: IdSchema.optional(),
  timezone: z.string().trim().min(1).max(80),
  accessClass: ResourceAccessClassSchema.default('internal'),
  notes: z.string().max(4000).optional(),
});

export const UpdateWorkResourceSchema = z.strictObject({
  workspaceId: IdSchema,
  expectedAuthzVersion: z.number().int().positive(),
  expectedRevision: RevisionSchema,
  displayName: z.string().trim().min(1).max(160).optional(),
  kind: WorkResourceKindSchema.optional(),
  membershipId: IdSchema.nullable().optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  accessClass: ResourceAccessClassSchema.optional(),
  notes: z.string().max(4000).nullable().optional(),
  status: WorkResourceStatusSchema.optional(),
}).refine((value) => Object.keys(value).some((key) => !['workspaceId', 'expectedAuthzVersion', 'expectedRevision'].includes(key)), {
  message: 'At least one resource field must change.',
});

export const CreateAvailabilityVersionSchema = z.strictObject({
  workspaceId: IdSchema,
  expectedAuthzVersion: z.number().int().positive(),
  expectedResourceRevision: RevisionSchema,
  timezone: z.string().trim().min(1).max(80),
  effectiveFrom: CalendarDateSchema,
  effectiveTo: CalendarDateSchema.nullable().default(null),
  weekdays: z.array(AvailabilityWeekdaySchema).max(7),
  exceptions: z.array(AvailabilityExceptionSchema).max(730).default([]),
  sourceRefs: z.array(SourceRefSchema).max(100).default([]),
  verifiedAt: InstantSchema.nullable().default(null),
  note: z.string().max(4000).optional(),
}).refine((value) => value.sourceRefs.length === 0 || value.verifiedAt !== null, {
  path: ['verifiedAt'], message: 'Source-backed availability must include a verification time.',
});

export const WorkResourceResultSchema = z.strictObject({ viewer: ResourceViewerSchema, resource: WorkResourceSchema });
export const AvailabilityVersionResultSchema = z.strictObject({ viewer: ResourceViewerSchema, resource: WorkResourceSchema, version: AvailabilityVersionSchema });
export const AvailabilityHistorySchema = z.strictObject({ viewer: ResourceViewerSchema, resource: WorkResourceSchema, versions: z.array(AvailabilityVersionSchema).max(100), nextBeforeRevision: RevisionSchema.nullable() });

export const PlanExportResourceSchema = z.strictObject({
  resourceId: IdSchema,
  resourceRevision: RevisionSchema,
  displayName: z.string().trim().min(1).max(160),
  kind: WorkResourceKindSchema,
  timezone: z.string().min(1).max(80),
  availability: z.strictObject({
    id: IdSchema,
    revision: RevisionSchema,
    timezone: z.string().min(1).max(80),
    effectiveFrom: CalendarDateSchema,
    effectiveTo: CalendarDateSchema.nullable(),
    verifiedAt: InstantSchema.nullable(),
  }).optional(),
});
export const PlanExportResourceResolutionSchema = z.strictObject({
  resources: z.array(PlanExportResourceSchema).max(2000),
  warnings: z.array(z.strictObject({ code: z.enum(['resource-name-not-pinned', 'availability-version-unavailable']), resourceId: IdSchema })).max(2000),
});

export const CapacityReasonSchema = z.enum([
  'resource-unassigned',
  'resource-archived',
  'availability-version-missing',
  'availability-version-mismatch',
  'availability-not-effective',
  'schedule-missing',
  'effort-missing',
  'effort-unit-unknown',
  'duration-missing',
  'scheduled-outside-availability',
  'effort-exceeds-window',
  'overlapping-effort-exceeds-capacity',
  'scope-too-large',
]);

export const CapacityAssessmentSchema = z.strictObject({
  resourceId: IdSchema,
  availabilityVersionId: IdSchema.optional(),
  status: z.enum(['conflict', 'within-known-capacity', 'availability-unknown']),
  scope: z.enum(['instant-window', 'local-date-range', 'unresolved']),
  timezone: z.string().max(80).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  demandedMinutes: z.number().finite().nonnegative().optional(),
  availableMinutes: z.number().finite().nonnegative().optional(),
  affectedEntryIds: z.array(ElementIdSchema).min(1).max(20000),
  reasons: z.array(CapacityReasonSchema).max(20),
});

export type WorkResource = z.infer<typeof WorkResourceSchema>;
export type WorkResourceVersion = z.infer<typeof WorkResourceVersionSchema>;
export type PlanExportResource = z.infer<typeof PlanExportResourceSchema>;
export type PlanExportResourceResolution = z.infer<typeof PlanExportResourceResolutionSchema>;
export type AvailabilityInterval = z.infer<typeof AvailabilityIntervalSchema>;
export type AvailabilityVersion = z.infer<typeof AvailabilityVersionSchema>;
export type ResourceAssignment = z.infer<typeof ResourceAssignmentSchema>;
export type OperationalEntryFields = Pick<z.infer<typeof PlanEntrySchema>, 'description' | 'assignments' | 'linkedArtifactIds' | 'sourceRefs' | 'calendar' | 'capacityOverride'>;
export type CapacityAssessment = z.infer<typeof CapacityAssessmentSchema>;
export type CreateWorkResource = z.infer<typeof CreateWorkResourceSchema>;
export type UpdateWorkResource = z.infer<typeof UpdateWorkResourceSchema>;
export type CreateAvailabilityVersion = z.infer<typeof CreateAvailabilityVersionSchema>;

