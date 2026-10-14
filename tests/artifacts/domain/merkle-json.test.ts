import { describe, expect, it } from 'vitest';
import { MerkleJson, type ContentChunk } from '../../../src/features/artifacts/domain/merkle-json';
import { hashJson, jsonBytes } from '../../../src/features/artifacts/domain/canonical';
import type { JsonValue } from '../../../src/features/artifacts/domain/content-models';

function persisted(graph: MerkleJson): Map<string, ContentChunk> { return new Map([...graph.prepared].map(([hash, chunk]) => [hash, structuredClone(chunk.data)])); }

describe('immutable structural sharing', () => {
  it('round-trips large nested objects and arrays and survives reopening without a process cache', async () => {
    const value = { rows: Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [String(i), { sku: `000${i}`, price: 1450 + i, note: `Қазақша ${i}` }])), order: Array.from({ length: 20000 }, (_, i) => `row_${i}`) };
    const initial = new MerkleJson(), root = initial.encode(value);
    const store = persisted(initial);
    const reopened = new MerkleJson(async (hash) => store.get(hash)!);
    expect(await reopened.get(root, ['rows', '17400', 'price'])).toBe(18850);
    expect(await reopened.get(root, ['order', 17000])).toBe('row_17000');
    expect(await reopened.materialize(root)).toEqual(value);
    expect(initial.prepared.size).toBeGreaterThan(100);
    expect(Math.max(...[...initial.prepared.values()].map((chunk) => chunk.byteSize))).toBeLessThanOrEqual(1048576);
  });
  it('changes only leaf/ancestors and leaves prior revisions, unrelated values and chunk hashes intact', async () => {
    const value = { rows: Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`row_${String(i).padStart(5, '0')}`, { price: i + 1450, note: 'Original manual condition' }])) };
    const initial = new MerkleJson(), root = initial.encode(value), store = persisted(initial);
    let reads = 0;
    const changed = new MerkleJson(async (hash) => { reads++; return store.get(hash)!; });
    const next = await changed.set(root, ['rows', 'row_10123', 'price'], 1595);
    expect(await changed.get(next, ['rows', 'row_10123', 'price'])).toBe(1595);
    expect(await changed.get(next, ['rows', 'row_10123', 'note'])).toBe('Original manual condition');
    expect(await changed.get(root, ['rows', 'row_10123', 'price'])).toBe(11573);
    expect(reads).toBeLessThan(12);
    expect(changed.prepared.size).toBeLessThan(12);
    const addedBytes = [...changed.prepared.values()].reduce((sum, chunk) => sum + chunk.byteSize, 0);
    expect(addedBytes).toBeLessThan(30000);
  });
  it('supports inserting and deleting sparse object fields without materializing a whole workbook', async () => {
    const data = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`key_${String(i).padStart(5, '0')}`, { value: 'long enough value'.repeat(5) }])) as JsonValue;
    const graph = new MerkleJson(); const root = graph.encode(data);
    let next = await graph.set(root, ['a_first', 'value'], 'first');
    next = await graph.set(next, ['key_00020', 'new'], true);
    next = await graph.set(next, ['key_00020', 'value'], undefined);
    next = await graph.set(next, ['z_last'], 3);
    expect(await graph.get(next, ['a_first', 'value'])).toBe('first');
    expect(await graph.get(next, ['key_00020'])).toEqual({ new: true });
    expect(await graph.get(next, ['z_last'])).toBe(3);
    expect(await graph.get(root, ['a_first'])).toBeUndefined();
  });
  it('updates deeply partitioned arrays by logical index and does not shift siblings', async () => {
    const values = Array.from({ length: 20000 }, (_, i) => ({ id: `item_${i}`, value: i }));
    const graph = new MerkleJson(); const root = graph.encode(values);
    const next = await graph.set(root, [17890, 'value'], 'changed');
    expect(await graph.get(next, [17890])).toEqual({ id: 'item_17890', value: 'changed' });
    expect(await graph.get(next, [17891])).toEqual({ id: 'item_17891', value: 17891 });
    expect(await graph.get(root, [17890, 'value'])).toBe(17890);
    await expect(graph.set(next, [17890], undefined)).rejects.toThrow('invalid-array-path');
  });
  it('uses only reachable chunks from a batch, detects corruption and never resolves another store by hash', async () => {
    const graph = new MerkleJson(); const root = graph.encode({ text: 'manual' });
    const next = await graph.set(root, ['text'], 'accepted');
    graph.encode({ discarded: 'not committed' });
    expect((await graph.reachable(next)).has(root)).toBe(false);
    const foreign = new MerkleJson(async () => { throw new Error('missing'); });
    await expect(foreign.materialize(root)).rejects.toThrow('missing');
    const corrupted = new MerkleJson(async () => ({ type: 'value', value: 'tampered' }));
    await expect(corrupted.materialize(root)).rejects.toThrow('corrupt-chunk');
    expect(hashJson(await graph.materialize(next))).not.toBe(hashJson(await graph.materialize(root)));
  });
  it('stores 1000 local revisions of a 10 MiB/20000-row document with bounded shared growth', async () => {
    const value = { rows: Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`row_${String(i).padStart(5, '0')}`, { price: i, note: `${i}:` + 'Original manual condition. '.repeat(22) }])) };
    expect(jsonBytes(value)).toBeGreaterThan(10 * 1024 * 1024);
    const graph = new MerkleJson(), first = graph.encode(value);
    const initialChunks = new Set(graph.prepared.keys());
    let root = first;
    for (let revision = 0; revision < 1000; revision++) root = await graph.set(root, ['rows', 'row_10123', 'price'], 100000 + revision);
    const added = [...graph.prepared.values()].filter((chunk) => !initialChunks.has(chunk.hash));
    expect(added.length).toBeLessThan(10000);
    expect(added.reduce((bytes, chunk) => bytes + chunk.byteSize, 0)).toBeLessThan(32 * 1024 * 1024);
    expect(await graph.get(first, ['rows', 'row_10123', 'price'])).toBe(10123);
    expect(await graph.get(root, ['rows', 'row_10123', 'price'])).toBe(100999);
    const current = await graph.reachable(root), original = await graph.reachable(first);
    expect([...original].filter((hash) => !current.has(hash)).length).toBeLessThan(10);
    const reopened = new MerkleJson(async (hash) => structuredClone(graph.prepared.get(hash)!.data));
    expect(await reopened.get(root, ['rows', 'row_10124'])).toEqual(value.rows.row_10124);
  }, 30000);
});
