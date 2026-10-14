import { assertBoundedJson, canonicalJson, ContentValidationError, hashJson, jsonBytes } from './canonical';
import type { JsonValue } from './content-models';

export type JsonPath = readonly (string | number)[];
export type ContentChunk =
  | { type: 'value'; value: JsonValue }
  | { type: 'object'; entries: [string, string][] }
  | { type: 'object-branches'; entries: [string, string][] }
  | { type: 'array'; entries: string[] }
  | { type: 'array-branches'; entries: { start: number; length: number; hash: string }[] };
export interface PreparedChunk { hash: string; data: ContentChunk; byteSize: number; children: string[] }
export type ChunkLoader = (hash: string) => Promise<ContentChunk>;
const LEAF_BYTES = 8192;
const OBJECT_FANOUT = 64;
const ARRAY_FANOUT = 128;

export function chunkChildren(chunk: ContentChunk): string[] {
  if (chunk.type === 'value') return [];
  if (chunk.type === 'array') return [...new Set(chunk.entries)];
  if (chunk.type === 'array-branches') return [...new Set(chunk.entries.map((entry) => entry.hash))];
  return [...new Set(chunk.entries.map(([, hash]) => hash))];
}

function at(value: JsonValue, path: JsonPath): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      if (typeof key !== 'number' || !Number.isInteger(key) || key < 0) return undefined;
      current = current[key];
    } else current = Object.hasOwn(current, String(key)) ? current[String(key)] : undefined;
  }
  return current;
}

function replace(value: JsonValue, path: JsonPath, replacement: JsonValue | undefined): JsonValue {
  if (!path.length) { if (replacement === undefined) throw new ContentValidationError('cannot-remove-root'); return replacement; }
  const [key, ...tail] = path;
  if (!value || typeof value !== 'object') throw new ContentValidationError('missing-path');
  if (Array.isArray(value)) {
    if (typeof key !== 'number' || !Number.isInteger(key) || key < 0 || key >= value.length || (replacement === undefined && !tail.length)) throw new ContentValidationError('invalid-array-path');
    const copy = [...value];
    copy[key] = tail.length ? replace(copy[key]!, tail, replacement) : replacement!;
    return copy;
  }
  if (key === undefined || ['__proto__', 'constructor', 'prototype'].includes(String(key))) throw new ContentValidationError('unsafe-property');
  const copy = { ...value };
  if (tail.length) copy[String(key)] = replace(copy[String(key)] ?? {}, tail, replacement);
  else if (replacement === undefined) delete copy[String(key)];
  else copy[String(key)] = replacement;
  return copy;
}

/** Immutable JSON chunks. Small edits rewrite only their leaf and ancestor paths. */
export class MerkleJson {
  readonly prepared = new Map<string, PreparedChunk>();
  readonly loaded = new Map<string, Promise<ContentChunk>>();
  constructor(private readonly loader: ChunkLoader = async () => { throw new ContentValidationError('missing-chunk'); }) {}

  encode(value: JsonValue): string {
    const bytes = jsonBytes(value);
    if (bytes <= LEAF_BYTES || value === null || typeof value !== 'object') return this.prepare({ type: 'value', value });
    if (Array.isArray(value)) return this.encodeArray(value);
    return this.encodeObject(value);
  }

  private prepare(data: ContentChunk): string {
    const byteSize = jsonBytes(data as unknown as JsonValue);
    if (byteSize > 1048576) throw new ContentValidationError('chunk-too-large');
    const hash = hashJson(data as unknown as JsonValue);
    if (!this.prepared.has(hash)) this.prepared.set(hash, { hash, data: structuredClone(data), byteSize, children: chunkChildren(data) });
    return hash;
  }

  private encodeObject(value: { [key: string]: JsonValue }): string {
    const keys = Object.keys(value).sort();
    if (keys.length <= OBJECT_FANOUT) return this.prepare({ type: 'object', entries: keys.map((key) => [key, this.encode(value[key]!)]) });
    let entries: [string, string][] = [];
    for (let start = 0; start < keys.length; start += OBJECT_FANOUT) {
      const group = keys.slice(start, start + OBJECT_FANOUT);
      entries.push([group[0]!, this.encode(Object.fromEntries(group.map((key) => [key, value[key]!])))]);
    }
    while (entries.length > OBJECT_FANOUT) {
      const parents: [string, string][] = [];
      for (let start = 0; start < entries.length; start += OBJECT_FANOUT) {
        const group = entries.slice(start, start + OBJECT_FANOUT);
        parents.push([group[0]![0], this.prepare({ type: 'object-branches', entries: group })]);
      }
      entries = parents;
    }
    return this.prepare({ type: 'object-branches', entries });
  }

  private encodeArray(value: JsonValue[]): string {
    if (value.length <= ARRAY_FANOUT) return this.prepare({ type: 'array', entries: value.map((item) => this.encode(item)) });
    let entries: { start: number; length: number; hash: string }[] = [];
    for (let start = 0; start < value.length; start += ARRAY_FANOUT) {
      const group = value.slice(start, start + ARRAY_FANOUT);
      entries.push({ start, length: group.length, hash: this.encode(group) });
    }
    while (entries.length > ARRAY_FANOUT) {
      const parents: typeof entries = [];
      for (let start = 0; start < entries.length; start += ARRAY_FANOUT) {
        const group = entries.slice(start, start + ARRAY_FANOUT);
        const offset = group[0]!.start;
        parents.push({ start: offset, length: group.reduce((sum, entry) => sum + entry.length, 0), hash: this.prepare({ type: 'array-branches', entries: group.map((entry) => ({ ...entry, start: entry.start - offset })) }) });
      }
      entries = parents;
    }
    return this.prepare({ type: 'array-branches', entries });
  }

