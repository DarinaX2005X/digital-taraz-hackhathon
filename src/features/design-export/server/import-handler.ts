import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { IdentityActor } from '@/features/identity/server/handlers';
import { assertOrigin, errorResponse, IdentityError, json, limit, validate } from '@/features/identity/server/http';
import { identityTransaction, withWorkspaceAccess, type SessionPrincipal } from '@/features/identity/server/access';
import { assertActorHeader, idempotencyKey, queryObject } from '@/features/artifacts/server/http';
import { createArtifactService } from '@/features/artifacts/server/service';
import { createSourceVisualImportAdapter } from '@/features/sources/server/visual-import';
import { readSourceFreshness } from '@/features/sources/server/source-heads';
import { createArtifactState } from '@/features/artifacts/domain/content-state';
import { ArtifactDraft, type ArtifactOperation } from '@/features/artifacts/domain/operations';
import { MerkleJson } from '@/features/artifacts/domain/merkle-json';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { IdSchema } from '@/contracts/primitives';
import { parseDesignPackage, remapPackageAssets } from './package';
import { digest, createDesignAssetCache } from './assets';
import { designPageSvg } from './svg';
import { DesignExportError } from './types';

const Query=z.strictObject({workspaceId:IdSchema,projectId:IdSchema,expectedAuthzVersion:z.coerce.number().int().positive(),action:z.enum(['preview','import']),previewHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),sourcePolicy:z.enum(['preserve','detach']).default('preserve'),confirmRights:z.enum(['true','false']).default('false'),accessClass:z.enum(['internal','confidential']).default('internal')});
const stableId=(operationId:string,purpose:string)=>{const hex=createHash('sha256').update(`tirlik-design-import-1:${operationId}:${purpose}`).digest('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;};
async function readBytes(request:Request){if(!['application/octet-stream','application/vnd.tirlik.design+zip'].includes(request.headers.get('content-type')?.split(';')[0]??''))throw new DesignExportError('invalid-package');const reader=request.body?.getReader();if(!reader)throw new DesignExportError('invalid-package');const chunks:Uint8Array[]=[];let size=0;try{for(;;){const result=await reader.read();if(result.done)break;size+=result.value.length;if(size>60*1024*1024){await reader.cancel();throw new DesignExportError('too-large');}chunks.push(result.value);}return Buffer.concat(chunks);}finally{reader.releaseLock();}}
export function createDesignImportHandler(options:{pool:Pool;origin:string;getActor(headers:Headers):Promise<IdentityActor>;reportError?(error:unknown):void}){
  const artifacts=createArtifactService(options.pool),sources=createSourceVisualImportAdapter(options.pool);
  return async(request:Request):Promise<Response>=>{
    try{
      if(request.method!=='POST')throw new IdentityError('NOT_FOUND','designs.errors.notFound');assertOrigin(request,options.origin);
      const actor=await options.getActor(request.headers);assertActorHeader(request,actor.user.id);const principal:SessionPrincipal={kind:'session',userId:actor.user.id,sessionId:actor.session.id};
      const input=validate(Query,queryObject(new URL(request.url),['workspaceId','projectId','expectedAuthzVersion','action','previewHash','sourcePolicy','confirmRights','accessClass'])),operationId=idempotencyKey(request);
      await limit(options.pool,`design-import:${actor.user.id}`,10,60);
      await withWorkspaceAccess(options.pool,principal,{workspaceId:input.workspaceId,projectId:input.projectId,scope:'edit',confidential:input.accessClass==='confidential',expectedAuthzVersion:input.expectedAuthzVersion},async(tx)=>{const project=(await tx.query<{status:string}>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2',[input.workspaceId,input.projectId])).rows[0];if(project?.status!=='active')throw new IdentityError('CONFLICT','artifacts.errors.archived');});
      const bytes=await readBytes(request),parsed=await parseDesignPackage(bytes),previewHash=digest(bytes);
      const refs=parsed.provenance.sourceRefs,sourceFreshness=refs.length?await withWorkspaceAccess(options.pool,principal,{workspaceId:input.workspaceId,scope:'read'},(tx,access)=>readSourceFreshness(tx,access,refs)):[];
      const canPreserveSources=sourceFreshness.every((item)=>item.status!=='unknown');
      const importedLocks=new Map(Object.entries(parsed.provenance.locks??{}));
      const safeBindings=parsed.provenance.bindings.map(({lock,override,...binding})=>{void override;if(lock&&!importedLocks.has(binding.targetElementId))importedLocks.set(binding.targetElementId,lock);return binding;});
      const targetDepth=new Map<string,number>();
      for(const page of parsed.content.pages){targetDepth.set(page.id,0);const visit=(layers:typeof page.layers,depth:number)=>{for(const layer of layers){targetDepth.set(layer.id,depth);if(layer.layers)visit(layer.layers,depth+1);}};visit(page.layers,1);}
      // Lock descendants before ancestors; otherwise the imported parent lock would
      // correctly protect its child and prevent the remaining archive locks.
      const orderedLocks=[...importedLocks].sort((a,b)=>(targetDepth.get(b[0])??0)-(targetDepth.get(a[0])??0)||(a[0]<b[0]?-1:a[0]>b[0]?1:0));
      const visualAssets=new Map(parsed.assets.filter((asset)=>asset.builtinWeight===undefined).map((asset)=>[asset.id,asset]));
      // Validate bytes, glyph coverage, crop and style before any persistent write.
      const cache=createDesignAssetCache({image:async(id)=>{const asset=visualAssets.get(id);if(!asset||asset.kind!=='image')throw new DesignExportError('missing-asset');return asset;},font:async(id)=>{const asset=visualAssets.get(id);if(!asset||asset.kind!=='font')throw new DesignExportError('missing-font');return asset;}},'embed');
      const warnings:string[]=[];for(const page of parsed.content.pages)warnings.push(...(await designPageSvg(page,cache,{scale:.1,transparent:false})).warnings);
      if(parsed.manifest.historicalDraftLabel)warnings.push(`historical-draft:${parsed.manifest.historicalDraftLabel}`);
      if(input.action==='preview')return json({previewHash,title:parsed.manifest.title,pageCount:parsed.content.pages.length,assets:parsed.assets.map((asset)=>({name:asset.id,kind:asset.kind,license:asset.license.name})),sourceCount:refs.length,canPreserveSources,lockCount:importedLocks.size,historicalDraftLabel:parsed.manifest.historicalDraftLabel,warnings:[...new Set(warnings)]});
      if(input.previewHash!==previewHash)throw new IdentityError('CONFLICT','designs.errors.importChanged');
      if(input.confirmRights!=='true')throw new IdentityError('VALIDATION_FAILED','designs.errors.rightsRequired');
      if(input.sourcePolicy==='preserve'&&!canPreserveSources)throw new DesignExportError('external-references');
      const remapping=new Map<string,string>();
      for(const asset of visualAssets.values()){
        const format=({'image/png':'png','image/jpeg':'jpeg','image/webp':'webp','font/ttf':'ttf','font/otf':'otf','font/woff':'woff','application/font-sfnt':'ttf'} as const)[asset.mediaType];
        const result=await sources.import(principal,{workspaceId:input.workspaceId,projectId:input.projectId,operationId:stableId(operationId,`asset:${asset.id}`),name:`${asset.id}.${format}`,format,sha256:asset.sha256,license:{permission:'confirmed',canEmbed:true,label:asset.license.name},accessClass:input.accessClass,bytes:asset.bytes});remapping.set(asset.id,result.assetId);
      }
      const content=remapPackageAssets(parsed.content,remapping),sourceRefs=input.sourcePolicy==='preserve'?refs:[],bindings=input.sourcePolicy==='preserve'?safeBindings:[];
      const result=await identityTransaction(options.pool,async(tx)=>{
        const created=await artifacts.createInTransaction(tx,principal,operationId,{workspaceId:input.workspaceId,projectId:input.projectId,expectedAuthzVersion:input.expectedAuthzVersion,title:parsed.manifest.title,content,sourceRefs,bindings,accessClass:input.accessClass});
        const locks=orderedLocks;
        if(locks.length){
          const graph=new MerkleJson(),draft=new ArtifactDraft(graph,graph.encode(createArtifactState(content,sourceRefs,bindings) as unknown as JsonValue)),operations:ArtifactOperation[]=[],metadataAt=created.version.createdAt;
          for(const [id,lock] of locks){const operation:ArtifactOperation={targetId:id,op:'lock',value:{locked:true,reason:lock.reason},beforeHash:(await draft.target(id))?.hash??null};await draft.apply([operation],{actorId:actor.user.id,origin:'human',reason:'Import design locks',at:metadataAt});operations.push(operation);}
          // The create receipt preserves the exact source vector from the first attempt.
          // Reusing it keeps the lock command body stable after an uncertain response.
          const currentSources=created.version.inputRevisions;
          await artifacts.applyInTransaction(tx,principal,{workspaceId:input.workspaceId,expectedAuthzVersion:input.expectedAuthzVersion,group:{commandGroupId:stableId(operationId,'locks'),metadataAt,expectedArtifactRevisions:{[created.artifact.id]:0},expectedSourceRevisions:input.sourcePolicy==='preserve'?currentSources:{},commands:[{commandId:stableId(operationId,'locks-command'),artifactId:created.artifact.id,baseRevision:0,kind:'design',operations,expectedSourceRevisions:input.sourcePolicy==='preserve'?currentSources:{},reason:'Import design locks'}]}},'import');
        }
        return artifacts.readInTransaction(tx,principal,{workspaceId:input.workspaceId,artifactId:created.artifact.id});
      });
      return json({artifactId:result.artifact.id,projectId:result.artifact.projectId,revision:result.artifact.currentRevision,detachedSources:input.sourcePolicy==='detach'?refs.length:0},201);
    }catch(error){if(error instanceof DesignExportError)return errorResponse(new IdentityError(error.code==='too-large'?'PAYLOAD_TOO_LARGE':'VALIDATION_FAILED',`designs.errors.${error.code}`));if(error instanceof z.ZodError)return errorResponse(new IdentityError('VALIDATION_FAILED','designs.errors.invalid-package'));if(!(error instanceof IdentityError))options.reportError?.(error);return errorResponse(error);}
  };
}
