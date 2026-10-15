import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import Decimal from 'decimal.js';
import type { IdentityActor } from '@/features/identity/server/handlers';
import { assertOrigin, errorResponse, IdentityError, json, limit, readJson, validate } from '@/features/identity/server/http';
import { withWorkspaceAccess, lockProjectAccess, type SessionPrincipal } from '@/features/identity/server/access';
import { assertActorHeader, idempotencyKey, queryObject } from '@/features/artifacts/server/http';
import { createArtifactService } from '@/features/artifacts/server/service';
import { createSourceOriginalAdapter } from '@/features/sources/server/original-input';
import { createDatasetService } from '@/features/materials/server/datasets';
import type { LocalSourceStorage } from '@/features/sources/server/storage';
import { ContentValidationError } from '@/features/artifacts/domain/canonical';
import type { TableCell } from '@/features/artifacts/domain/content-models';
import type { FieldBinding, SourceRef } from '@/contracts/artifacts';
import type { MaterialCell } from '@/contracts/materials';
import { currencyMinorUnitScale } from '@/contracts/calculations';
import { SheetImportRequestSchema, SheetMaterializeRequestSchema } from '../contracts';
import { createBlankTable, MAX_ROWS, stableCellId } from '../domain/model';
import { importTable } from './import';
const Exact = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });

export function materialValue(cell: MaterialCell | undefined): TableCell {
  if (!cell || cell.value.kind === 'unknown' || cell.reviewState === 'needs-review') return {};
  const value = cell.value;
  if (value.kind === 'text') return { v: value.text, t: 1 };
  if (value.kind === 'date') return { v: value.date, t: 1 };
  const scale = value.kind === 'money' ? currencyMinorUnitScale(value.currency) : undefined;
  const exact = value.kind === 'money' ? new Exact(value.minorUnits).div(new Exact(10).pow(scale!)).toFixed(scale) : value.decimal;
  const number = Number(exact);
  // Large exact inputs remain text rather than being silently rounded by JS.
  return Number.isFinite(number) && new Exact(String(number)).eq(exact) ? { v: number, t: 2 } : { v: exact, t: 1 };
}

