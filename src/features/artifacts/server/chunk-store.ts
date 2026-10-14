import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ContentValidationError } from '../domain/canonical';
import { MerkleJson, type ContentChunk } from '../domain/merkle-json';

export async function lockArtifactContentShared(transaction: PoolClient, workspaceId: string) {
  await transaction.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [`artifact-content:${workspaceId}`]);
}

/** Call only inside the workspace/record authorization transaction. Hashes are not access tokens. */
export function createChunkStore(transaction: PoolClient, workspaceId: string) {
  const prefetched = new Map<string, ContentChunk>();
  let locked: Promise<void> | undefined;
  const retain = () => locked ??= lockArtifactContentShared(transaction, workspaceId);
  const graph = new MerkleJson(async (hash) => {
    await retain();
    const cached = prefetched.get(hash);
    if (cached) return cached;
    const row = (await transaction.query<{ data: ContentChunk }>('SELECT data FROM artifact_chunks WHERE workspace_id=$1 AND hash=$2', [workspaceId, hash])).rows[0];
    if (!row) throw new ContentValidationError('missing-chunk');
    return row.data;
  });

  async function prefetch(root: string) {
    await retain();
    const rows = (await transaction.query<{ hash: string; data: ContentChunk }>(`WITH RECURSIVE reachable(hash) AS (
      SELECT $2::text UNION SELECT e.child_hash FROM artifact_chunk_edges e JOIN reachable r ON r.hash=e.parent_hash WHERE e.workspace_id=$1
    ) SELECT c.hash,c.data FROM artifact_chunks c JOIN reachable r ON r.hash=c.hash WHERE c.workspace_id=$1`, [workspaceId, root])).rows;
    for (const row of rows) prefetched.set(row.hash, row.data);
  }

  async function persist(root: string): Promise<{ id: string; hash: string }> {
    await retain();
    const pending = [root], needed = new Set<string>();
    while (pending.length) {
      const hash = pending.pop()!;
      if (needed.has(hash)) continue;
      const chunk = graph.prepared.get(hash);
      if (!chunk) continue;
      needed.add(hash);
      pending.push(...chunk.children);
    }
    const chunks = [...needed].map((hash) => graph.prepared.get(hash)!);
    for (let offset = 0; offset < chunks.length; offset += 100) {
      const batch = chunks.slice(offset, offset + 100).map((chunk) => ({ hash: chunk.hash, data: chunk.data, byte_size: chunk.byteSize }));
      await transaction.query(`INSERT INTO artifact_chunks(workspace_id,hash,data,byte_size)
        SELECT $1,x.hash,x.data,x.byte_size FROM jsonb_to_recordset($2::jsonb) AS x(hash text,data jsonb,byte_size integer)
        ON CONFLICT(workspace_id,hash) DO NOTHING`, [workspaceId, JSON.stringify(batch)]);
    }
    const edges = chunks.flatMap((chunk) => chunk.children.map((child) => ({ parent_hash: chunk.hash, child_hash: child })));
    for (let offset = 0; offset < edges.length; offset += 1000) {
      await transaction.query(`INSERT INTO artifact_chunk_edges(workspace_id,parent_hash,child_hash)
        SELECT $1,x.parent_hash,x.child_hash FROM jsonb_to_recordset($2::jsonb) AS x(parent_hash text,child_hash text)
        ON CONFLICT DO NOTHING`, [workspaceId, JSON.stringify(edges.slice(offset, offset + 1000))]);
    }
    await transaction.query('INSERT INTO artifact_content_manifests(id,workspace_id,root_hash) VALUES($1,$2,$3) ON CONFLICT(workspace_id,root_hash) DO NOTHING', [randomUUID(), workspaceId, root]);
    const manifest = (await transaction.query<{ id: string }>('SELECT id FROM artifact_content_manifests WHERE workspace_id=$1 AND root_hash=$2', [workspaceId, root])).rows[0];
    if (!manifest) throw new ContentValidationError('missing-manifest');
    return { id: manifest.id, hash: root };
  }

  return { graph, prefetch, persist };
}
