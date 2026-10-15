import { DesignExportError, renderDesignFiles } from '../../design-export/server/render';
import { IdentityError } from '../../identity/server/http';
import type { ExportAdapter } from './types';

export const designExportAdapter: ExportAdapter = { kind: 'design', formats: ['png', 'jpeg', 'pdf', 'tirlik'], async render(input) {
  if (input.content.kind !== 'design' || !['png', 'jpeg', 'pdf', 'tirlik'].includes(input.format) || !input.assets.design) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.formatUnavailable');
  try {
    const historicalDraftLabel = input.historicalDraft ? `${{ ru: 'Исторический черновик', kk: 'Тарихи нобай', en: 'Historical draft' }[input.locale]} · v${input.revision}` : undefined;
    const rendered = await renderDesignFiles({
      content: input.content,
      format: input.format as 'png' | 'jpeg' | 'pdf' | 'tirlik',
      title: input.title,
      locale: input.locale,
      historicalDraftLabel,
      options: { pageIds: input.pageId ? [input.pageId] : input.options.pageIds, scale: input.options.scale, transparent: input.options.transparent },
      assets: input.assets.design,
      provenance: input.provenance ? { sourceRefs: input.provenance.sourceRefs, bindings: input.provenance.bindings ?? [], locks: input.provenance.locks } : undefined,
    });
    if (rendered.files.length !== 1) throw new IdentityError('UNAVAILABLE', 'exports.errors.manifestMismatch');
    const warningMessages: Record<string, string> = {
      'text-overflow': { ru: 'Часть текста выходит за границы текстового блока макета.', kk: 'Мәтіннің бір бөлігі макеттегі мәтіндік блок шекарасынан шығады.', en: 'Some text extends beyond its design text box.' }[input.locale],
      'justify-rendered-left': { ru: 'Выравнивание текста по ширине заменено на выравнивание по левому краю.', kk: 'Мәтінді ені бойынша туралау сол жаққа туралаумен ауыстырылды.', en: 'Justified text is exported with left alignment.' }[input.locale],
      'page-rasterized-for-group-opacity': { ru: 'Для сохранения прозрачности группы страница PDF сохранена как изображение.', kk: 'Топ мөлдірлігін сақтау үшін PDF беті сурет ретінде сақталды.', en: 'The PDF page is stored as an image to preserve group transparency.' }[input.locale],
    };
    const file = rendered.files[0]!;
    return { bytes: file.bytes, mediaType: file.mediaType, warnings: file.warnings.map((warning) => { const code = warning.split(':')[0]!; return { code, targetId: warning.includes(':') ? warning.slice(warning.indexOf(':') + 1) : undefined, message: warningMessages[code] }; }) };
  } catch (error) {
    if (!(error instanceof DesignExportError)) throw error;
    throw new IdentityError('VALIDATION_FAILED', error.code === 'missing-glyph' ? 'exports.errors.fontGlyphMissing' : error.code === 'missing-font' || error.code === 'embedding-denied' ? 'exports.errors.fontUnavailable' : 'exports.errors.designAssetUnavailable');
  }
} };
