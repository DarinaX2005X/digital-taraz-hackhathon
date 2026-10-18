import type { ArtifactContent } from '../../artifacts/domain/content-models';
import type { FieldBinding, SourceRef } from '../../../contracts/artifacts';
import type { ArtifactSnapshot } from '../../artifacts/contracts';
import type { DesignAssetResolver } from '../../design-export/server/types';
import type { ExportFile, ExportFormat, ExportLocale, ExportOptions, ExportRelease, ExportWarning } from '../contracts';
export type ExportResourceKind = 'image' | 'font' | 'design-image' | 'design-font';
export interface ExportResourceRef { id: string; kind: ExportResourceKind }
export interface PlanResourceRef { resourceId: string }
export interface PlanExportResources { resources: { resourceId: string; resourceRevision: number; displayName: string; kind: string; timezone: string; availability?: { id: string; revision: number; timezone: string; effectiveFrom: string; effectiveTo: string | null; verifiedAt: string | null } }[]; warnings: { code: string; resourceId: string; message?: string }[] }
export interface FrozenItem { artifactId: string; versionId: string; revision: number; snapshotHash: string; contentHash: string; title: string; kind: ArtifactContent['kind']; options: ExportOptions; sourceRefs: SourceRef[]; resourceRefs?: ExportResourceRef[]; bindings?: FieldBinding[]; locks?: ArtifactSnapshot['locks']; planResources?: PlanExportResources; approval?: { decisionId: string; actorId: string; createdAt: string } }
export interface FrozenOutput { id: string; itemIndex: number; format: ExportFormat; fileName: string; pageId?: string }
export interface ExportInputManifest { version: 1 | 2; exporterVersion: 'tirlik-export-1' | 'tirlik-export-2'; locale: ExportLocale; historicalDraft: boolean; privateFieldsPolicy?: 'exclude-internal' | 'include-authorized'; privateFieldsPolicyHash?: string; release?: ExportRelease; createdAt: string; items: FrozenItem[]; outputs: FrozenOutput[] }
export interface StoredFile extends ExportFile { storageKey?: string }
export interface ImageAsset { bytes: Uint8Array; mediaType: string; width: number; height: number }
export interface FontAsset { bytes: Uint8Array; mediaType: string; sha256: string; family: string; subfamily: string; codePoints: number[]; noSubsetting: boolean; canEmbed: boolean }
export interface ExportAssets { image(assetId: string): Promise<ImageAsset>; font?(assetId: string): Promise<FontAsset>; design?: DesignAssetResolver; authorize?(resource: ExportResourceRef): Promise<void> }
export interface RenderedFile { bytes: Uint8Array; mediaType: string; warnings: ExportWarning[] }
export interface RenderInput { content: ArtifactContent; artifactId: string; title: string; format: ExportFormat; locale: ExportLocale; options: ExportOptions; privateFieldsPolicy: 'exclude-internal' | 'include-authorized'; historicalDraft: boolean; revision: number; createdAt: string; pageId?: string; assets: ExportAssets; signal?: AbortSignal; provenance?: Pick<FrozenItem, 'sourceRefs' | 'bindings' | 'locks'>; planResources?: PlanExportResources }
export interface ExportAdapter { kind: ArtifactContent['kind']; formats: readonly ExportFormat[]; render(input: RenderInput): Promise<RenderedFile> }
