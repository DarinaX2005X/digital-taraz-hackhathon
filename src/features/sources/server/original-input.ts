import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema } from '../../../contracts/primitives';
import { withWorkspaceAccess, type SessionPrincipal } from '../../identity/server/access';
import { validate } from '../../identity/server/http';
import { inspectRelationships, readOfficeArchive } from './archive';
import { readPinnedSource } from './pinned-source';
import { createSourceService } from './service';
import { LocalSourceStorage } from './storage';

const InputSchema = z.strictObject({ workspaceId: IdSchema, sourceId: IdSchema, sourceVersionId: IdSchema });

/** Shared Office/table conversion input. The caller selects an immutable version, never a mutable head. */
export function createSourceOriginalAdapter(pool: Pool, storage = new LocalSourceStorage()) {
  const sources = createSourceService(pool, storage);
  async function readPublishedOriginal(principal: SessionPrincipal, raw: z.infer<typeof InputSchema>) {
    const input = validate(InputSchema, raw);
    const pinned = () => withWorkspaceAccess(pool, principal, { workspaceId: input.workspaceId, scope: 'read' },
      (tx, access) => readPinnedSource(tx, access, { sourceId: input.sourceId, sourceVersionId: input.sourceVersionId }));
    const source = await pinned();
    const original = await sources.download(principal, input.workspaceId, input.sourceId, source.uploadId);
    if (source.manifest.format === 'xlsx' || source.manifest.format === 'docx') inspectRelationships(await readOfficeArchive(original.bytes));
    // Parsing and filesystem I/O may outlive a grant. Never return private bytes after revocation.
    await pinned();
    return { bytes: original.bytes, fileName: original.fileName, format: source.manifest.format, options: source.manifest.options,
      sourceRef: source.sourceRef, projectId: source.projectId, accessClass: source.accessClass };
  }
  return { readPublishedOriginal };
}
