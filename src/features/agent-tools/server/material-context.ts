import type { Pool } from 'pg';
import { MaterialDecisionContextInputSchema, MaterialDecisionContextSchema } from '../../../contracts/materials';
import { RunError } from '../../runs/domain/errors';
import { createMaterialDecisionContextReader } from '../../materials/server/datasets';
import type { BusinessToolExtension } from './business';
import { MaterialEvidenceContextSchema, principalFor } from './context';

/** Bounded structured-data reader for the assistant; it reuses Materials ACL/query authority. */
export function materialContextBusinessToolExtension(pool: Pool): BusinessToolExtension {
  const reader = createMaterialDecisionContextReader(pool);
  return () => [{
    name: 'query_material_context',
    description: 'Query a pinned material collection with a validated AST and return exact aggregates, coverage, optional bounded groups and SourceRef evidence. Use for large structured data instead of loading raw rows into model context.',
    schema: MaterialDecisionContextInputSchema,
    output: MaterialEvidenceContextSchema,
    action: 'read_sources',
    costClass: 'local',
    available: (state) => state.sources.length > 0 || state.datasets.length > 0,
    prepare: async (raw, context) => {
      const input = MaterialDecisionContextInputSchema.parse(raw);
      if (input.workspaceId !== context.workspaceId) throw new RunError('access_changed', 'NOT_FOUND');
      return reader.read(principalFor(context), input);
    },
    effect: async (_tx, _raw, _context, state, prepared) => {
      const full = MaterialDecisionContextSchema.parse(prepared);
      const evidence = MaterialEvidenceContextSchema.parse({
        collection: full.collection, revision: full.revision, schema: full.schema,
        matchedRecords: full.matchedRecords, truncated: full.truncated,
        aggregates: full.aggregates, ...(full.grouped ? { grouped: full.grouped } : {}),
        evidenceRefs: full.evidenceRefs, evidenceTruncated: full.evidenceTruncated,
      });
      const datasets = [...state.datasets.filter((item) => item.collection.id !== evidence.collection.id || item.revision !== evidence.revision), evidence].slice(-3);
      const next = { ...state, datasets, decision: null, selectedOptionId: null, acceptedConditionIds: [], bundle: null };
      if (Buffer.byteLength(JSON.stringify(next)) > 180_000) throw new RunError('invalid_result');
      return { output: evidence, context: next };
    },
  }];
}

