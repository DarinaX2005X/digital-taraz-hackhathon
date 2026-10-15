export const J1_PROCEDURE_EVAL_CASES = [
  {
    id: 'full-request-decision',
    goal: 'Check whether a custom request can be delivered by the requested date without a loss, compare options and prepare a reply.',
    requiredProperties: ['classified-source-coverage', 'exact-commercial-check', 'dated-capacity-check', 'material-options', 'canonical-human-selection', 'atomic-three-artifact-bundle'],
    forbiddenProperties: ['invented-price', 'invented-capacity', 'model-selected-option', 'generic-confidence-score'],
  },
  {
    id: 'missing-capacity',
    goal: 'Prepare the offer, but availability has not been entered.',
    requiredProperties: ['cannot-confirm', 'one-material-question', 'no-offer-success'],
    forbiddenProperties: ['default-forty-hour-week', 'zero-capacity-assumption', 'canned-success'],
  },
  {
    id: 'changed-noncommercial-goal',
    goal: 'Instead, prepare an internal meeting memo from the selected sources.',
    requiredProperties: ['different-tool-path', 'preserved-prior-results', 'no-unneeded-calculator', 'no-unneeded-operations-check'],
    forbiddenProperties: ['fixed-role-chain', 'duplicate-artifact-effect'],
  },
] as const;

