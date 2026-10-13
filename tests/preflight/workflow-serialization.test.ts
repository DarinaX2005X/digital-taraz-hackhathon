import { describe, expect, it } from 'vitest';
import {
  dehydrateStepReturnValue, dehydrateWorkflowArguments,
  hydrateStepReturnValue, hydrateWorkflowArguments,
} from '@workflow/core/serialization';

describe('installed Workflow serialization compatibility', () => {
  it.each([false, true])('round-trips actual workflow arguments and step results (legacy codec: %s)', async (legacy) => {
    const source = {
      timestamp: new Date('2026-10-13T12:30:00.000Z'),
      prices: new Map([['KZT', 375000]]),
      tags: new Set(['synthetic', 'probe']),
      bytes: new Uint8Array([240, 17, 23, 250]).subarray(1, 3),
      numbers: new Int16Array([901, -5, 42, 902]).subarray(1, 3),
    };
    for (const [dehydrate, hydrate] of [
      [dehydrateWorkflowArguments, hydrateWorkflowArguments],
      [dehydrateStepReturnValue, hydrateStepReturnValue],
    ] as const) {
      const operations: Promise<void>[] = [];
      const encoded = await dehydrate(source, 'wrun_offline_synthetic', undefined, operations, globalThis, legacy);
      await Promise.all(operations);
      const decoded = await hydrate(encoded, 'wrun_offline_synthetic', undefined) as typeof source;
      expect(decoded.timestamp).toBeInstanceOf(Date);
      expect(decoded.timestamp.toISOString()).toBe(source.timestamp.toISOString());
      expect(decoded.prices).toEqual(source.prices);
      expect(decoded.tags).toEqual(source.tags);
      expect([...decoded.bytes]).toEqual([17, 23]);
      expect([...decoded.numbers]).toEqual([-5, 42]);
      expect(decoded.bytes.buffer.byteLength).toBe(2);
      expect(decoded.numbers.buffer.byteLength).toBe(4);
    }
  });
});
