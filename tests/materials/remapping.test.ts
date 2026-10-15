import { describe, expect, it } from 'vitest';
import { ImportMappingSchema } from '../../src/contracts/materials';
import { reconcileColumns } from '../../src/features/materials/domain/remapping';

const mapping = ImportMappingSchema.parse({ fields: [
  {id:'sku',label:'Code',column:0,header:'SKU',kind:'text'},
  {id:'price',label:'Price',column:1,header:'Price',kind:'money',currency:'KZT'},
],headerRow:1,headers:['SKU','Price'],importMode:'upsert',recordKeySpec:{kind:'fields',fieldIds:['sku'],trim:true,caseSensitive:true,confirmed:true} });

describe('reimport column reconciliation', () => {
  it('follows unique source headers after reorder without changing field identities or monetary meaning', () => {
    const proposal = reconcileColumns(mapping,['Price','SKU']);
    expect(proposal.unresolved).toEqual([]);
    expect(proposal.fields).toEqual([{...mapping.fields[0],column:1},{...mapping.fields[1],column:0}]);
    expect(mapping.fields.map((field)=>field.column)).toEqual([0,1]);
  });
  it('never falls back to the old position for renamed, removed or duplicate headers', () => {
    expect(reconcileColumns(mapping,['SKU','Amount'])).toMatchObject({unresolved:['price'],fields:[{id:'sku',column:0},{id:'price',column:-1}]});
    expect(reconcileColumns(mapping,['SKU','Price','Price'])).toMatchObject({unresolved:['price'],fields:[{id:'sku',column:0},{id:'price',column:-1}]});
    expect(reconcileColumns(mapping,['Price'])).toMatchObject({unresolved:['sku'],fields:[{id:'sku',column:-1},{id:'price',column:0}]});
  });
  it('requires explicit source columns for headerless input and rejects unresolved mappings', () => {
    const proposal = reconcileColumns(mapping,null);
    expect(proposal.unresolved).toEqual(['sku','price']);
    expect(ImportMappingSchema.safeParse({...mapping,fields:proposal.fields,headers:[],headerRow:0}).success).toBe(false);
  });
});
