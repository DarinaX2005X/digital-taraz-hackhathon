import { Pool } from 'pg';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoSeed } from '../../src/features/demo/domain/sample';
import { demoCopy } from '../../src/features/demo/locales';

let pool: Pool, origin: string;
beforeAll(() => {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  const database = new URL(process.env.DATABASE_URL ?? '');
  origin = `http://127.0.0.1:${process.env.TIRLIK_TEST_APP_PORT}`;
  if (database.hostname !== '127.0.0.1' || database.pathname !== '/tirlik' || new URL(origin).hostname !== '127.0.0.1' || process.env.OPENROUTER_API_KEY || process.env.BREVO_API_KEY || process.env.SMTP_PASSWORD) throw new Error('ISOLATED_LOCAL_SERVICES_REQUIRED');
  pool = new Pool({ connectionString: database.href });
});
afterAll(async () => { await pool?.end(); });

async function durableCounts() {
  return (await pool.query(`SELECT
    (SELECT count(*) FROM identity_users)::int AS users,
    (SELECT count(*) FROM identity_workspaces)::int AS workspaces,
    (SELECT count(*) FROM identity_intents)::int AS intents,
    (SELECT count(*) FROM projects)::int AS projects,
    (SELECT count(*) FROM artifacts)::int AS artifacts,
    (SELECT count(*) FROM artifact_versions)::int AS versions,
    (SELECT count(*) FROM artifact_command_groups)::int AS command_groups,
    (SELECT count(*) FROM sources)::int AS sources,
    (SELECT count(*) FROM material_collections)::int AS collections,
    (SELECT count(*) FROM dependency_changesets)::int AS changesets,
    (SELECT count(*) FROM export_jobs)::int AS export_jobs,
    (SELECT count(*) FROM agent_runs)::int AS agent_runs,
    (SELECT count(*) FROM agent_run_usage)::int AS provider_usage,
    (SELECT count(*) FROM agent_model_outputs)::int AS model_outputs`)).rows[0];
}
describe('mounted isolated public example', () => {
  it.each(['ru', 'kk', 'en'] as const)('serves the %s example route without personal records or provider work', async (locale) => {
    const before = await durableCounts();
    const response = await fetch(`${origin}/${locale}/demo`, { headers: { 'Accept-Language': locale }, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain(`lang="${locale}"`); expect(html).toContain(demoCopy[locale].title); expect(html).toContain(demoCopy[locale].own); expect(html).toContain(`href="/${locale}/help"`); expect(html).not.toContain('id="__next_error__"');
    expect(await durableCounts()).toEqual(before);
  }, 75_000);
  it('redirects the app example entry to the requested locale without creating work', async () => {
    const before = await durableCounts();
    const response = await fetch(`${origin}/app/demo`, { headers: { 'Accept-Language': 'kk' }, redirect: 'manual', signal: AbortSignal.timeout(25_000) });
    expect(response.status).toBe(307); expect(response.headers.get('location')).toBe('/kk/demo'); await response.body?.cancel();
    expect(await durableCounts()).toEqual(before);
  });
  it.each(['ru', 'kk', 'en'] as const)('downloads the actual %s sample as a valid DOCX without private export rows or provider work', async (locale) => {
    const before = await durableCounts(), document = createDemoSeed(locale).snapshots[1]!;
    if (document.content.kind !== 'document') throw new Error('fixture');
    const phrase = document.content.document.content!.find((node) => node.attrs?.id === 'personal-phrase')!.content![0]!.text!;
    const response = await fetch(`${origin}/api/demo/export`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ locale, content: document.content, title: document.artifact.title }), signal: AbortSignal.timeout(35_000) });
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('wordprocessingml'); expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('content-disposition')).toContain('tirlik-workshop-offer.docx');
    const zip = await JSZip.loadAsync(await response.arrayBuffer()), xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain(phrase); expect(xml).toContain('000'); expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(await durableCounts()).toEqual(before);
  }, 45_000);
  it('denies a foreign-origin sample export before creating any work', async () => {
    const before = await durableCounts(), document = createDemoSeed('en').snapshots[1]!;
    const response = await fetch(`${origin}/api/demo/export`, { method: 'POST', headers: { origin: 'https://foreign.invalid', 'content-type': 'application/json' }, body: JSON.stringify({ locale: 'en', content: document.content, title: document.artifact.title }), signal: AbortSignal.timeout(25_000) });
    expect(response.status).toBe(403); expect((await response.json()).code).toBe('FORBIDDEN'); expect(await durableCounts()).toEqual(before);
  });
});
