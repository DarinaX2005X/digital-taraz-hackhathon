import { describe, expect, it } from 'vitest';

import { composeCampaignVariants } from '@/features/campaigns/domain/compose-campaign';
import { renderDesignFiles } from '@/features/design-export/server/render';
import { parseDesignPackage } from '@/features/design-export/server/package';

const sourceRef = { sourceId: '650148d1-8cdd-4eca-8b1c-63553c23c6ca', sourceVersionId: '056f7ebd-9d07-4a65-a9e2-45658fb66cf6', revision: 2 };
const assets = { image: async () => { throw new Error('unexpected image'); }, font: async () => { throw new Error('unexpected font'); } };

describe('campaign release files', () => {
  it('renders the selected multilingual layered revision to PNG, JPEG, PDF and portable editable project bytes', async () => {
    const [variant] = composeCampaignVariants({
      brief: 'Собственные условия кампании · Науқанның өз шарттары',
      assetRefs: [],
      conditions: [
        { id: 'price', kind: 'price', value: { currency: 'KZT', minorUnits: '1499000' }, sourceRef },
        { id: 'date', kind: 'date', value: '2026-12-20', sourceRef },
      ],
      formats: [
        { id: 'square-ru', width: 1080, height: 1080, unit: 'px', locale: 'ru' },
        { id: 'story-kk', width: 1080, height: 1920, unit: 'px', locale: 'kk' },
      ],
    });
    const input = { content: variant!.content, title: 'Кампания желтоқсан', locale: 'kk' as const, assets, provenance: { sourceRefs: [sourceRef], bindings: variant!.bindings } };
    const png = await renderDesignFiles({ ...input, format: 'png', options: { transparent: true, scale: 1 } });
    const jpeg = await renderDesignFiles({ ...input, format: 'jpeg', options: { pageIds: [variant!.content.pages[0]!.id], scale: 1 } });
    const pdf = await renderDesignFiles({ ...input, format: 'pdf' });
    const editable = await renderDesignFiles({ ...input, format: 'tirlik' });
    expect(png.files).toHaveLength(2);
    expect(Buffer.from(png.files[0]!.bytes).subarray(1, 4).toString()).toBe('PNG');
    expect(Buffer.from(jpeg.files[0]!.bytes).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(Buffer.from(pdf.files[0]!.bytes).subarray(0, 4).toString()).toBe('%PDF');
    const parsed = await parseDesignPackage(editable.files[0]!.bytes);
    expect(parsed.content).toEqual(variant!.content);
    expect(parsed.provenance.bindings).toEqual(variant!.bindings);
    expect(parsed.manifest.locale).toBe('kk');
  });
});

