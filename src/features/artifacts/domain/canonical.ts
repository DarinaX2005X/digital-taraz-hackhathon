import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { JsonValue } from './content-models';

export const CONTENT_LIMITS = { bytes: 20 * 1024 * 1024, depth: 64, values: 2_000_000, documentNodes: 20_000, designLayers: 20_000, tableCells: 2_000_000 } as const;

export class ContentValidationError extends Error {
  constructor(public readonly reason: string, public readonly path: readonly (string | number)[] = []) { super(reason); }
}
export interface JsonMetrics { bytes: number; values: number; depth: number }

/** Check before recursive schemas/serialization, including values received from internal tools. */
export function assertBoundedJson(input: unknown, limits: { bytes?: number; depth?: number; values?: number } = {}): asserts input is JsonValue {
  measureJson(input, limits);
}
export function measureJson(input: unknown, limits: { bytes?: number; depth?: number; values?: number } = {}): JsonMetrics {
  const maxBytes = limits.bytes ?? CONTENT_LIMITS.bytes;
  const maxDepth = limits.depth ?? CONTENT_LIMITS.depth;
  const maxValues = limits.values ?? CONTENT_LIMITS.values;
  const stack: { value: unknown; depth: number; leave?: boolean }[] = [{ value: input, depth: 0 }];
  const active = new Set<object>();
  let values = 0;
  let bytes = 0;
  let depth = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.leave) { active.delete(entry.value as object); continue; }
    if (++values > maxValues || entry.depth > maxDepth) throw new ContentValidationError('content-too-complex');
    depth = Math.max(depth, entry.depth);
    const value = entry.value;
    if (value === null || typeof value === 'boolean') bytes += 5;
    else if (typeof value === 'string') bytes += utf8ToBytes(JSON.stringify(value)).length;
    else if (typeof value === 'number' && Number.isFinite(value)) bytes += String(value).length;
    else if (typeof value === 'object' && value !== null) {
      if (active.has(value)) throw new ContentValidationError('cyclic-content');
      if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new ContentValidationError('non-json-object');
      active.add(value);
      stack.push({ value, depth: entry.depth, leave: true });
      bytes += 2;
      const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
      for (const [key, child] of entries) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new ContentValidationError('unsafe-property');
        bytes += Array.isArray(value) ? 1 : utf8ToBytes(JSON.stringify(key)).length + 2;
        stack.push({ value: child, depth: entry.depth + 1 });
      }
    } else throw new ContentValidationError('non-json-value');
    if (bytes > maxBytes) throw new ContentValidationError('content-too-large');
  }
  return { bytes, values, depth };
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(',')}}`;
}

export function hashJson(value: JsonValue): string { return bytesToHex(sha256(utf8ToBytes(canonicalJson(value)))); }
export function jsonBytes(value: JsonValue): number { return utf8ToBytes(canonicalJson(value)).length; }
export function stableToken(value: string): string { return bytesToHex(sha256(utf8ToBytes(value))).slice(0, 24); }
