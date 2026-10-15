import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';
import { createArtifactService } from '@/features/artifacts/server/service';
import { prepareDesignAction } from '@/features/designs/domain/actions';
import { prepareHistoryOperation } from '@/features/artifacts/client/checked-history';
import { ArtifactHistoryActionSchema } from '@/features/artifacts/contracts';
import type { DesignAction } from '@/features/designs/domain/actions';
import { content } from './fixtures';
import { withWorkspaceAccess } from '@/features/identity/server/access';
import { createPendingSource, publishSourceVersion } from '@/features/sources/server/source-heads';

let pool:Pool;beforeAll(()=>{pool=artifactTestPool();});afterAll(async()=>{await pool?.end();});
describe('design editor durable service journey',()=>{
  it('creates, edits, reopens, locks, undoes and redoes exact design state through the canonical journal',async()=>{
    const fixture=await artifactFixture(pool),created=await fixture.create(content(),'Қазақша макет');
    const edit=async(action:DesignAction)=>{const snapshot=await fixture.read(created.artifact.id),prepared=await prepareDesignAction(snapshot,action,'Edit design');return fixture.service.apply(fixture.owner,{workspaceId:fixture.workspaceId,expectedAuthzVersion:snapshot.viewer.authzVersion,group:{...prepared.command,commandGroupId:randomUUID(),commands:prepared.command.commands.map((command)=>({...command,commandId:randomUUID()}))}});};
    await edit({type:'update-layer',id:'title',patch:{text:'Жаңа ұсыныс · Новое предложение',name:'Main heading'}});
    await edit({type:'group',ids:['title','photo']});
    const grouped=await fixture.read(created.artifact.id);expect(grouped.content.kind).toBe('design');if(grouped.content.kind!=='design')throw new Error('design');
    const group=grouped.content.pages[0]!.layers[0]!;
    await edit({type:'update-layer',id:group.id,patch:{transform:{...group.transform,x:100,y:150,rotation:30}}});
    const changed=await fixture.read(created.artifact.id),secondPool=artifactTestPool();
    try{const reopened=await createArtifactService(secondPool).readRoute(fixture.owner,{projectId:fixture.projectId,artifactId:created.artifact.id});expect(reopened.content).toEqual(changed.content);}finally{await secondPool.end();}
    const locked=await edit({type:'lock',ids:[group.id],locked:true});
    await expect(prepareDesignAction(await fixture.read(created.artifact.id),{type:'translate',ids:[group.id],x:1,y:0},'Move')).rejects.toThrow('locked');
    const history=await fixture.service.history(fixture.owner,{workspaceId:fixture.workspaceId,artifactId:created.artifact.id});
    const undo=prepareHistoryOperation(history,locked.commandGroupId,'undo');await fixture.service.undo(fixture.owner,ArtifactHistoryActionSchema.parse(undo.body));
    expect((await fixture.read(created.artifact.id)).locks?.[group.id]).toBeUndefined();
    const redoHistory=await fixture.service.history(fixture.owner,{workspaceId:fixture.workspaceId,artifactId:created.artifact.id});const redo=prepareHistoryOperation(redoHistory,locked.commandGroupId,'redo');await fixture.service.redo(fixture.owner,ArtifactHistoryActionSchema.parse(redo.body));
    expect((await fixture.read(created.artifact.id)).locks?.[group.id]).toBeDefined();
  });
  it('requires project access for read and edit and rejects stale design commands without changing content',async()=>{
    const fixture=await artifactFixture(pool),created=await fixture.create(content()),snapshot=await fixture.read(created.artifact.id);
    const prepared=await prepareDesignAction(snapshot,{type:'update-layer',id:'title',patch:{text:'Changed'}},'Edit');
    const request={workspaceId:fixture.workspaceId,expectedAuthzVersion:1,group:{...prepared.command,commandGroupId:randomUUID(),commands:prepared.command.commands.map((command)=>({...command,commandId:randomUUID()}))}};
    await expect(fixture.service.apply(fixture.member,request)).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(fixture.service.read(fixture.member,{workspaceId:fixture.workspaceId,artifactId:created.artifact.id})).rejects.toMatchObject({code:'NOT_FOUND'});
    await fixture.service.apply(fixture.owner,request);
    await expect(fixture.service.apply(fixture.owner,{...request,group:{...request.group,commandGroupId:randomUUID(),commands:request.group.commands.map((command)=>({...command,commandId:randomUUID()}))}})).rejects.toMatchObject({code:'CONFLICT'});
    expect((await fixture.read(created.artifact.id)).artifact.currentRevision).toBe(1);
  });
  it('persists independent text/fill bindings and leaves them unoverridden after geometry-only edits',async()=>{
    const fixture=await artifactFixture(pool),textRef={sourceId:randomUUID(),sourceVersionId:randomUUID(),revision:1},fillRef={sourceId:randomUUID(),sourceVersionId:randomUUID(),revision:1};
    await withWorkspaceAccess(pool,fixture.owner,{workspaceId:fixture.workspaceId,projectId:fixture.projectId,scope:'edit'},async(tx,access)=>{for(const ref of [textRef,fillRef]){await createPendingSource(tx,access,{sourceId:ref.sourceId,projectId:fixture.projectId,accessClass:'internal'});await publishSourceVersion(tx,access,{sourceId:ref.sourceId,versionId:ref.sourceVersionId,expectedRevision:0,snapshotHash:(ref===textRef?'1':'2').repeat(64)});}});
    const created=await fixture.service.create(fixture.owner,randomUUID(),{workspaceId:fixture.workspaceId,projectId:fixture.projectId,expectedAuthzVersion:1,title:'Bound design',content:content(),sourceRefs:[textRef,fillRef],bindings:[{targetElementId:'title',targetProperty:'text',sourceRef:textRef,transformId:'display-text',updateMode:'propose'},{targetElementId:'title',targetProperty:'fill',sourceRef:fillRef,transformId:'brand-color',updateMode:'propose'}]});
    const apply=async(action:DesignAction)=>{const snapshot=await fixture.read(created.artifact.id),prepared=await prepareDesignAction(snapshot,action,'Edit property',{at:'2026-10-15T12:00:00.000Z'}),id=randomUUID();return fixture.service.apply(fixture.owner,{workspaceId:fixture.workspaceId,expectedAuthzVersion:1,group:{...prepared.command,commandGroupId:id,commands:prepared.command.commands.map((command)=>({...command,commandId:randomUUID()}))}});};
    const initial=await fixture.read(created.artifact.id);if(initial.content.kind!=='design')throw new Error('design');const layer=initial.content.pages[0]!.layers[0]!;
    await apply({type:'transform-layers',transforms:[{id:'title',transform:{...layer.transform,x:layer.transform.x+40,y:layer.transform.y+20}}]});
    let reopened=await fixture.read(created.artifact.id);expect(reopened.artifact.bindings.every((binding)=>!binding.override)).toBe(true);
    await apply({type:'update-layer',id:'title',patch:{text:'143 600 ₸'}});reopened=await fixture.read(created.artifact.id);
    expect(reopened.artifact.bindings.find((binding)=>binding.targetProperty==='text')?.override?.reason).toBe('Edit property');
    expect(reopened.artifact.bindings.find((binding)=>binding.targetProperty==='fill')?.override).toBeUndefined();
    await apply({type:'unbind',id:'title',targetProperty:'text'});reopened=await fixture.read(created.artifact.id);
    expect(reopened.artifact.bindings.map((binding)=>binding.targetProperty)).toEqual(['fill']);
  });
});
