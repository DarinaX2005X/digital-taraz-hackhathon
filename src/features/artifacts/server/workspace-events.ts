import type { PoolClient } from 'pg';
import { z } from 'zod';
import { WorkspaceCursorPositionSchema, WorkspaceCursorSchema, WorkspaceEventKindSchema, WorkspaceEventPayloadSchema, type WorkspaceCursorPosition } from '../../../contracts/events';
import { IdSchema, RevisionSchema } from '../../../contracts/primitives';
import type { WorkspaceAccess } from '../../identity/server/access';

export function encodeWorkspaceCursor(position: WorkspaceCursorPosition): string {
  return Buffer.from(JSON.stringify(WorkspaceCursorPositionSchema.parse(position)), 'utf8').toString('base64url');
}

export function decodeWorkspaceCursor(cursor: string): WorkspaceCursorPosition | undefined {
  const parsed = WorkspaceCursorSchema.safeParse(cursor);
  if (!parsed.success) return undefined;
  try {
    const position = WorkspaceCursorPositionSchema.safeParse(JSON.parse(Buffer.from(parsed.data, 'base64url').toString('utf8')));
    if (!position.success || BigInt(position.data.position) > 9223372036854775807n) return undefined;
    if (encodeWorkspaceCursor(position.data) !== parsed.data) return undefined;
    return position.data;
  } catch { return undefined; }
}

const EventInputSchema = z.strictObject({
  projectId: IdSchema, accessClass: z.enum(['internal', 'confidential']), kind: WorkspaceEventKindSchema,
  objectId: IdSchema, revision: RevisionSchema, payload: WorkspaceEventPayloadSchema,
});
export type WorkspaceEventInput = z.infer<typeof EventInputSchema>;

/** The trusted caller already authorized the affected projects before its effect.
 * Allocating under this row lock makes cursor order follow commit order, including
 * aborted transactions. Rechecking after a self-revocation would undo the revoke. */
export async function appendWorkspaceEvents(transaction: PoolClient, access: WorkspaceAccess, events: readonly WorkspaceEventInput[]): Promise<string> {
  const inputs = z.array(EventInputSchema).min(1).max(100).parse(events);
  await transaction.query('INSERT INTO workspace_event_heads(workspace_id) VALUES($1) ON CONFLICT DO NOTHING', [access.workspace.id]);
  const head = (await transaction.query<{ cursor: string }>('UPDATE workspace_event_heads SET cursor=cursor+$2 WHERE workspace_id=$1 RETURNING cursor::text', [access.workspace.id, inputs.length])).rows[0]!;
  const last = BigInt(head.cursor);
  for (const [index, event] of inputs.entries()) {
    await transaction.query('INSERT INTO workspace_events(workspace_id,cursor,project_id,access_class,kind,object_id,revision,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [access.workspace.id, (last - BigInt(inputs.length - index - 1)).toString(), event.projectId, event.accessClass, event.kind, event.objectId, event.revision, JSON.stringify(event.payload)]);
  }
  return encodeWorkspaceCursor({ workspaceId: access.workspace.id, authzVersion: access.workspace.authz_version, position: head.cursor });
}

/** Keep this lock while reading an ordinary (non-locking) snapshot. A mutation
 * cannot publish a newer head between the snapshot and its cursor. */
export async function lockWorkspaceSnapshotCursor(transaction: PoolClient, access: WorkspaceAccess): Promise<string> {
  await transaction.query('INSERT INTO workspace_event_heads(workspace_id) VALUES($1) ON CONFLICT DO NOTHING', [access.workspace.id]);
  const head = (await transaction.query<{ cursor: string }>('SELECT cursor::text FROM workspace_event_heads WHERE workspace_id=$1 FOR SHARE', [access.workspace.id])).rows[0]!;
  return encodeWorkspaceCursor({ workspaceId: access.workspace.id, authzVersion: access.workspace.authz_version, position: head.cursor });
}
