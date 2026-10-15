import type { SourceRef, FieldBinding } from '@/contracts/artifacts';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import type { DesignContent } from '@/features/designs/domain/model';
import type { Locale } from '@/i18n/locales';

export type DesignAsset = { bytes: Uint8Array; sha256: string; mediaType: string; license: { name: string; embeddingAllowed: boolean }; noSubsetting?: boolean };
export type DesignAssetResolver = {
  image(assetId: string, purpose: 'display' | 'embed'): Promise<DesignAsset>;
  font(assetId: string, purpose: 'display' | 'embed'): Promise<DesignAsset>;
};
export type DesignProvenance = { sourceRefs: SourceRef[]; bindings: FieldBinding[]; locks?: ArtifactSnapshot['locks'] };
export type DesignExportInput = {
  content: DesignContent; format: 'png' | 'jpeg' | 'pdf' | 'tirlik'; title: string; locale: Locale;
  options?: { pageIds?: string[]; scale?: number; transparent?: boolean };
  assets: DesignAssetResolver; provenance?: DesignProvenance; historicalDraftLabel?: string;
};
export type DesignExportFile = { name: string; bytes: Uint8Array; mediaType: string; extension: string; warnings: string[] };
export class DesignExportError extends Error {
  constructor(readonly code: 'invalid-design' | 'unsafe-style' | 'too-large' | 'missing-asset' | 'missing-font' | 'missing-glyph' | 'embedding-denied' | 'invalid-package' | 'hash-mismatch' | 'external-references', readonly layerId?: string, readonly detail?: string) { super(`design-export.${code}${layerId ? `:${layerId}` : ''}`); }
}

export function historicalDraftLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const label = value.trim();
  if (!label || label.length > 300 || /\p{Cc}/u.test(label)) throw new DesignExportError('invalid-design');
  return label;
}
