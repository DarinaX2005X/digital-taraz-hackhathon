import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import {
  DemoCapabilityTokenSchema,
  DemoExecutionCopySchema,
  DemoExecutionCreatedSchema,
  DemoExecutionScopeSchema,
  type DemoExecutionCopy,
  type DemoExecutionScope,
} from '@/contracts/demo-execution';
import { IdSchema, LocaleSchema } from '@/contracts/primitives';
import { CreateRunSchema, ResumeRunSchema, RunEventsPageSchema, RunSchema, type Run } from '@/contracts/runs';
import { ArtifactAccessRequestSchema, ArtifactCommandRequestSchema, ArtifactHistoryActionSchema, BranchArtifactSchema } from '@/features/artifacts/contracts';
import { createArtifactTargetResolver } from '@/features/artifacts/domain/targets';
import { createWorkspaceEventFeed, WorkspaceEventInputSchema } from '@/features/artifacts/server/event-feed';
import { createArtifactService } from '@/features/artifacts/server/service';
import type { ArtifactContent, DocumentNode } from '@/features/artifacts/domain/content-models';
import { CreateExportSchema } from '@/features/exports/contracts';
import type { ExportService } from '@/features/exports/server/service';
import { identityTransaction, withWorkspaceAccessInTransaction, type IdentityPrincipal, type SessionPrincipal } from '@/features/identity/server/access';
import { hasScope } from '@/features/identity/domain/policy';
import {
  CreateAvailabilityVersionSchema,
  CreateWorkResourceSchema,
  UpdateWorkResourceSchema,
  WorkResourceListInputSchema,
} from '@/features/operations/contracts';
import { ProposeWorkPlanRequestSchema } from '@/features/operations/domain/propose-work-plan';
import { createOperationsService } from '@/features/operations/server/service';
import type { getRunRuntime } from '@/features/runs/server/runtime';
import { hash, requestKey, type JsonObject } from '@/features/runs/server/data';

const TTL_HOURS = 24;
const fullScopes = ['read', 'edit', 'approve', 'export', 'manage-members', 'read-confidential'];
const StartRunInputSchema = z.strictObject({
  goal: z.string().trim().min(1).max(12_000),
  inputRefs: CreateRunSchema.shape.inputRefs.min(1),
  expectedRevision: z.number().int().nonnegative(),
});
const CopyInputSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  artifactIds: z.array(IdSchema).min(1).max(40).refine((value) => new Set(value).size === value.length),
  destinationWorkspaceId: IdSchema,
});

type Runtime = Pick<ReturnType<typeof getRunRuntime>, 'service'>;
type ScopeRow = {
  id: string; token_hash: string; locale: 'ru' | 'kk' | 'en'; actor_id: string; workspace_id: string; project_id: string;
  revision: number; input_refs: DemoExecutionScope['inputRefs']; expires_at: Date;
};

export class DemoExecutionError extends Error {
  constructor(readonly code: 'DEMO_NOT_FOUND' | 'DEMO_EXPIRED' | 'DEMO_FORBIDDEN' | 'DEMO_CONFLICT' | 'DEMO_LIMIT') { super(code); }
}

