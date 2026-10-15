export const businessDecisionMessageKeys = [
  'business.decision.loss',
  'business.decision.marginBelowRule',
  'business.decision.deadlineConflict',
  'business.decision.genericReason',
  'business.decision.genericCondition',
] as const;
export type BusinessDecisionMessageKey = typeof businessDecisionMessageKeys[number];

export const businessDecisionCopy: Record<'ru' | 'kk' | 'en', Record<BusinessDecisionMessageKey, string>> = {
  ru: {
    'business.decision.loss': 'Цена ниже известных прямых затрат.',
    'business.decision.marginBelowRule': 'Расчётная маржа ниже подтверждённого правила.',
    'business.decision.deadlineConflict': 'Запрошенный срок конфликтует с проверенной доступностью.',
    'business.decision.genericReason': 'Есть проверенная причина, из-за которой решение пока нельзя подтвердить.',
    'business.decision.genericCondition': 'Вариант возможен только при явно указанном условии.',
  },
  kk: {
    'business.decision.loss': 'Баға белгілі тікелей шығындардан төмен.',
    'business.decision.marginBelowRule': 'Есептелген маржа расталған талаптан төмен.',
    'business.decision.deadlineConflict': 'Сұралған мерзім тексерілген қолжетімділікпен қайшы келеді.',
    'business.decision.genericReason': 'Шешімді әзірге растауға мүмкіндік бермейтін тексерілген себеп бар.',
    'business.decision.genericCondition': 'Нұсқа тек нақты көрсетілген шартпен мүмкін.',
  },
  en: {
    'business.decision.loss': 'The price is below the known direct costs.',
    'business.decision.marginBelowRule': 'The calculated margin is below the evidenced rule.',
    'business.decision.deadlineConflict': 'The requested deadline conflicts with checked availability.',
    'business.decision.genericReason': 'A checked reason prevents the decision from being confirmed yet.',
    'business.decision.genericCondition': 'The option is feasible only under an explicitly named condition.',
  },
};

/** Arbitrary model/domain codes always collapse to a finite safe fallback key. */
export function decisionFactorMessageKey(kind: 'reason' | 'condition', code: string): BusinessDecisionMessageKey {
  if (code === 'loss') return 'business.decision.loss';
  if (code === 'margin_below_rule') return 'business.decision.marginBelowRule';
  if (code === 'deadline_conflict') return 'business.decision.deadlineConflict';
  return kind === 'reason' ? 'business.decision.genericReason' : 'business.decision.genericCondition';
}

