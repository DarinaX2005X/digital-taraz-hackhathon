import type { ArtifactContent } from '../../artifacts/domain/content-models';
import type { SourceRef } from '../../../contracts/artifacts';
import type { ExportFile, ExportFormat, ExportLocale, ExportOptions, ExportWarning } from '../contracts';
export interface FrozenItem { artifactId: string; versionId: string; revision: number; snapshotHash: string; contentHash: string; title: string; kind: ArtifactContent['kind']; options: ExportOptions; sourceRefs: SourceRef[] }
export interface FrozenOutput { id: string; itemIndex: number; format: ExportFormat; fileName: string; pageId?: string }
export interface ExportInputManifest { version: 1; exporterVersion: 'tirlik-export-1'; locale: ExportLocale; historicalDraft: boolean; createdAt: string; items: FrozenItem[]; outputs: FrozenOutput[] }
export interface StoredFile extends ExportFile { storageKey?: string }
export interface ImageAsset { bytes: Uint8Array; mediaType: string; width: number; height: number }
export interface ExportAssets { image(assetId: string): Promise<ImageAsset> }
export interface RenderedFile { bytes: Uint8Array; mediaType: string; warnings: ExportWarning[] }
export interface RenderInput { content: ArtifactContent; title: string; format: ExportFormat; locale: ExportLocale; options: ExportOptions; historicalDraft: boolean; revision: number; createdAt: string; pageId?: string; assets: ExportAssets; signal?: AbortSignal }
export interface ExportAdapter { kind: ArtifactContent['kind']; formats: readonly ExportFormat[]; render(input: RenderInput): Promise<RenderedFile> }
