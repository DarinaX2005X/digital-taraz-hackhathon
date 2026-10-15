import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { IdentityActor } from '@/features/identity/server/handlers';
import { assertOrigin, errorResponse, IdentityError, json, limit, readJson, validate } from '@/features/identity/server/http';
import { withWorkspaceAccess, lockProjectAccess, type SessionPrincipal } from '@/features/identity/server/access';
import { assertActorHeader, idempotencyKey, queryObject } from '@/features/artifacts/server/http';
import { createArtifactService } from '@/features/artifacts/server/service';
import { createSourceDocumentAdapter } from '@/features/sources/server/document-input';
import type { LocalSourceStorage } from '@/features/sources/server/storage';
import { ContentValidationError, hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { DocumentImportPreviewSchema, DocumentImportRequestSchema } from '../contracts';
import { importDocx } from './docx';

function importIds(operationId: string) {
  let index = 0;
  return () => {
    const hex = createHash('sha256').update(`tirlik-docx-1:${operationId}:${index++}`).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
}

export function createDocumentImportHandler(options: { pool: Pool; origin: string; getActor(headers: Headers): Promise<IdentityActor>; storage?: LocalSourceStorage }) {
  const sources = createSourceDocumentAdapter(options.pool, options.storage), artifacts = createArtifactService(options.pool);
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== 'POST') throw new IdentityError('NOT_FOUND', 'documents.errors.notFound');
      assertOrigin(request, options.origin); queryObject(new URL(request.url), []);
      const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
      const principal: SessionPrincipal = { kind: 'session', userId: actor.user.id, sessionId: actor.session.id };
      const input = validate(DocumentImportRequestSchema, await readJson(request)), operationId = idempotencyKey(request);
      await limit(options.pool, `document-import:${actor.user.id}`, 30, 60);
      const original = await sources.read(principal, { workspaceId: input.workspaceId, sourceId: input.sourceId, uploadId: input.uploadId });
      await withWorkspaceAccess(options.pool, principal, { workspaceId: input.workspaceId, scope: 'edit' }, async (tx, access) => {
        if (access.workspace.authz_version !== input.expectedAuthzVersion) throw new IdentityError('CONFLICT', 'documents.errors.accessChanged');
        await lockProjectAccess(tx, access, { projectId: original.projectId, scope: 'edit', confidential: original.accessClass === 'confidential' });
      });
      const converted = await importDocx(original.bytes, { makeId: importIds(operationId), storeImage: async (bytes) => sources.persistImage(principal, { ...input, bytes, producerKey: `docx-image:${createHash('sha256').update(bytes).digest('hex')}` }) });
      const title = input.title ?? original.fileName.replace(/\.docx$/i, '').slice(0, 240);
      const data = { title, projectId: original.projectId, sourceRef: original.sourceRef, ...converted };
      const preview = DocumentImportPreviewSchema.parse({ ...data, previewHash: hashJson(data as unknown as JsonValue) });
      if (input.action === 'preview') return json(preview);
      if (input.previewHash !== preview.previewHash) throw new IdentityError('CONFLICT', 'documents.errors.importChanged');
      const created = await artifacts.create(principal, operationId, { workspaceId: input.workspaceId, projectId: original.projectId, expectedAuthzVersion: input.expectedAuthzVersion, title, content: converted.content, sourceRefs: [original.sourceRef], accessClass: original.accessClass });
      return json(created, 201);
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof ContentValidationError) return errorResponse(new IdentityError('VALIDATION_FAILED', 'documents.errors.importInvalid'));
      return errorResponse(error);
    }
  };
}
