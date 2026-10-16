import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatsForKind } from '../../src/features/exports/contracts';
import { SOURCE_MAX_BYTES, SourceFormatSchema } from '../../src/contracts/sources';
import { assertOwnedTemporaryRoot, canonicalJson, cleanCopyExclusionReason, cleanVerificationEnvironment, hashJson } from '../../scripts/verify-clean-start.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const read = (relative: string) => readFile(path.join(root, relative), 'utf8');

describe('public delivery documentation', () => {
  it('states the real identity, manual-without-AI boundary, formats and clean commands', async () => {
    const markdown = await read('README.md');
    expect(markdown).toContain('<h1 align="center">Tirlik</h1>');
    expect(markdown).toContain('Всё для вашего бизнеса');
    expect(markdown).toContain('Ручное создание, загрузка файлов, редакторы, версии и экспорт работают без ключа AI.');
    expect(markdown).toContain('node scripts/dev/start.mjs');
    expect(markdown).toContain('node scripts/dev/stop.mjs');
    expect(markdown).toContain('node scripts/verify-clean-start.mjs');
    expect(markdown).toContain('NODE_ENV=production');
    expect(markdown).toContain('docs/product/deployment-verification.md');
    expect(markdown).toContain('node scripts/ops/local-data.mjs backup');
    expect(markdown).toContain('node scripts/ops/local-data.mjs verify --from');
    expect(markdown).toContain('node scripts/ops/local-data.mjs restore --from');
    expect(markdown).toContain('docs/operations/local-backup.md');
    expect(markdown).toContain('node scripts/dev/stop.mjs --recover-lock');
    expect(markdown).toContain('.local-data/files');
    expect(markdown).toContain('.local-data/workflow');
    expect(markdown).toContain('BETTER_AUTH_URL');
    expect(markdown).toContain('SMTP_REQUIRE_TLS');
    expect(markdown).toContain('https://tirlik.vercel.app/ru/demo');
    expect(markdown).toContain('public/video/tirlik-product-film-ru.mp4');
    expect(markdown).toContain('delivery/presentation/tirlik-presentation.pdf');
    expect(markdown).toContain('delivery/presentation/tirlik-presentation.pptx');
    expect(markdown).toContain(`${SOURCE_MAX_BYTES / 1024 / 1024} МБ`);
    for (const format of SourceFormatSchema.options) {
      const displayed = format === 'text' ? 'TXT' : format === 'webp' ? 'WebP' : format.toUpperCase();
      expect(markdown, `README input ${format}`).toContain(displayed);
    }
    for (const formats of Object.values(formatsForKind)) {
      for (const format of formats) expect(markdown, `README export ${format}`).toContain(format === 'tirlik' ? '.tirlik' : format.toUpperCase());
    }
    expect(markdown).toContain('не объявлена лицензия');
    expect(markdown).not.toMatch(/лиценз(?:ия|ии) MIT/i);
    expect(markdown).not.toContain('.vibemachina/BRIEF');
    expect(markdown).not.toContain('agent chatter');
  });

  it('documents accepted production and local recovery safeguards', async () => {
    const [readme, selfHosting, backup] = await Promise.all([
      read('README.md'),
      read('docs/product/self-hosting.md'),
      read('docs/operations/local-backup.md'),
    ]);
    for (const text of [readme, selfHosting]) {
      expect(text).toContain('PRODUCTION_RUNTIME_ACTIVE');
      expect(text).toContain('node scripts/ops/local-data.mjs backup');
      expect(text).toContain('node scripts/ops/local-data.mjs verify --from');
      expect(text).toContain('node scripts/ops/local-data.mjs restore --from');
      expect(text).not.toContain('ещё интегрируются');
    }
    expect(backup).toContain('pg_restore --clean --if-exists --single-transaction');
    expect(backup).toContain('.local-data/backups/pre-restore-*');
    expect(backup).toContain('RESTORE_ROLLBACK_FAILED');
  });

  it('documents a two-phase API-only deployment persistence check', async () => {
    const guide = await read('docs/product/deployment-verification.md');
    expect(guide).toContain('verify-deployment.mjs prepare --origin');
    expect(guide).toContain('verify-deployment.mjs verify');
    expect(guide).toContain('verify-deployment.mjs cleanup');
    expect(guide).toContain('--expect-missing-model');
    expect(guide).toContain('6 350 000');
    expect(guide).toContain('.local-data/release/deployment-smoke.json');
  });

  it('keeps every relative Markdown link resolvable from the repository root', async () => {
    const markdown = await read('README.md');
    const targets = [...markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]!);
    expect(targets.length).toBeGreaterThan(5);
    for (const raw of targets) {
      if (/^(?:https?:|#)/.test(raw)) continue;
      const target = decodeURIComponent(raw.replace(/^<|>$/g, '').split('#', 1)[0]!);
      await expect(access(path.resolve(root, target)), target).resolves.toBeUndefined();
    }
  });

  it('describes an explicit local default and a fail-closed hosted storage contract', async () => {
    const [readme, selfHosting] = await Promise.all([read('README.md'), read('docs/product/self-hosting.md')]);
    for (const text of [readme, selfHosting]) {
      expect(text).toContain('TIRLIK_STORAGE_DRIVER');
      expect(text).toContain('TIRLIK_DATA_DIR');
      expect(text).toContain('R2_ACCOUNT_ID');
      expect(text).toContain('R2_BUCKET_NAME');
      expect(text).toContain('R2_ACCESS_KEY_ID');
      expect(text).toContain('R2_SECRET_ACCESS_KEY');
    }
    expect(readme).toContain('[tirlik.vercel.app](https://tirlik.vercel.app)');
  });
});

describe('clean-copy verifier safety boundary', () => {
  it('excludes private and generated roots while retaining product inputs', () => {
    for (const item of ['.codex/local.json', '.git/config', '.local-data/files/source', '.next/server/app.js', '.swc/cache', '.vercel/project.json', '.vibemachina/STATE.md', 'node_modules/next/package.json', '.env', '.env.local', 'trace.log', 'tsconfig.tsbuildinfo']) {
      expect(cleanCopyExclusionReason(item), item).toBeTruthy();
    }
    for (const item of ['.env.example', 'package-lock.json', 'compose.yaml', 'migrations/0001_identity.sql', 'src/app/layout.tsx', 'fixtures/business/assets/provenance.json']) {
      expect(cleanCopyExclusionReason(item), item).toBeNull();
    }
  });

  it('removes inherited application secrets and creates an isolated local environment', () => {
    const copyRoot = path.join(os.tmpdir(), 'tirlik-clean-start-test', 'project');
    const result = cleanVerificationEnvironment({ PATH: 'synthetic-path', OPENROUTER_API_KEY: 'private-provider', DATABASE_URL: 'postgres://private', RANDOM_TOKEN: 'private-token', SAFE_FLAG: 'yes' }, { copyRoot, ports: { app: 3101, database: 54331, smtp: 10261, mail: 8031 } });
    expect(result).toMatchObject({ PATH: 'synthetic-path', SAFE_FLAG: 'yes', OPENROUTER_API_KEY: '', DATABASE_URL: '', TIRLIK_STORAGE_DRIVER: 'local', TIRLIK_APP_PORT: '3101', TIRLIK_DB_PORT: '54331' });
    expect(Object.hasOwn(result, 'RANDOM_TOKEN')).toBe(false);
    expect(result.BETTER_AUTH_SECRET).not.toContain('private');
    expect(result.TIRLIK_DATA_DIR).toBe(path.join(copyRoot, '.local-data', 'files'));
  });

  it('uses the same stable JSON hash shape required by guarded artifact edits', () => {
    const value = { z: 1, a: [true, { b: 'текст', a: null }] };
    expect(canonicalJson(value)).toBe('{"a":[true,{"a":null,"b":"текст"}],"z":1}');
    expect(hashJson(value)).toBe(createHash('sha256').update(canonicalJson(value)).digest('hex'));
  });

  it('refuses cleanup outside an owned system-temp directory', () => {
    const owned = path.join(os.tmpdir(), 'tirlik-clean-start-123');
    expect(() => assertOwnedTemporaryRoot(owned, os.tmpdir())).not.toThrow();
    expect(() => assertOwnedTemporaryRoot(path.join(os.tmpdir(), 'other-project'), os.tmpdir())).toThrow('CLEAN_COPY_PATH_NOT_OWNED');
    expect(() => assertOwnedTemporaryRoot(path.join(os.tmpdir(), 'nested', 'tirlik-clean-start-123'), os.tmpdir())).toThrow('CLEAN_COPY_PATH_NOT_OWNED');
  });
});

