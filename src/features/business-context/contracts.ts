import { z } from 'zod';
import {
  BusinessBrandKitSchema,
  BusinessContextItemSchema,
  BusinessContextReadSchema,
  BusinessContextSelectionSchema,
  BusinessContextValueSchema,
} from '../../contracts/business-work';
import { IdSchema, InstantSchema } from '../../contracts/primitives';
import { AuthzVersionSchema } from '../identity/contracts';

export const ContextRevisionSchema = z.number().int().positive().max(2_147_483_647);

export const BusinessContextSummarySchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema.nullable(),
  scope: z.enum(['workspace', 'project']),
  ownerId: IdSchema,
  title: z.string().min(1).max(240),
  currentRevision: ContextRevisionSchema,
  status: z.enum(['active', 'archived']),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  permissions: z.strictObject({ read: z.literal(true), edit: z.boolean(), confirm: z.boolean(), archive: z.boolean() }),
});

export const BusinessContextVersionSchema = z.strictObject({
  id: IdSchema,
  contextId: IdSchema,
  revision: ContextRevisionSchema,
  workspaceId: IdSchema,
  projectId: IdSchema.nullable(),
  scope: z.enum(['workspace', 'project']),
  ownerId: IdSchema,
  title: z.string().min(1).max(240),
  items: z.array(BusinessContextItemSchema).max(200),
  brandKit: BusinessBrandKitSchema,
  reason: z.string().min(1).max(1_000),
  createdBy: IdSchema,
  createdAt: InstantSchema,
}).superRefine((version, context) => {
  if (new Set(version.items.map((item) => item.id)).size !== version.items.length) context.addIssue({ code: 'custom', path: ['items'], message: 'Context item ids must be unique.' });
  if ((version.scope === 'project') !== Boolean(version.projectId)) context.addIssue({ code: 'custom', path: ['projectId'], message: 'Project context scope requires a project.' });
});

export const BusinessContextDetailSchema = z.strictObject({
  context: BusinessContextSummarySchema,
  version: BusinessContextVersionSchema,
  authzVersion: AuthzVersionSchema,
});

const ScopeFields = {
  workspaceId: IdSchema,
  scope: z.enum(['workspace', 'project']),
  projectId: IdSchema.nullable(),
};
const SnapshotFields = {
  title: z.string().trim().min(1).max(240),
  items: z.array(BusinessContextItemSchema).max(200),
  brandKit: BusinessBrandKitSchema,
};

export const CreateBusinessContextSchema = z.strictObject({
  ...ScopeFields,
  ...SnapshotFields,
  reason: z.string().trim().min(1).max(1_000),
  expectedAuthzVersion: AuthzVersionSchema,
}).superRefine((input, context) => {
  if ((input.scope === 'project') !== Boolean(input.projectId)) context.addIssue({ code: 'custom', path: ['projectId'], message: 'Project context scope requires a project.' });
  if (new Set(input.items.map((item) => item.id)).size !== input.items.length) context.addIssue({ code: 'custom', path: ['items'], message: 'Context item ids must be unique.' });
});

export const UpdateBusinessContextSchema = z.strictObject({
  workspaceId: IdSchema,
  expectedAuthzVersion: AuthzVersionSchema,
  expectedRevision: ContextRevisionSchema,
  ...SnapshotFields,
  reason: z.string().trim().min(1).max(1_000),
}).superRefine((input, context) => {
  if (new Set(input.items.map((item) => item.id)).size !== input.items.length) context.addIssue({ code: 'custom', path: ['items'], message: 'Context item ids must be unique.' });
});

export const SetContextStatusSchema = z.strictObject({
  workspaceId: IdSchema,
  expectedAuthzVersion: AuthzVersionSchema,
  expectedRevision: ContextRevisionSchema,
  status: z.enum(['active', 'archived']),
});

export const ListBusinessContextsSchema = z.strictObject({
  workspaceId: IdSchema,
  projectId: IdSchema.optional(),
  status: z.enum(['active', 'archived']).default('active'),
  query: z.string().trim().max(200).default(''),
  limit: z.number().int().min(1).max(100).default(50),
});

export const BusinessContextListSchema = z.strictObject({
  contexts: z.array(BusinessContextSummarySchema).max(100),
  authzVersion: AuthzVersionSchema,
});

export const ContextOverrideSchema = z.strictObject({
  itemId: z.string().min(1).max(128),
  value: BusinessContextValueSchema,
});
export const UseBusinessContextSchema = z.strictObject({
  workspaceId: IdSchema,
  selection: BusinessContextSelectionSchema,
  overrides: z.array(ContextOverrideSchema).max(200),
}).superRefine((input, context) => {
  const selected = new Set(input.selection.itemIds);
  const overrides = input.overrides.map((item) => item.itemId);
  if (new Set(overrides).size !== overrides.length) context.addIssue({ code: 'custom', path: ['overrides'], message: 'Context overrides must be unique.' });
  if (overrides.some((id) => !selected.has(id))) context.addIssue({ code: 'custom', path: ['overrides'], message: 'Overrides may only target selected context items.' });
});
export const UsedBusinessContextSchema = z.strictObject({
  selection: BusinessContextSelectionSchema,
  context: BusinessContextReadSchema,
  effectiveItems: z.array(BusinessContextItemSchema).max(200),
  overrideItemIds: z.array(z.string().min(1).max(128)).max(200),
});

export type BusinessContextSummary = z.infer<typeof BusinessContextSummarySchema>;
export type BusinessContextVersion = z.infer<typeof BusinessContextVersionSchema>;
export type BusinessContextDetail = z.infer<typeof BusinessContextDetailSchema>;
export type BusinessContextList = z.infer<typeof BusinessContextListSchema>;
