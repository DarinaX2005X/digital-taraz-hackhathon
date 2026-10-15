import { describe, expect, it, vi } from 'vitest';
import type { ArtifactSession, ArtifactSessionState } from '@/features/artifacts/client/session';
import type { CommandGroupInput } from '@/contracts/commands';
import type { LocalDraft } from '@/features/artifacts/client/local-records';
import { ArtifactDraft } from '@/features/artifacts/domain/operations';
import { MerkleJson } from '@/features/artifacts/domain/merkle-json';
import { createEditorArtifactState } from '@/features/artifacts/client/snapshot-state';
import { createDesignController } from '@/features/designs/client/controller';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { snapshot, ids, at } from './fixtures';

function harness() {
  let state: ArtifactSessionState={phase:'ready',snapshot:snapshot(),storageReady:true,versions:[],nextBeforeRevision:null,loading:false,versionLoading:false,versionsLoading:false,drafts:[],pending:[],operation:{phase:'idle'},autosave:{status:'saved',pendingCount:0,dirtyCount:0,locallyPersisted:true}};
  const listeners=new Set<()=>void>(),groups:CommandGroupInput[]=[];
  const emit=()=>listeners.forEach((listener)=>listener());
  const writeDraft=vi.fn(async(draft:LocalDraft)=>{state={...state,drafts:[draft]};emit();});
  const enqueue=vi.fn(async(group:CommandGroupInput)=>{groups.push(group);});
  const session={getSnapshot:()=>state,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);},writeDraft,enqueue,flush:vi.fn(async()=>true),retrySave:vi.fn(async()=>undefined)} as unknown as ArtifactSession;
  return {session,groups,writeDraft,enqueue,get state(){return state;},setState(patch:Partial<ArtifactSessionState>){state={...state,...patch};emit();},
    async confirm(index:number) {
      const group=groups[index]!,previous=state.snapshot!,graph=new MerkleJson(),draft=new ArtifactDraft(graph,graph.encode(createEditorArtifactState(previous) as unknown as JsonValue));
      await draft.apply(group.commands[0]!.operations,{actorId:ids.user,at,origin:'human',reason:group.commands[0]!.reason});
      const canonical=await draft.state(),revision=previous.artifact.currentRevision+1;
      const next={...previous,content:canonical.content,locks:canonical.locks,artifact:{...previous.artifact,currentRevision:revision,bindings:Object.values(canonical.bindings)},version:{...previous.version,revision},history:[{commandGroupId:group.commandGroupId,actorId:ids.user,reason:'Edit',origin:'human' as const,createdAt:at,state:'active' as const,committedRevisionVector:{[ids.artifact]:revision},artifacts:[{artifactId:ids.artifact,title:previous.artifact.title,kind:'design' as const,committedRevision:revision,currentRevision:revision}],hasUnavailableArtifacts:false,canUndo:true,canRedo:false},...previous.history]};
      state={...state,snapshot:next,drafts:[],pending:[],autosave:{status:'saved',pendingCount:0,dirtyCount:0,locallyPersisted:true}};emit();
    }};
}
describe('design gesture queue',()=>{
  it('coalesces unsent typing and commits one authoritative command group',async()=>{
    const h=harness(),controller=createDesignController(h.session);controller.mount();
    try {
      await controller.action({type:'update-layer',id:'title',patch:{text:'Қ'}},'Type',{typingKey:'title'});
      await controller.action({type:'update-layer',id:'title',patch:{text:'Қазақша'}},'Type',{typingKey:'title'});
      expect(h.groups).toHaveLength(0);
      const flushing=controller.flush();await vi.waitFor(()=>expect(h.groups).toHaveLength(1));
      expect(h.groups[0]!.commands).toHaveLength(1);await h.confirm(0);
      expect(await flushing).toBe(true);expect(controller.getSnapshot().content.pages[0]!.layers[0]!.text).toBe('Қазақша');
    }finally{controller.dispose();}
  });
  it('queues later gestures and advances revisions only after its own receipt',async()=>{
    const h=harness(),controller=createDesignController(h.session);controller.mount();
    try {
      await controller.action({type:'translate',ids:['title'],x:20,y:0},'Move');await vi.waitFor(()=>expect(h.groups).toHaveLength(1));
      await controller.action({type:'translate',ids:['title'],x:0,y:15},'Move');expect(h.groups).toHaveLength(1);
      await h.confirm(0);await vi.waitFor(()=>expect(h.groups).toHaveLength(2));
      expect(h.groups[1]!.expectedArtifactRevisions[ids.artifact]).toBe(2);await h.confirm(1);
      expect(controller.getSnapshot().content.pages[0]!.layers[0]!.transform).toMatchObject({x:30,y:35});expect(controller.getSnapshot().phase).toBe('ready');
    }finally{controller.dispose();}
  });
  it('rebases queued hashes against authoritative override metadata after a receipt',async()=>{
    const h=harness(),initial=h.state.snapshot!,ref={sourceId:'7c48e4e5-0264-477a-881b-a453cc78c7fb',sourceVersionId:'087b67b3-07e1-475d-ad5a-ad1e3d74efb3',revision:1};
    initial.artifact.sourceRefs=[ref];initial.artifact.bindings=[{targetElementId:'title',sourceRef:ref,transformId:'text',updateMode:'propose'}];initial.sourceFreshness=[{sourceRef:ref,status:'current',sourceStatus:'current',currentRevision:1}];
    const controller=createDesignController(h.session);controller.mount();
    try {
      await controller.action({type:'update-layer',id:'title',patch:{text:'First'}},'Type');await vi.waitFor(()=>expect(h.groups).toHaveLength(1));
      await controller.action({type:'update-layer',id:'title',patch:{text:'Second'}},'Type');await h.confirm(0);await vi.waitFor(()=>expect(h.groups).toHaveLength(2));
      await expect(h.confirm(1)).resolves.toBeUndefined();expect(controller.getSnapshot().content.pages[0]!.layers[0]!.text).toBe('Second');
    }finally{controller.dispose();}
  });
  it('stops pending gestures on a foreign revision instead of silently rebasing',async()=>{
    const h=harness(),controller=createDesignController(h.session);controller.mount();
    try {await controller.action({type:'update-layer',id:'title',patch:{text:'Local'}},'Type',{typingKey:'title'});const previous=h.state.snapshot!;h.setState({snapshot:{...previous,artifact:{...previous.artifact,currentRevision:2},version:{...previous.version,revision:2}}});expect(controller.getSnapshot().phase).toBe('conflict');expect(await controller.flush()).toBe(false);expect(h.groups).toHaveLength(0);expect(h.writeDraft).toHaveBeenCalled();}finally{controller.dispose();}
  });
  it('does not replay recovered local drafts or expose edits after account loss',async()=>{
    const h=harness();h.setState({drafts:[{artifactId:ids.artifact,baseRevision:1,schemaVersion:1,generation:4,content:snapshot().content,updatedAt:at}]});
    const controller=createDesignController(h.session);controller.mount();
    try{expect(controller.getSnapshot().phase).toBe('recovery');expect(await controller.action({type:'remove',ids:['title']},'Delete')).toBeUndefined();expect(h.groups).toHaveLength(0);h.setState({phase:'authentication-required',snapshot:undefined});expect(controller.getSnapshot().phase).toBe('hidden');expect(await controller.flush()).toBe(false);}finally{controller.dispose();}
  });
});
