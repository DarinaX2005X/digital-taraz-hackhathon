import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { CreateRun, ResumeRun, RunAction, RunPolicy, RunResultRef } from '../../../contracts/runs';
import { CapabilityIdSchema, ToolNameSchema, RunPolicySchema } from '../../../contracts/runs';
import { RunError } from '../domain/errors';
import { boundedObject, type JsonObject, type RunFence } from './data';

export interface PlannedStep { tool: string; version: number; action: RunAction; input: JsonObject }
export interface ToolContext {
  fence: RunFence; workspaceId: string; projectId: string | null; userId: string; authzVersion: number;
  context: JsonObject; signal: AbortSignal;
  checkpoint: (input: { key: string; inputHash: string; effect: (transaction: PoolClient, currentContext: JsonObject) => Promise<{ context: JsonObject; resultRefs?: RunResultRef[] }> }) => Promise<{ replay: boolean; context: JsonObject; resultRefs: RunResultRef[] }>;
}
export interface ToolOutcome {
  output: unknown; resultRefs?: RunResultRef[]; context?: JsonObject; nextSteps?: PlannedStep[];
  state?: 'completed' | 'waiting_input' | 'review_ready';
}
export interface RunTool {
  name: string; version: number; purpose: string; input: z.ZodType; output: z.ZodType;
  policy: RunPolicy; costClass: 'local' | 'model' | 'image'; deadlineMs: number; idempotency: 'receipt';
  prepare?: (input: unknown, context: ToolContext) => Promise<unknown>;
  execute: (transaction: PoolClient, input: unknown, prepared: unknown, context: ToolContext) => Promise<ToolOutcome>;
}
export interface RunCapability {
  id: string; version: number; publicStart: boolean; policy: RunPolicy;
  initialize: (input: CreateRun, privateInput: JsonObject) => { context: JsonObject; steps: PlannedStep[] };
  continue?: (input: CreateRun, context: JsonObject, change: ResumeRun) => { context: JsonObject; steps: PlannedStep[] };
}
export function createRunRegistry(capabilities: readonly RunCapability[], tools: readonly RunTool[]) {
  const capabilityMap = new Map<string, RunCapability>();
  const toolMap = new Map<string, RunTool>();
  for (const capability of capabilities) {
    const key = `${CapabilityIdSchema.parse(capability.id)}@${z.number().int().positive().parse(capability.version)}`;
    if (capabilityMap.has(key)) throw new Error('DUPLICATE_CAPABILITY');
    RunPolicySchema.parse(capability.policy);
    capabilityMap.set(key, Object.freeze({ ...capability, policy: Object.freeze({ ...capability.policy }) }));
  }
  for (const tool of tools) {
    const key = `${ToolNameSchema.parse(tool.name)}@${z.number().int().positive().parse(tool.version)}`;
    if (toolMap.has(key)) throw new Error('DUPLICATE_TOOL');
    RunPolicySchema.parse(tool.policy);
    if (!tool.purpose || tool.deadlineMs <= 0 || tool.deadlineMs > (tool.costClass === 'local' ? 30_000 : 60_000) || tool.idempotency !== 'receipt') throw new Error('INVALID_TOOL');
    toolMap.set(key, Object.freeze({ ...tool, policy: Object.freeze({ ...tool.policy }) }));
  }
  return Object.freeze({
    capability(id: string, version: number) { const item = capabilityMap.get(`${id}@${version}`); if (!item) throw new RunError('configuration'); return item; },
    tool(name: string, version: number) { const item = toolMap.get(`${name}@${version}`); if (!item) throw new RunError('configuration'); return item; },
    plan(step: PlannedStep): PlannedStep {
      const tool = toolMap.get(`${step.tool}@${step.version}`);
      if (!tool) throw new RunError('configuration');
      return { ...step, input: boundedObject(tool.input.parse(step.input)) };
    },
    list: () => [...capabilityMap.values()].filter((capability) => capability.publicStart).map(({ id, version }) => ({ id, version })),
  });
}
export type RunRegistry = ReturnType<typeof createRunRegistry>;
