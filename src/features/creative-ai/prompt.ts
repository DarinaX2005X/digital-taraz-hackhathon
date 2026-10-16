import type { Locale } from '@/contracts/primitives';

export const CREATIVE_PROCEDURE_VERSION = 'campaign-creative-v1';

export function campaignCreativePrompt(input: {
  brief: string;
  locales: readonly Locale[];
  conditions: readonly { id: string; kind: string; value: unknown }[];
  hasUsableImage: boolean;
}) {
  return `You prepare structured, editable campaign directions for people working inside a business.

Return only the campaign_proposals tool call. Produce two materially different directions. They must differ in hierarchy and composition, not merely adjectives or colours. Each direction needs complete copy for exactly these locales: ${input.locales.join(', ')}.

Rules:
- Use the brief as intent, not as evidence for a discount, price, inventory, testimonial, partner, deadline, outcome, or advertising uplift.
- A factual claim must list one or more exact conditionIds from the supplied condition list. Never cite an ID that is absent.
- Preserve every number, currency, unit, and calendar date exactly. Do not calculate a discount or convert currency.
- If evidence is incomplete, keep the copy useful and add a concise warning. Unknown is not zero.
- Do not promise publication, delivery, sales growth, reach, or availability.
- Write natural Kazakh, Russian, and English. Do not transliterate. Avoid generic AI language, hype, and fake urgency.
- Headline, body, and call to action remain separate editable layers. Keep within the declared length limits.
- ${input.hasUsableImage ? 'A selected owned/licensed image is available.' : 'No usable image is available. Set imageRole to none and make the composition work without one.'}

Brief:
${input.brief}

Authorized conditions:
${JSON.stringify(input.conditions)}`;
}

