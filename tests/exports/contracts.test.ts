import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CreateExportSchema } from '../../src/features/exports/contracts';
describe('export selection boundary', () => {
  const request = () => ({ workspaceId: randomUUID(), expectedAuthzVersion: 1, locale: 'ru', items: [{ artifactId: randomUUID(), revision: 0, formats: ['docx', 'pdf'] }] });
  it('requires an exact revision and defaults to a nonhistorical export', () => { const parsed = CreateExportSchema.parse(request()); expect(parsed.historicalDraft).toBe(false); expect(parsed.items[0]!.revision).toBe(0); expect(CreateExportSchema.safeParse({ ...request(), items: [{ artifactId: randomUUID(), formats: ['pdf'] }] }).success).toBe(false); });
  it('rejects duplicate artifact and output selections', () => { const body = request(); expect(CreateExportSchema.safeParse({ ...body, items: [body.items[0], body.items[0]] }).success).toBe(false); expect(CreateExportSchema.safeParse({ ...body, items: [{ ...body.items[0], formats: ['pdf', 'pdf'] }] }).success).toBe(false); });
});