export function createSheetHandlers(options: { pool: Pool; origin: string; getActor(headers: Headers): Promise<IdentityActor>; storage?: LocalSourceStorage }) {
  const sources = createSourceOriginalAdapter(options.pool, options.storage), artifacts = createArtifactService(options.pool), datasets = createDatasetService(options.pool);
  async function guard(principal: SessionPrincipal, workspaceId: string, expectedAuthzVersion: number, projectId: string, confidential: boolean) {
    await withWorkspaceAccess(options.pool, principal, { workspaceId, scope: 'edit' }, async (tx, access) => {
      if (access.workspace.authz_version !== expectedAuthzVersion) throw new IdentityError('CONFLICT', 'sheets.errors.accessChanged');
      await lockProjectAccess(tx, access, { projectId, scope: 'edit', confidential });
    });
  }
  return async (request: Request, action: 'import' | 'materialize'): Promise<Response> => {
    try {
      if (request.method !== 'POST') throw new IdentityError('NOT_FOUND', 'sheets.errors.notFound');
      assertOrigin(request, options.origin); queryObject(new URL(request.url), []);
      const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
      const principal: SessionPrincipal = { kind: 'session', userId: actor.user.id, sessionId: actor.session.id };
      const operationId = idempotencyKey(request), body = await readJson(request);
      await limit(options.pool, `sheet-create:${actor.user.id}`, 30, 60);
      if (action === 'import') {
        const input = validate(SheetImportRequestSchema, body);
        const original = await sources.readPublishedOriginal(principal, { workspaceId: input.workspaceId, sourceId: input.sourceId, sourceVersionId: input.sourceVersionId });
        if (!['xlsx', 'csv', 'tsv'].includes(original.format)) throw new IdentityError('VALIDATION_FAILED', 'sheets.errors.importFormat');
        await guard(principal, input.workspaceId, input.expectedAuthzVersion, original.projectId, original.accessClass === 'confidential');
        const converted = await importTable(original.bytes, { ...original.options, fileName: original.fileName, format: original.format as 'xlsx' | 'csv' | 'tsv', seed: operationId, signal: request.signal });
        const title = input.title ?? original.fileName.replace(/\.(xlsx|csv|tsv)$/i, '').slice(0, 240);
        const previewHash = createHash('sha256').update(JSON.stringify({ hash: converted.previewHash, title, sourceRef: original.sourceRef })).digest('hex');
        if (input.action === 'preview') return json({ title, sample: converted.sample, warnings: converted.warnings, previewHash });
        if (input.previewHash !== previewHash) throw new IdentityError('CONFLICT', 'sheets.errors.importChanged');
        return json(await artifacts.create(principal, operationId, { workspaceId: input.workspaceId, projectId: original.projectId, expectedAuthzVersion: input.expectedAuthzVersion, title, content: converted.content, sourceRefs: [original.sourceRef], accessClass: original.accessClass }), 201);
      }
      const input = validate(SheetMaterializeRequestSchema, body);
      const first = await datasets.query(principal, { workspaceId: input.workspaceId, collectionId: input.collectionId, revision: input.revision, fieldIds: input.fieldIds, filters: input.filters, query: input.query, limit: 50 });
      await guard(principal, input.workspaceId, input.expectedAuthzVersion, first.collection.projectId, first.collection.accessClass === 'confidential');
      if (first.total >= MAX_ROWS) throw new IdentityError('VALIDATION_FAILED', 'sheets.errors.materializeRange');
      const fields = (first.collection.mapping?.fields ?? []).filter((field) => !input.fieldIds || input.fieldIds.includes(field.id));
      if (!fields.length || first.total * fields.length > 1000) throw new IdentityError('VALIDATION_FAILED', 'sheets.errors.materializeBindings');
      let sequence = 0;
      const id = () => `sheet_${createHash('sha256').update(`${operationId}:${sequence++}`).digest('hex').slice(0, 24)}`;
      const title = input.title ?? first.collection.title;
      const content = createBlankTable(title, { id, rows: Math.max(100, first.total + 1), columns: Math.max(26, fields.length) });
      const sheetId = content.workbook.sheetOrder[0]!, sheet = content.workbook.sheets[sheetId]!;
      sheet.cellData[0] = {}; sheet.columnData = {};
      fields.forEach((field, c) => {
        sheet.cellData[0]![c] = { v: field.label, t: 1, s: { bl: 1, bg: { rgb: '#E9EEE8' } } };
        sheet.columnData![c] = { w: 160, tirlikUnit: field.kind === 'money' ? { kind: 'money', currency: field.currency } : field.kind === 'quantity' ? { kind: 'quantity', unit: field.unit } : { kind: field.kind === 'decimal' ? 'number' : field.kind } };
      });
      const bindings: FieldBinding[] = [], sourceRefs: SourceRef[] = [];
      let page = first, row = 1;
      for (;;) {
        for (const record of page.records) {
          sheet.cellData[row] = {};
          fields.forEach((field, c) => {
            const cell = record.cells[field.id]; sheet.cellData[row]![c] = materialValue(cell);
            if (cell) { sourceRefs.push(cell.sourceRef); bindings.push({ targetElementId: stableCellId(content, { sheetId, row, column: c }), sourceRef: cell.sourceRef, transformId: 'material-cell-v1', updateMode: 'propose' }); }
          });
          row++;
        }
        if (!page.nextCursor) break;
        page = await datasets.query(principal, { workspaceId: input.workspaceId, collectionId: input.collectionId, revision: first.revision, fieldIds: input.fieldIds, filters: input.filters, query: input.query, after: page.nextCursor, limit: 50 });
      }
      if (row - 1 !== first.total) throw new IdentityError('CONFLICT', 'sheets.errors.materializeChanged');
      return json(await artifacts.create(principal, operationId, { workspaceId: input.workspaceId, projectId: first.collection.projectId, expectedAuthzVersion: input.expectedAuthzVersion, title, content, sourceRefs, bindings, accessClass: first.collection.accessClass }), 201);
    } catch (error) {
      if (error instanceof IdentityError) return errorResponse(error);
      if (error instanceof z.ZodError || error instanceof ContentValidationError || error instanceof Error && error.message.startsWith('sheets.errors.')) return errorResponse(new IdentityError('VALIDATION_FAILED', error instanceof Error && error.message.startsWith('sheets.errors.') ? error.message : 'sheets.errors.invalid'));
      return errorResponse(error);
    }
  };
}
