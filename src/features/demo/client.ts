'use client';

import { ResumeRunSchema, RunSchema } from '@/contracts/runs';
import {
  CopyDemoSchema,
  DemoCopiedSchema,
  DemoErrorSchema,
  DemoRunStartedSchema,
  DemoSessionSchema,
  DemoStartedSchema,
  StartDemoRunSchema,
  StartDemoSchema,
} from './contracts';

export class DemoRequestError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfterSeconds?: number) {
    super(code);
  }
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init });
  if (!response.ok) {
    const payload = DemoErrorSchema.safeParse(await response.json().catch(() => ({})));
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new DemoRequestError(
      response.status,
      payload.success ? payload.data.code ?? 'UNAVAILABLE' : 'UNAVAILABLE',
      payload.success ? payload.data.retryAfterSeconds : Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }
  return response;
}

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });

export const demoClient = {
  async start(locale: unknown) {
    const body = StartDemoSchema.parse({ locale });
    return DemoStartedSchema.parse(await (await request('/api/demo/sessions', json(body))).json());
  },
  async session(sessionId: string) {
    return DemoSessionSchema.parse(await (await request(`/api/demo/sessions/${encodeURIComponent(sessionId)}`)).json());
  },
  async startRun(sessionId: string, body: unknown, idempotencyKey: string) {
    const input = StartDemoRunSchema.parse(body);
    return DemoRunStartedSchema.parse(await (await request(`/api/demo/sessions/${encodeURIComponent(sessionId)}/runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input),
    })).json());
  },
  async run(sessionId: string, runId: string) {
    return RunSchema.parse(await (await request(`/api/demo/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}`)).json());
  },
  async resumeRun(sessionId: string, runId: string, body: unknown, idempotencyKey: string) {
    const input = ResumeRunSchema.parse(body);
    return RunSchema.parse(await (await request(`/api/demo/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/resume`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input),
    })).json());
  },
  async copy(sessionId: string, body: unknown, idempotencyKey: string) {
    const input = CopyDemoSchema.parse(body);
    return DemoCopiedSchema.parse(await (await request(`/api/demo/sessions/${encodeURIComponent(sessionId)}/copy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input),
    })).json());
  },
};