export interface DemoExecutionScopeDependencies {
  pool: Pool;
  secret: string;
  runtime: Runtime;
  wake: () => Promise<unknown>;
  now?: () => Date;
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const date = (value: Date) => value.toISOString().slice(0, 10);
function addDays(value: Date, days: number) { const next = new Date(value); next.setUTCDate(next.getUTCDate() + days); return next; }
function nextMonday(now: Date) { const offset = (8 - (now.getUTCDay() || 7)) % 7 || 7; return addDays(new Date(`${date(now)}T00:00:00.000Z`), offset); }
function capabilityToken(secret: string, startKey: string) { return createHmac('sha256', secret).update(`tirlik-demo-v1\0${startKey}`).digest('base64url'); }
function demoPrincipal(scope: ScopeRow): IdentityPrincipal { return { kind: 'job', userId: scope.actor_id, authzVersion: 1 }; }

function paragraph(id: string, text: string): DocumentNode { return { type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] }; }
function seedContent(locale: 'ru' | 'kk' | 'en', ids: { cutter: string; printer: string; cutterAvailability: string; printerAvailability: string }, now: Date) {
  const monday = nextMonday(now), friday = addDays(monday, 4), mondayDate = date(monday), fridayDate = date(friday);
  const facts = {
    ru: ['Синтетический пример. Срочный заказ мастерской вывесок «Арман Принт»: комплект для аптеки «Сары-Арқа №12» — фасадная вывеска, 18 м² оконной плёнки, 14 навигационных табличек и монтаж.', 'Согласованная база цены: полный комплект — 1 450 000 KZT; первая очередь — 980 000 KZT. Лимит клиента — 1 480 000 KZT.', 'Прямые затраты полного комплекта: печать 510 000 KZT, материалы 230 000 KZT, монтаж 180 000 KZT. Первая очередь: печать 340 000 KZT, материалы 160 000 KZT, монтаж 120 000 KZT.', `Монтаж нужен до 18:00 ${fridayDate}. Работы можно начинать ${mondayDate}. Полный комплект требует 960 минут, первая очередь — 540 минут.`, 'Изменение от поставщика: белая плёнка поступит только в четверг в 14:00. На складе 11 м²; полный комплект требует 18 м², первая очередь — 9 м².', 'Заказы «Qadam Market — фасадные панели» и «Orda Logistics — оклейка фургонов» уже подтверждены и занимают большую часть недели. Нельзя обещать срок без проверки загрузки.', 'Подготовьте два честных варианта: полный комплект и первую очередь. Ничего не отправляйте клиенту.'],
    kk: ['Синтетикалық мысал. «Арман Принт» маңдайша шеберханасының шұғыл тапсырысы: «Сары-Арқа №12» дәріханасына қасбет маңдайшасы, 18 м² терезе үлдірін, 14 навигациялық тақтайша және монтаж дайындау.', 'Келісілген баға негізі: толық жинақ — 1 450 000 KZT; бірінші кезек — 980 000 KZT. Клиент лимиті — 1 480 000 KZT.', 'Толық жинақтың тікелей шығындары: баспа 510 000 KZT, материалдар 230 000 KZT, монтаж 180 000 KZT. Бірінші кезек: баспа 340 000 KZT, материалдар 160 000 KZT, монтаж 120 000 KZT.', `Монтаж ${fridayDate} күні сағат 18:00-ге дейін қажет. Жұмысты ${mondayDate} бастауға болады. Толық жинаққа 960 минут, бірінші кезекке 540 минут қажет.`, 'Жеткізушіден өзгеріс: ақ үлдір бейсенбі күні сағат 14:00-де ғана келеді. Қоймада 11 м² бар; толық жинаққа 18 м², бірінші кезекке 9 м² қажет.', '«Qadam Market — қасбет панельдері» және «Orda Logistics — фургондарды қаптау» тапсырыстары расталған және аптаның көп бөлігін алып тұр. Жүктемені тексермей мерзімге уәде беруге болмайды.', 'Екі адал нұсқа дайындаңыз: толық жинақ және бірінші кезек. Клиентке ештеңе жібермеңіз.'],
    en: ['Synthetic example. Urgent order for the Arman Print signage workshop: a Sary-Arqa Pharmacy #12 package with a fascia sign, 18 m² of window vinyl, 14 wayfinding panels and installation.', 'Approved quoting basis: full package KZT 1,450,000; first release KZT 980,000. Customer ceiling: KZT 1,480,000.', 'Full-package direct costs: printing KZT 510,000, materials KZT 230,000, installation KZT 180,000. First release: printing KZT 340,000, materials KZT 160,000, installation KZT 120,000.', `Installation is due by 18:00 on ${fridayDate}. Work may start ${mondayDate}. The full package needs 960 minutes; the first release needs 540 minutes.`, 'Supplier change: white vinyl will now arrive only at 14:00 on Thursday. Stock on hand is 11 m²; the full package needs 18 m² and the first release needs 9 m².', 'The confirmed Qadam Market fascia-panel job and Orda Logistics van-wrap run already occupy most of the week. Do not promise the date without checking capacity.', 'Prepare two honest options: the full package and a first release. Send nothing to the customer.'],
  }[locale];
  const document: ArtifactContent = { kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: 'demo-brief' }, content: facts.map((text, index) => paragraph(`fact-${index + 1}`, text)) } };
  const instant = (day: number, hour: number) => `${date(addDays(monday, day))}T${String(hour).padStart(2, '0')}:00:00.000Z`;
  const plan: ArtifactContent = { kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries: [
    { id: 'qadam-market', title: 'Qadam Market — fascia panels', status: 'in-progress', startAt: instant(0, 9), endAt: instant(1, 17), resourceIds: [ids.cutter, ids.printer], assignments: [{ resourceId: ids.cutter, resourceRevision: 1, availabilityVersionId: ids.cutterAvailability, effort: { decimal: '720', unit: 'person-minutes' } }, { resourceId: ids.printer, resourceRevision: 1, availabilityVersionId: ids.printerAvailability, effort: { decimal: '480', unit: 'person-minutes' } }], dependencies: [], checklist: [], availabilityVersionIds: [ids.cutterAvailability, ids.printerAvailability], durationMinutes: 1_920, effort: { decimal: '1200', unit: 'person-minutes' }, notes: 'Confirmed work; dates are locked.' },
    { id: 'orda-logistics', title: 'Orda Logistics — van-wrap run', status: 'todo', startAt: instant(2, 9), endAt: instant(3, 15), resourceIds: [ids.printer], assignments: [{ resourceId: ids.printer, resourceRevision: 1, availabilityVersionId: ids.printerAvailability, effort: { decimal: '840', unit: 'person-minutes' } }], dependencies: [], checklist: [], availabilityVersionIds: [ids.printerAvailability], durationMinutes: 1_800, effort: { decimal: '840', unit: 'person-minutes' }, notes: 'Confirmed work; dates are locked.' },
    { id: 'sary-arqa-pharmacy', title: 'Sary-Arqa Pharmacy #12 — urgent signage package', status: 'todo', resourceIds: [], assignments: [], dependencies: [], checklist: [{ id: 'proof', text: 'Approve print proof', done: false }, { id: 'vinyl', text: 'Confirm white-vinyl allocation', done: false }, { id: 'install', text: 'Install fascia and wayfinding', done: false }], availabilityVersionIds: [], durationMinutes: 960, effort: { decimal: '960', unit: 'person-minutes' }, notes: `Must finish by 18:00 on ${fridayDate}; compare the full package with a viable first release.` },
  ] };
  return { document, plan, effectiveFrom: mondayDate, effectiveTo: fridayDate };
}

