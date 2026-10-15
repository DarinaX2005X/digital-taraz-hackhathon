import { z } from 'zod';
import type { RunCapability, RunTool } from './registry';
import { RunError } from '../domain/errors';
import { hash } from './data';

export const FIXTURE_CAPABILITY = 'runtime.synthetic';
const inputSchema = z.strictObject({ marker: z.literal('synthetic-runtime-check') });
const policy = { scope: 'edit' as const, confidential: false };

/** Explicit test fixture. It never creates business material or calls a model. */
export function runtimeFixture(publicStart = false): { capability: RunCapability; tools: RunTool[] } {
  return {
    capability: {
      id: FIXTURE_CAPABILITY, version: 1, publicStart, policy,
      initialize: (_input, privateInput) => ({
        context: { synthetic: true, ...(privateInput.pause === true ? { pause: true } : {}) },
        steps: [
          { tool: 'runtime.fixture-check', version: 1, action: 'validate', input: { marker: 'synthetic-runtime-check' } },
          { tool: 'runtime.fixture-save', version: 1, action: 'save', input: { marker: 'synthetic-runtime-check' } },
        ],
      }),
    },
    tools: [
      {
        name: 'runtime.fixture-check', version: 1, purpose: 'Validate the explicit synthetic runtime fixture',
        input: inputSchema, output: z.strictObject({ checked: z.literal(true) }), policy, costClass: 'local', deadlineMs: 30_000, idempotency: 'receipt',
        prepare: async (_input, context) => context.checkpoint({
          key: 'fixture_checked', inputHash: hash({ marker: 'synthetic-runtime-check' }),
          effect: async (_tx, current) => ({ context: { ...current, checked: true } }),
        }),
        execute: async (_tx, _input, _prepared, context) => {
          if (context.context.checked !== true) throw new RunError('invalid_result');
          return { output: { checked: true }, ...(context.context.pause === true ? { state: 'waiting_input' as const } : {}) };
        },
      },
      {
        name: 'runtime.fixture-save', version: 1, purpose: 'Persist the synthetic verification receipt',
        input: inputSchema, output: z.strictObject({ saved: z.literal(true) }), policy, costClass: 'local', deadlineMs: 30_000, idempotency: 'receipt',
        execute: async (_tx, _input, _prepared, context) => {
          if (context.context.checked !== true) throw new RunError('invalid_result');
          return { output: { saved: true }, context: { ...context.context, saved: true }, state: 'completed' };
        },
      },
    ],
  };
}
