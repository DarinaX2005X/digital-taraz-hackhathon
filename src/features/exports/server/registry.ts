import { IdentityError } from '../../identity/server/http';
import type { ArtifactContent } from '../../artifacts/domain/content-models';
import type { ExportFormat } from '../contracts';
import type { ExportAdapter, RenderInput } from './types';
export class ExportRegistry {
  private adapters = new Map<ArtifactContent['kind'], ExportAdapter>();
  constructor(adapters: ExportAdapter[]) { for (const adapter of adapters) { if (this.adapters.has(adapter.kind)) throw new Error('DUPLICATE_EXPORT_ADAPTER'); this.adapters.set(adapter.kind, adapter); } }
  supports(kind: ArtifactContent['kind'], format: ExportFormat) { return this.adapters.get(kind)?.formats.includes(format) ?? false; }
  async render(input: RenderInput) { const adapter = this.adapters.get(input.content.kind); if (!adapter || !adapter.formats.includes(input.format)) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.formatUnavailable'); input.signal?.throwIfAborted(); return adapter.render(input); }
}