async function insertResource(tx: PoolClient, scope: { actorId: string; workspaceId: string }, input: { id: string; availabilityId: string; name: string; kind: 'person' | 'equipment'; effectiveFrom: string; effectiveTo: string }) {
  await tx.query(`INSERT INTO work_resources(id,workspace_id,display_name,kind,timezone,notes,created_by,current_availability_version_id)
    VALUES($1,$2,$3,$4,'Asia/Qyzylorda','Synthetic demo capacity',$5,NULL)`, [input.id, scope.workspaceId, input.name, input.kind, scope.actorId]);
  await tx.query(`INSERT INTO availability_versions(id,workspace_id,resource_id,revision,timezone,effective_from,effective_to,source_refs,verified_at,note,created_by)
    VALUES($1,$2,$3,1,'Asia/Qyzylorda',$4,$5,'[]',now(),'Synthetic demo availability',$6)`, [input.availabilityId, scope.workspaceId, input.id, input.effectiveFrom, input.effectiveTo, scope.actorId]);
  for (let weekday = 1; weekday <= 5; weekday++) await tx.query('INSERT INTO availability_week_intervals(availability_version_id,weekday,ordinal,start_minute,end_minute) VALUES($1,$2,0,540,1020)', [input.availabilityId, weekday]);
  await tx.query('UPDATE work_resources SET current_availability_version_id=$3 WHERE workspace_id=$1 AND id=$2', [scope.workspaceId, input.id, input.availabilityId]);
  await tx.query(`INSERT INTO work_resource_versions(id,workspace_id,resource_id,revision,display_name,kind,status,current_availability_version_id,membership_id,timezone,access_class,notes,created_by)
    VALUES($1,$2,$3,1,$4,$5,'active',$6,NULL,'Asia/Qyzylorda','internal','Synthetic demo capacity',$7)`, [randomUUID(), scope.workspaceId, input.id, input.name, input.kind, input.availabilityId, scope.actorId]);
}

