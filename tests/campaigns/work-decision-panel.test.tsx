import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { RunWorkDecision } from '@/contracts/runs';
import { WorkDecisionPanel } from '@/features/campaigns/ui/work-decision-panel';

const decision: RunWorkDecision = {
  id: 'campaign-direction',
  requiresConsent: true,
  selectedOptionId: null,
  options: [
    { id: 'editorial', label: 'Главное сообщение', artifactIds: ['8bfa7e2f-03d4-42a2-b1fc-b66eb7d8ff85'] },
    { id: 'split', label: 'Условия в фокусе', artifactIds: ['10d0556b-82bd-4d77-8052-37a13d7a2492'] },
  ],
};

describe('WorkDecisionPanel', () => {
  it('keeps both editable campaign directions visible with their durable result links', () => {
    const html = renderToStaticMarkup(<WorkDecisionPanel
      decision={decision}
      locale="ru"
      canChoose
      pending={false}
      resultHrefs={{
        '8bfa7e2f-03d4-42a2-b1fc-b66eb7d8ff85': { href: '/app/artifacts/8bfa7e2f-03d4-42a2-b1fc-b66eb7d8ff85', title: 'Открыть первый макет' },
        '10d0556b-82bd-4d77-8052-37a13d7a2492': { href: '/app/artifacts/10d0556b-82bd-4d77-8052-37a13d7a2492' },
      }}
      onChoose={vi.fn()}
    />);

    expect(html).toContain('Какой вариант развивать дальше?');
    expect(html).toContain('Главное сообщение');
    expect(html).toContain('Условия в фокусе');
    expect(html).toContain('/app/artifacts/8bfa7e2f-03d4-42a2-b1fc-b66eb7d8ff85');
    expect(html).toContain('Выбрать направление');
  });

  it('shows the persisted selection and removes its choice action', () => {
    const selected = { ...decision, selectedOptionId: 'editorial' } satisfies RunWorkDecision;
    const html = renderToStaticMarkup(<WorkDecisionPanel decision={selected} locale="en" canChoose pending={false} resultHrefs={{}} onChoose={vi.fn()} />);

    expect(html).toContain('Selected');
    expect(html).toContain('data-selected="true"');
    expect((html.match(/Choose direction/g) ?? [])).toHaveLength(1);
  });
});