  async chunk(hash: string): Promise<ContentChunk> {
    const local = this.prepared.get(hash);
    if (local) return local.data;
    if (!this.loaded.has(hash)) this.loaded.set(hash, this.loader(hash).then((chunk) => {
      assertBoundedJson(chunk, { bytes: 1048576, depth: 70 });
      if (hashJson(chunk as unknown as JsonValue) !== hash) throw new ContentValidationError('corrupt-chunk');
      return chunk;
    }));
    return this.loaded.get(hash)!;
  }

  async get(root: string, path: JsonPath = []): Promise<JsonValue | undefined> {
    const chunk = await this.chunk(root);
    if (chunk.type === 'value') { const value = at(chunk.value, path); return value === undefined ? undefined : structuredClone(value); }
    if (!path.length) return this.materialize(root);
    const [key, ...tail] = path;
    if (chunk.type === 'object') {
      const hash = chunk.entries.find(([name]) => name === String(key))?.[1];
      return hash ? this.get(hash, tail) : undefined;
    }
    if (chunk.type === 'object-branches') {
      const entry = [...chunk.entries].reverse().find(([first]) => first <= String(key));
      return entry ? this.get(entry[1], path) : undefined;
    }
    if (typeof key !== 'number' || !Number.isInteger(key) || key < 0) return undefined;
    if (chunk.type === 'array') return chunk.entries[key] ? this.get(chunk.entries[key]!, tail) : undefined;
    const entry = chunk.entries.find((entry) => key >= entry.start && key < entry.start + entry.length);
    return entry ? this.get(entry.hash, [key - entry.start, ...tail]) : undefined;
  }

  async set(root: string, path: JsonPath, value: JsonValue | undefined): Promise<string> {
    if (!path.length) { if (value === undefined) throw new ContentValidationError('cannot-remove-root'); return this.encode(value); }
    const chunk = await this.chunk(root);
    if (chunk.type === 'value') return this.encode(replace(chunk.value, path, value));
    const [key, ...tail] = path;
    if (chunk.type === 'object') {
      const entries = chunk.entries.map(([key, hash]) => [key, hash] as [string, string]);
      const position = entries.findIndex(([name]) => name === String(key));
      if (value === undefined && !tail.length) { if (position >= 0) entries.splice(position, 1); }
      else {
        const previous = position < 0 ? this.encode({}) : entries[position]![1];
        const hash = await this.set(previous, tail, value);
        if (position < 0) entries.push([String(key), hash]); else entries[position]![1] = hash;
      }
      entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      if (entries.length <= OBJECT_FANOUT) return this.prepare({ type: 'object', entries });
      return this.prepare({ type: 'object-branches', entries: [
        [entries[0]![0], this.prepare({ type: 'object', entries: entries.slice(0, OBJECT_FANOUT) })],
        [entries[OBJECT_FANOUT]![0], this.prepare({ type: 'object', entries: entries.slice(OBJECT_FANOUT) })],
      ] });
    }
    if (chunk.type === 'object-branches') {
      const entries = chunk.entries.map(([key, hash]) => [key, hash] as [string, string]);
      let position = entries.length - 1;
      while (position > 0 && entries[position]![0] > String(key)) position--;
      const selected = entries[position];
      if (!selected) return this.encode(replace({}, path, value));
      selected[1] = await this.set(selected[1], path, value);
      if (String(key) < selected[0]) selected[0] = String(key);
      return this.prepare({ type: 'object-branches', entries });
    }
    if (typeof key !== 'number' || !Number.isInteger(key) || key < 0 || (value === undefined && !tail.length)) throw new ContentValidationError('invalid-array-path');
    if (chunk.type === 'array') {
      const entries = [...chunk.entries];
      if (!entries[key]) throw new ContentValidationError('invalid-array-path');
      entries[key] = await this.set(entries[key]!, tail, value);
      return this.prepare({ type: 'array', entries });
    }
    const entries = chunk.entries.map((entry) => ({ ...entry }));
    const selected = entries.find((entry) => key >= entry.start && key < entry.start + entry.length);
    if (!selected) throw new ContentValidationError('invalid-array-path');
    selected.hash = await this.set(selected.hash, [key - selected.start, ...tail], value);
    return this.prepare({ type: 'array-branches', entries });
  }

  async materialize(root: string): Promise<JsonValue> {
    const chunk = await this.chunk(root);
    if (chunk.type === 'value') return structuredClone(chunk.value);
    if (chunk.type === 'array') return Promise.all(chunk.entries.map((hash) => this.materialize(hash)));
    if (chunk.type === 'array-branches') return (await Promise.all(chunk.entries.map((entry) => this.materialize(entry.hash)))).flat() as JsonValue[];
    if (chunk.type === 'object') return Object.fromEntries(await Promise.all(chunk.entries.map(async ([key, hash]) => [key, await this.materialize(hash)])));
    return Object.assign({}, ...await Promise.all(chunk.entries.map(([, hash]) => this.materialize(hash))));
  }

  async reachable(root: string): Promise<Set<string>> {
    const found = new Set<string>();
    const pending = [root];
    while (pending.length) {
      const hash = pending.pop()!;
      if (found.has(hash)) continue;
      found.add(hash);
      pending.push(...chunkChildren(await this.chunk(hash)));
    }
    return found;
  }

  debugCanonical(root: string): Promise<string> { return this.materialize(root).then(canonicalJson); }
}