export function createDemoExecutionScopeService(dependencies: DemoExecutionScopeDependencies) {
  if (dependencies.secret.length < 32) throw new Error('DEMO_CAPABILITY_SECRET_REQUIRED');
  const now = dependencies.now ?? (() => new Date()), artifacts = createArtifactService(dependencies.pool), artifactEvents = createWorkspaceEventFeed(dependencies.pool), operations = createOperationsService(dependencies.pool);
  let exportsPromise: Promise<ExportService> | undefined;

  function exportService() {
    return exportsPromise ??= Promise.all([
      import('@/features/exports/server/service'), import('@/features/exports/server/registry'), import('@/features/exports/server/documents'),
      import('@/features/exports/server/sheets'), import('@/features/exports/server/designs'), import('@/features/operations/server/exports'),
      import('@/features/operations/server/service'), import('@/features/operations/domain/model'),
    ]).then(([service, registry, documents, sheets, designs, operations, operationService, operationModel]) => service.createExportService({
      pool: dependencies.pool,
      registry: new registry.ExportRegistry([documents.documentExportAdapter, sheets.sheetExportAdapter, designs.designExportAdapter, operations.operationsExportAdapter]),
      resolvePlanResources: (tx, access, content) => operationService.resolvePlanExportResources(tx, access, operationModel.requirePlan(content)),
      authorizePlanResources: operationService.authorizePlanExportResources,
      assets: () => ({ image: async () => { throw new DemoExecutionError('DEMO_FORBIDDEN'); }, authorize: async () => { throw new DemoExecutionError('DEMO_FORBIDDEN'); } }),
    }));
  }

  async function lockScope(tx: PoolClient, sessionId: string, token: string, exclusive = false) {
    IdSchema.parse(sessionId); DemoCapabilityTokenSchema.parse(token);
    const row = (await tx.query<ScopeRow>(`SELECT * FROM demo_execution_scopes WHERE id=$1 AND token_hash=$2 FOR ${exclusive ? 'UPDATE' : 'SHARE'}`, [sessionId, digest(token)])).rows[0];
    if (!row) throw new DemoExecutionError('DEMO_NOT_FOUND');
    if (row.expires_at <= now()) throw new DemoExecutionError('DEMO_EXPIRED');
    return row;
  }

  async function assertOwnedArtifacts(tx: PoolClient, scope: ScopeRow, artifactIds: readonly string[]) {
    const ids = [...new Set(artifactIds.map((id) => IdSchema.parse(id)))].sort();
    if (!ids.length) throw new DemoExecutionError('DEMO_FORBIDDEN');
    const rows = (await tx.query<{ id: string }>('SELECT id FROM artifacts WHERE workspace_id=$1 AND project_id=$2 AND id=ANY($3::uuid[])', [scope.workspace_id, scope.project_id, ids])).rows;
    if (rows.length !== ids.length) throw new DemoExecutionError('DEMO_FORBIDDEN');
  }

  async function currentInputRefs(tx: Pick<PoolClient, 'query'>, scope: ScopeRow) {
    const artifactIds = scope.input_refs.filter((ref) => ref.kind === 'artifact').map((ref) => ref.id);
    if (!artifactIds.length) return scope.input_refs;
    const rows = (await tx.query<{ id: string; current_revision: number }>('SELECT id,current_revision FROM artifacts WHERE workspace_id=$1 AND project_id=$2 AND id=ANY($3::uuid[])', [scope.workspace_id, scope.project_id, artifactIds])).rows;
    const revisions = new Map(rows.map((row) => [row.id, row.current_revision]));
    if (revisions.size !== new Set(artifactIds).size) throw new DemoExecutionError('DEMO_FORBIDDEN');
    return scope.input_refs.map((ref) => ref.kind === 'artifact' ? { ...ref, revision: revisions.get(ref.id)! } : ref);
  }

  async function refreshInputRefs(tx: PoolClient, scope: ScopeRow, bumpRevision: boolean) {
    const inputRefs = await currentInputRefs(tx, scope);
    const changed = hash(inputRefs) !== hash(scope.input_refs);
    if (changed || bumpRevision) {
      const row = (await tx.query<{ revision: number }>('UPDATE demo_execution_scopes SET input_refs=$2,revision=revision+$3,updated_at=now() WHERE id=$1 RETURNING revision', [scope.id, JSON.stringify(inputRefs), bumpRevision ? 1 : 0])).rows[0]!;
      scope.input_refs = inputRefs; scope.revision = row.revision;
    }
    return inputRefs;
  }

  async function scopeSnapshot(scope: ScopeRow, tx: Pick<PoolClient, 'query'> = dependencies.pool): Promise<DemoExecutionScope> {
    const inputRefs = await currentInputRefs(tx, scope);
    const rows = (await dependencies.pool.query<{ id: string }>('SELECT id FROM agent_runs WHERE workspace_id=$1 AND project_id=$2 AND created_by=$3 ORDER BY created_at,id LIMIT 21', [scope.workspace_id, scope.project_id, scope.actor_id])).rows;
    if (rows.length > 20) throw new DemoExecutionError('DEMO_LIMIT');
    const runs: Run[] = [];
    for (const row of rows) runs.push(RunSchema.parse(await dependencies.runtime.service.read(demoPrincipal(scope), row.id)));
    const results = [...new Map(runs.flatMap((run) => run.progress.results).map((item) => {
      const ref = { kind: item.kind, id: item.id, ...(item.revision === undefined ? {} : { revision: item.revision }) };
      return [`${item.kind}:${item.id}:${item.revision ?? ''}`, ref] as const;
    })).values()].slice(0, 40);
    return DemoExecutionScopeSchema.parse({ sessionId: scope.id, expiresAt: scope.expires_at.toISOString(), revision: scope.revision, locale: scope.locale, actorId: scope.actor_id, workspaceId: scope.workspace_id, projectId: scope.project_id, inputRefs, results, runIds: runs.map((run) => run.id) });
  }

  async function create(rawLocale: unknown, rawStartKey: string) {
    const locale = LocaleSchema.parse(rawLocale), startKeyHash = requestKey(rawStartKey), token = capabilityToken(dependencies.secret, rawStartKey);
    return identityTransaction(dependencies.pool, async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`demo-start:${startKeyHash}`]);
      const prior = (await tx.query<ScopeRow>('SELECT * FROM demo_execution_scopes WHERE start_key_hash=$1', [startKeyHash])).rows[0];
      if (prior) {
        if (prior.locale !== locale) throw new DemoExecutionError('DEMO_CONFLICT');
        if (prior.expires_at <= now()) throw new DemoExecutionError('DEMO_EXPIRED');
        return DemoExecutionCreatedSchema.parse({ scope: await scopeSnapshot(prior, tx), capabilityToken: token });
      }
      const sessionId = randomUUID(), actorId = randomUUID(), workspaceId = randomUUID(), projectId = randomUUID(), membershipId = randomUUID();
      const cutter = randomUUID(), printer = randomUUID(), cutterAvailability = randomUUID(), printerAvailability = randomUUID();
      const seeded = seedContent(locale, { cutter, printer, cutterAvailability, printerAvailability }, now());
      await tx.query('INSERT INTO identity_users(id,name,email,email_verified,locale) VALUES($1,$2,$3,false,$4)', [actorId, 'Tirlik Demo', `demo+${sessionId}@tirlik.invalid`, locale]);
      await tx.query('INSERT INTO identity_workspaces(id,name,created_by) VALUES($1,$2,$3)', [workspaceId, 'Tirlik Demo', actorId]);
      await tx.query('INSERT INTO identity_memberships(id,workspace_id,user_id,role,scopes) VALUES($1,$2,$3,\'owner\',$4)', [membershipId, workspaceId, actorId, fullScopes]);
      await tx.query('INSERT INTO projects(id,workspace_id,title,goal,created_by,creation_key,creation_body_hash) VALUES($1,$2,$3,$4,$5,$6,$7)', [projectId, workspaceId, 'Sary-Arqa Pharmacy #12 — urgent signage', 'Check the changed material constraint, deadline, capacity and economics before committing.', actorId, randomUUID(), digest(sessionId)]);
      await insertResource(tx, { actorId, workspaceId }, { id: cutter, availabilityId: cutterAvailability, name: 'Prepress and installation team', kind: 'person', effectiveFrom: seeded.effectiveFrom, effectiveTo: seeded.effectiveTo });
      await insertResource(tx, { actorId, workspaceId }, { id: printer, availabilityId: printerAvailability, name: 'Wide-format printer', kind: 'equipment', effectiveFrom: seeded.effectiveFrom, effectiveTo: seeded.effectiveTo });
      const principal: IdentityPrincipal = { kind: 'job', userId: actorId, authzVersion: 1 };
      const brief = await artifacts.createInTransaction(tx, principal, randomUUID(), { workspaceId, projectId, expectedAuthzVersion: 1, title: 'Sary-Arqa #12 order, costs and supplier change', content: seeded.document, sourceRefs: [] });
      const plan = await artifacts.createInTransaction(tx, principal, randomUUID(), { workspaceId, projectId, expectedAuthzVersion: 1, title: 'Arman Print weekly workload and urgent order', content: seeded.plan, sourceRefs: [] });
      const planTargets = createArtifactTargetResolver(seeded.plan);
      const confirmedEntryIds = ['qadam-market', 'orda-logistics'] as const;
      const lockReceipt = await artifacts.applyInTransaction(tx, principal, {
        workspaceId,
        expectedAuthzVersion: 1,
        group: {
          commandGroupId: randomUUID(),
          expectedArtifactRevisions: { [plan.artifact.id]: plan.artifact.currentRevision },
          expectedSourceRevisions: {},
          commands: [{
            commandId: randomUUID(), artifactId: plan.artifact.id, baseRevision: plan.artifact.currentRevision, kind: 'plan',
            expectedSourceRevisions: {}, reason: 'Preserve confirmed demo work',
            operations: confirmedEntryIds.map((targetId) => ({ targetId, op: 'lock' as const, beforeHash: planTargets(targetId)!.hash, value: { locked: true, reason: 'Confirmed work; dates are fixed.' } })),
          }],
        },
      });
      const inputRefs = [{ kind: 'artifact' as const, id: brief.artifact.id, revision: brief.artifact.currentRevision }, { kind: 'artifact' as const, id: plan.artifact.id, revision: lockReceipt.committedRevisionVector[plan.artifact.id]! }];
      const expiresAt = new Date(now().getTime() + TTL_HOURS * 3_600_000);
      await tx.query(`INSERT INTO demo_execution_scopes(id,token_hash,start_key_hash,locale,actor_id,workspace_id,project_id,input_refs,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [sessionId, digest(token), startKeyHash, locale, actorId, workspaceId, projectId, JSON.stringify(inputRefs), expiresAt]);
      const scope: ScopeRow = { id: sessionId, token_hash: digest(token), locale, actor_id: actorId, workspace_id: workspaceId, project_id: projectId, revision: 0, input_refs: inputRefs, expires_at: expiresAt };
      return DemoExecutionCreatedSchema.parse({ scope: await scopeSnapshot(scope, tx), capabilityToken: token });
    });
  }

  async function read(sessionId: string, token: string) {
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    return scopeSnapshot(scope);
  }

  async function artifactSnapshot(sessionId: string, token: string, artifactId: string) {
    return identityTransaction(dependencies.pool, async (tx) => {
      const scope = await lockScope(tx, sessionId, token);
      await assertOwnedArtifacts(tx, scope, [artifactId]);
      return artifacts.readInTransaction(tx, demoPrincipal(scope), { workspaceId: scope.workspace_id, artifactId, expectedProjectId: scope.project_id });
    });
  }

  async function artifactAccess(sessionId: string, token: string, raw: unknown) {
    const input = ArtifactAccessRequestSchema.parse(raw);
    const scope = await identityTransaction(dependencies.pool, async (tx) => {
      const value = await lockScope(tx, sessionId, token);
      if (input.workspaceId !== value.workspace_id) throw new DemoExecutionError('DEMO_FORBIDDEN');
      await assertOwnedArtifacts(tx, value, input.artifactIds);
      return value;
    });
    return artifacts.access(demoPrincipal(scope), input);
  }

  async function artifactHistory(sessionId: string, token: string, artifactId: string) {
    const scope = await identityTransaction(dependencies.pool, async (tx) => {
      const value = await lockScope(tx, sessionId, token); await assertOwnedArtifacts(tx, value, [artifactId]); return value;
    });
    return artifacts.history(demoPrincipal(scope), { workspaceId: scope.workspace_id, artifactId, expectedProjectId: scope.project_id });
  }

  async function artifactVersions(sessionId: string, token: string, artifactId: string, beforeRevision?: number, limit?: number) {
    const scope = await identityTransaction(dependencies.pool, async (tx) => {
      const value = await lockScope(tx, sessionId, token); await assertOwnedArtifacts(tx, value, [artifactId]); return value;
    });
    return artifacts.versions(demoPrincipal(scope), { workspaceId: scope.workspace_id, artifactId, expectedProjectId: scope.project_id, beforeRevision, limit });
  }

  async function artifactVersion(sessionId: string, token: string, artifactId: string, revision: number) {
    const scope = await identityTransaction(dependencies.pool, async (tx) => {
      const value = await lockScope(tx, sessionId, token); await assertOwnedArtifacts(tx, value, [artifactId]); return value;
    });
    return artifacts.version(demoPrincipal(scope), { workspaceId: scope.workspace_id, artifactId, expectedProjectId: scope.project_id, revision });
  }

  async function workspaceEvents(sessionId: string, token: string, raw: unknown) {
    const input = WorkspaceEventInputSchema.parse(raw);
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    if (input.workspaceId !== scope.workspace_id) throw new DemoExecutionError('DEMO_FORBIDDEN');
    return artifactEvents(demoPrincipal(scope), input);
  }

  async function listResources(sessionId: string, token: string, raw: unknown) {
    const input = WorkResourceListInputSchema.parse(raw);
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    if (input.workspaceId !== scope.workspace_id) throw new DemoExecutionError('DEMO_FORBIDDEN');
    return operations.list(demoPrincipal(scope), input);
  }

  async function readResource(sessionId: string, token: string, workspaceId: string, resourceId: string) {
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    if (IdSchema.parse(workspaceId) !== scope.workspace_id) throw new DemoExecutionError('DEMO_FORBIDDEN');
    return operations.read(demoPrincipal(scope), scope.workspace_id, IdSchema.parse(resourceId));
  }

  async function createResource(sessionId: string, token: string, raw: unknown, operationId: string) {
    const input = CreateWorkResourceSchema.parse(raw);
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    if (input.workspaceId !== scope.workspace_id || input.expectedAuthzVersion !== 1) throw new DemoExecutionError('DEMO_FORBIDDEN');
    return operations.create(demoPrincipal(scope), IdSchema.parse(operationId), input);
  }

  async function updateResource(sessionId: string, token: string, resourceId: string, raw: unknown, operationId: string) {
    const input = UpdateWorkResourceSchema.parse(raw);
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    if (input.workspaceId !== scope.workspace_id || input.expectedAuthzVersion !== 1) throw new DemoExecutionError('DEMO_FORBIDDEN');
    return operations.update(demoPrincipal(scope), IdSchema.parse(operationId), IdSchema.parse(resourceId), input);
  }

  async function createResourceAvailability(sessionId: string, token: string, resourceId: string, raw: unknown, operationId: string) {
    const input = CreateAvailabilityVersionSchema.parse(raw);
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    if (input.workspaceId !== scope.workspace_id || input.expectedAuthzVersion !== 1) throw new DemoExecutionError('DEMO_FORBIDDEN');
    return operations.createAvailability(demoPrincipal(scope), IdSchema.parse(operationId), IdSchema.parse(resourceId), input);
  }

  async function resourceAvailabilityHistory(sessionId: string, token: string, workspaceId: string, resourceId: string, beforeRevision?: number) {
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    if (IdSchema.parse(workspaceId) !== scope.workspace_id) throw new DemoExecutionError('DEMO_FORBIDDEN');
    return operations.availabilityHistory(demoPrincipal(scope), scope.workspace_id, IdSchema.parse(resourceId), beforeRevision);
  }

  async function proposePlan(sessionId: string, token: string, raw: unknown) {
    const input = ProposeWorkPlanRequestSchema.parse(raw);
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    if (input.workspaceId !== scope.workspace_id || input.expectedAuthzVersion !== 1) throw new DemoExecutionError('DEMO_FORBIDDEN');
    return operations.propose(demoPrincipal(scope), input);
  }

  async function applyArtifactCommand(sessionId: string, token: string, raw: unknown) {
    const input = ArtifactCommandRequestSchema.parse(raw);
    return identityTransaction(dependencies.pool, async (tx) => {
      const scope = await lockScope(tx, sessionId, token, true);
      if (input.workspaceId !== scope.workspace_id || input.expectedAuthzVersion !== 1) throw new DemoExecutionError('DEMO_FORBIDDEN');
      await assertOwnedArtifacts(tx, scope, input.group.commands.map((command) => command.artifactId));
      const receipt = await artifacts.applyInTransaction(tx, demoPrincipal(scope), input);
      await refreshInputRefs(tx, scope, true);
      return receipt;
    });
  }

  async function artifactHistoryAction(sessionId: string, token: string, action: 'undo' | 'redo', raw: unknown) {
    const input = ArtifactHistoryActionSchema.parse(raw);
    const scope = await identityTransaction(dependencies.pool, async (tx) => {
      const value = await lockScope(tx, sessionId, token);
      if (input.workspaceId !== value.workspace_id || input.expectedAuthzVersion !== 1) throw new DemoExecutionError('DEMO_FORBIDDEN');
      await assertOwnedArtifacts(tx, value, Object.keys(input.expectedArtifactRevisions));
      return value;
    });
    const receipt = await artifacts[action](demoPrincipal(scope), input);
    await identityTransaction(dependencies.pool, async (tx) => {
      const locked = await lockScope(tx, sessionId, token, true); await refreshInputRefs(tx, locked, true);
    });
    return receipt;
  }

  async function branchArtifact(sessionId: string, token: string, artifactId: string, raw: unknown, operationId: string) {
    const input = BranchArtifactSchema.parse(raw);
    const scope = await identityTransaction(dependencies.pool, async (tx) => {
      const value = await lockScope(tx, sessionId, token);
      if (input.workspaceId !== value.workspace_id || input.projectId !== value.project_id || input.expectedAuthzVersion !== 1) throw new DemoExecutionError('DEMO_FORBIDDEN');
      await assertOwnedArtifacts(tx, value, [artifactId]);
      return value;
    });
    const result = await artifacts.branch(demoPrincipal(scope), IdSchema.parse(operationId), IdSchema.parse(artifactId), input);
    await identityTransaction(dependencies.pool, async (tx) => {
      const locked = await lockScope(tx, sessionId, token, true); await refreshInputRefs(tx, locked, true);
    });
    return result;
  }

  async function createExport(sessionId: string, token: string, raw: unknown, operationId: string) {
    const input = CreateExportSchema.parse(raw);
    const scope = await identityTransaction(dependencies.pool, async (tx) => {
      const value = await lockScope(tx, sessionId, token);
      if (input.workspaceId !== value.workspace_id || input.expectedAuthzVersion !== 1) throw new DemoExecutionError('DEMO_FORBIDDEN');
      await assertOwnedArtifacts(tx, value, input.items.map((item) => item.artifactId));
      return value;
    });
    return (await exportService()).create(demoPrincipal(scope), IdSchema.parse(operationId), input);
  }

  async function readExport(sessionId: string, token: string, exportId: string) {
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    return (await exportService()).read(demoPrincipal(scope), scope.workspace_id, IdSchema.parse(exportId));
  }

  async function renderExport(sessionId: string, token: string, exportId: string, signal?: AbortSignal) {
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    return (await exportService()).render(demoPrincipal(scope), scope.workspace_id, IdSchema.parse(exportId), 1, signal);
  }

  async function downloadExport(sessionId: string, token: string, exportId: string, fileId: string) {
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    return (await exportService()).download(demoPrincipal(scope), scope.workspace_id, IdSchema.parse(exportId), IdSchema.parse(fileId));
  }

  async function downloadExportBundle(sessionId: string, token: string, exportId: string) {
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    return (await exportService()).downloadBundle(demoPrincipal(scope), scope.workspace_id, IdSchema.parse(exportId));
  }

  async function operationReceipt<T>(tx: PoolClient, scope: ScopeRow, kind: 'run' | 'copy' | 'resume', key: string, body: unknown, parse: (value: unknown) => T) {
    const keyHash = requestKey(key), bodyHash = hash(body);
    const prior = (await tx.query<{ body_hash: string; result: unknown }>('SELECT body_hash,result FROM demo_execution_operations WHERE session_id=$1 AND kind=$2 AND key_hash=$3', [scope.id, kind, keyHash])).rows[0];
    if (!prior) return { keyHash, bodyHash, result: null as T | null };
    if (prior.body_hash !== bodyHash) throw new DemoExecutionError('DEMO_CONFLICT');
    return { keyHash, bodyHash, result: parse(prior.result) };
  }

  async function createRun(sessionId: string, token: string, raw: unknown, key: string) {
    const input = StartRunInputSchema.parse(raw);
    const result = await identityTransaction(dependencies.pool, async (tx) => {
      const scope = await lockScope(tx, sessionId, token, true), receipt = await operationReceipt(tx, scope, 'run', key, input, (value) => RunSchema.pick({ id: true, cursor: true }).parse(value));
      if (receipt.result) return receipt.result;
      await refreshInputRefs(tx, scope, false);
      if (scope.revision !== input.expectedRevision) throw new DemoExecutionError('DEMO_CONFLICT');
      if (hash(input.inputRefs) !== hash(scope.input_refs)) throw new DemoExecutionError('DEMO_FORBIDDEN');
      const count = (await tx.query<{ count: number }>('SELECT count(*)::int AS count FROM agent_runs WHERE workspace_id=$1 AND created_by=$2', [scope.workspace_id, scope.actor_id])).rows[0]!.count;
      if (count >= 20) throw new DemoExecutionError('DEMO_LIMIT');
      const run = await dependencies.runtime.service.create(demoPrincipal(scope), {
        workspaceId: scope.workspace_id, projectId: scope.project_id, capabilityId: 'business.goal', capabilityVersion: 1,
        goal: input.goal, locale: scope.locale, inputRefs: scope.input_refs,
      }, key, { trusted: true, transaction: tx, privateInput: { executionAuthority: { kind: 'demo', sessionId: scope.id, userId: scope.actor_id, expiresAt: scope.expires_at.toISOString() } } as JsonObject });
      const output = { id: run.id, cursor: run.cursor };
      await tx.query('INSERT INTO demo_execution_operations(session_id,kind,key_hash,body_hash,result) VALUES($1,\'run\',$2,$3,$4)', [scope.id, receipt.keyHash, receipt.bodyHash, output]);
      await tx.query('UPDATE demo_execution_scopes SET revision=revision+1,updated_at=now() WHERE id=$1', [scope.id]);
      return output;
    });
    await dependencies.wake().catch(() => undefined);
    return result;
  }

  async function ownedRun(sessionId: string, token: string, runId: string) {
    const scope = await identityTransaction(dependencies.pool, (tx) => lockScope(tx, sessionId, token));
    IdSchema.parse(runId);
    const row = (await dependencies.pool.query('SELECT 1 FROM agent_runs WHERE id=$1 AND workspace_id=$2 AND project_id=$3 AND created_by=$4', [runId, scope.workspace_id, scope.project_id, scope.actor_id])).rows[0];
    if (!row) throw new DemoExecutionError('DEMO_NOT_FOUND');
    return scope;
  }

  async function readRun(sessionId: string, token: string, runId: string) {
    const scope = await ownedRun(sessionId, token, runId);
    return RunSchema.parse(await dependencies.runtime.service.read(demoPrincipal(scope), runId));
  }

  async function resumeRun(sessionId: string, token: string, runId: string, raw: unknown, key: string) {
    const input = ResumeRunSchema.parse(raw), scope = await ownedRun(sessionId, token, runId);
    const run = RunSchema.parse(await dependencies.runtime.service.resume(demoPrincipal(scope), runId, input, key));
    await dependencies.wake().catch(() => undefined);
    return run;
  }

  async function events(sessionId: string, token: string, runId: string, after = 0) {
    const scope = await ownedRun(sessionId, token, runId);
    return RunEventsPageSchema.parse(await dependencies.runtime.service.events(demoPrincipal(scope), runId, after));
  }

  async function copy(sessionId: string, token: string, destinationPrincipal: SessionPrincipal, raw: unknown, key: string): Promise<DemoExecutionCopy> {
    const input = CopyInputSchema.parse(raw);
    return identityTransaction(dependencies.pool, async (tx) => {
      const scope = await lockScope(tx, sessionId, token, true), receipt = await operationReceipt(tx, scope, 'copy', key, input, (value) => DemoExecutionCopySchema.parse(value));
      if (receipt.result) return receipt.result;
      if (scope.revision !== input.expectedRevision) throw new DemoExecutionError('DEMO_CONFLICT');
      const allowed = new Set((await scopeSnapshot(scope)).results.filter((item) => item.kind === 'artifact').map((item) => item.id));
      if (input.artifactIds.some((id) => !allowed.has(id))) throw new DemoExecutionError('DEMO_FORBIDDEN');
      const output = await withWorkspaceAccessInTransaction(tx, destinationPrincipal, { workspaceId: input.destinationWorkspaceId, scope: 'edit' }, async (transaction, access) => {
        if (!hasScope(access.membership, 'edit')) throw new DemoExecutionError('DEMO_FORBIDDEN');
        const projectId = randomUUID();
        await transaction.query('INSERT INTO projects(id,workspace_id,title,goal,created_by,creation_key,creation_body_hash) VALUES($1,$2,$3,$4,$5,$6,$7)', [projectId, input.destinationWorkspaceId, 'Sary-Arqa #12 signage decision', 'Copied from the isolated Tirlik synthetic example after explicit confirmation.', access.userId, randomUUID(), digest(`${scope.id}:${key}`)]);
        const copied: { id: string; revision: number }[] = [];
        for (const [index, artifactId] of input.artifactIds.entries()) {
          const source = await artifacts.readInTransaction(transaction, demoPrincipal(scope), { workspaceId: scope.workspace_id, artifactId, expectedProjectId: scope.project_id });
          const saved = await artifacts.createInTransaction(transaction, destinationPrincipal, derivedId(key, index), { workspaceId: input.destinationWorkspaceId, projectId, expectedAuthzVersion: access.workspace.authz_version, title: source.artifact.title, content: source.content, sourceRefs: [], bindings: [] });
          copied.push({ id: saved.artifact.id, revision: saved.artifact.currentRevision });
        }
        return DemoExecutionCopySchema.parse({ projectId, artifacts: copied });
      });
      await tx.query('INSERT INTO demo_execution_operations(session_id,kind,key_hash,body_hash,result) VALUES($1,\'copy\',$2,$3,$4)', [scope.id, receipt.keyHash, receipt.bodyHash, output]);
      await tx.query('UPDATE demo_execution_scopes SET revision=revision+1,updated_at=now() WHERE id=$1', [scope.id]);
      return output;
    });
  }

  return {
    create, read,
    artifactAccess, artifactSnapshot, artifactHistory, artifactVersions, artifactVersion, workspaceEvents, applyArtifactCommand, artifactHistoryAction, branchArtifact,
    listResources, readResource, createResource, updateResource, createResourceAvailability, resourceAvailabilityHistory, proposePlan,
    createExport, readExport, renderExport, downloadExport, downloadExportBundle,
    createRun, readRun, resumeRun, events, copy,
  };
}

function derivedId(key: string, index: number) {
  const bytes = createHash('sha256').update(`tirlik-demo-copy\0${key}\0${index}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = bytes.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export type StartDemoExecutionRunInput = z.infer<typeof StartRunInputSchema>;
export type CopyDemoExecutionInput = z.infer<typeof CopyInputSchema>;
