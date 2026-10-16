import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

describe('business continuity PostgreSQL constraints', () => {
  it('keeps context versions immutable and operation receipts idempotent', async () => {
    const fixture = await artifactFixture(pool);
    const contextId = randomUUID();
    await pool.query(
      "INSERT INTO business_contexts(id,workspace_id,project_id,scope,owner_id,title,current_revision) VALUES($1,$2,$3,'project',$4,$5,1)",
      [contextId, fixture.workspaceId, fixture.projectId, fixture.owner.userId, 'Клиенты и условия'],
    );
    await pool.query(
      "INSERT INTO business_context_versions(id,workspace_id,context_id,revision,scope,project_id,owner_id,title,items,brand_kit,reason,created_by) VALUES($1,$2,$3,1,'project',$4,$5,$6,'[]','{}',$7,$5)",
      [randomUUID(), fixture.workspaceId, contextId, fixture.projectId, fixture.owner.userId, 'Клиенты и условия', 'Создание контекста'],
    );
    await expect(pool.query(
      "INSERT INTO business_context_versions(id,workspace_id,context_id,revision,scope,project_id,owner_id,title,items,brand_kit,reason,created_by) VALUES($1,$2,$3,1,'project',$4,$5,$6,'[]','{}',$7,$5)",
      [randomUUID(), fixture.workspaceId, contextId, fixture.projectId, fixture.owner.userId, 'Дубликат', 'Повтор'],
    )).rejects.toThrow(/business_context_versions_revision_key/);
    await expect(pool.query(
      "INSERT INTO business_contexts(id,workspace_id,project_id,scope,owner_id,title,current_revision) VALUES($1,$2,$3,'workspace',$4,$5,1)",
      [randomUUID(), fixture.workspaceId, fixture.projectId, fixture.owner.userId, 'Неверная область'],
    )).rejects.toThrow(/business_contexts_project_scope_check/);

    const operationId = randomUUID();
    const operation = [fixture.workspaceId, fixture.owner.userId, operationId, 'context', 'a'.repeat(64), JSON.stringify({ contextId, revision: 1 })];
    await pool.query('INSERT INTO business_continuity_operations(workspace_id,actor_id,operation_id,kind,body_hash,result) VALUES($1,$2,$3,$4,$5,$6)', operation);
    await expect(pool.query('INSERT INTO business_continuity_operations(workspace_id,actor_id,operation_id,kind,body_hash,result) VALUES($1,$2,$3,$4,$5,$6)', operation)).rejects.toThrow(/business_continuity_operations_pkey/);
  });

  it('binds collaboration, recurring work, and observations to exact immutable versions', async () => {
    const fixture = await artifactFixture(pool);
    const artifact = await fixture.create();
    const commentId = randomUUID();
    await pool.query(
      "INSERT INTO artifact_version_comments(id,workspace_id,project_id,artifact_id,artifact_revision,target,body,author_id) VALUES($1,$2,$3,$4,0,'{}',$5,$6)",
      [commentId, fixture.workspaceId, fixture.projectId, artifact.artifact.id, 'Уточнить формулировку', fixture.owner.userId],
    );
    await expect(pool.query(
      "INSERT INTO artifact_version_comments(id,workspace_id,project_id,artifact_id,artifact_revision,target,body,author_id,state) VALUES($1,$2,$3,$4,0,'{}',$5,$6,'resolved')",
      [randomUUID(), fixture.workspaceId, fixture.projectId, artifact.artifact.id, 'Решено без автора', fixture.owner.userId],
    )).rejects.toThrow(/artifact_version_comments_resolution_check/);
    await expect(pool.query(
      "INSERT INTO artifact_version_decisions(id,workspace_id,project_id,artifact_id,artifact_revision,decision,note,actor_id) VALUES($1,$2,$3,$4,999,'approved','',$5)",
      [randomUUID(), fixture.workspaceId, fixture.projectId, artifact.artifact.id, fixture.owner.userId],
    )).rejects.toThrow(/artifact_version_decisions_version_fk/);

    const ruleId = randomUUID();
    await pool.query(
      "INSERT INTO work_rules(id,workspace_id,project_id,owner_id,title,state,current_version) VALUES($1,$2,$3,$4,$5,'enabled',1)",
      [ruleId, fixture.workspaceId, fixture.projectId, fixture.owner.userId, 'Ежедневная сверка'],
    );
    await pool.query(
      "INSERT INTO work_rule_versions(id,workspace_id,rule_id,version,definition,reason,created_by) VALUES($1,$2,$3,1,'{}',$4,$5)",
      [randomUUID(), fixture.workspaceId, ruleId, 'Создание правила', fixture.owner.userId],
    );
    const occurrenceId = randomUUID();
    await pool.query(
      "INSERT INTO work_occurrences(id,workspace_id,project_id,rule_id,rule_version,trigger,state,branch_id) VALUES($1,$2,$3,$4,1,'{}','queued',$5)",
      [occurrenceId, fixture.workspaceId, fixture.projectId, ruleId, artifact.artifact.id],
    );
    await expect(pool.query(
      "INSERT INTO work_occurrences(id,workspace_id,project_id,rule_id,rule_version,trigger,state) VALUES($1,$2,$3,$4,1,'{}','completed')",
      [randomUUID(), fixture.workspaceId, fixture.projectId, ruleId],
    )).rejects.toThrow(/work_occurrences_completion_check/);
    await expect(pool.query('DELETE FROM work_rule_versions WHERE workspace_id=$1 AND rule_id=$2 AND version=1', [fixture.workspaceId, ruleId])).rejects.toThrow(/work_occurrences_rule_version_fk/);

    await expect(pool.query(
      "INSERT INTO outcome_observations(id,workspace_id,project_id,period_start,period_end,metric_key,label,value,evidence,recorded_by) VALUES($1,$2,$3,'2026-10-01','2026-10-02','orders','Заказы','{}','{}',$4)",
      [randomUUID(), fixture.workspaceId, fixture.projectId, fixture.owner.userId],
    )).rejects.toThrow(/outcome_observations_subject_check/);
    await pool.query(
      "INSERT INTO outcome_observations(id,workspace_id,project_id,occurrence_id,artifact_id,artifact_revision,period_start,period_end,metric_key,label,value,evidence,recorded_by) VALUES($1,$2,$3,$4,$5,0,'2026-10-01','2026-10-02','orders','Заказы','{}','{}',$6)",
      [randomUUID(), fixture.workspaceId, fixture.projectId, occurrenceId, artifact.artifact.id, fixture.owner.userId],
    );
  });
});
