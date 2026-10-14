export const RUN_LIMITS = Object.freeze({
  runUsd: '0.5', workspaceDayUsd: '2', deploymentDayUsd: '5', imageUsd: '0.05',
  workspaceActive: 2, deploymentActive: 8, concurrentModelBranches: 2,
  modelRequests: 12, steps: 40, modelDeadlineMs: 60_000, heavyStepDeadlineMs: 30_000,
  runDeadlineMs: 600_000, leaseMs: 90_000, pricingTtlMs: 86_400_000, streamMs: 25_000,
  contextBytes: 65_536, providerResponseBytes: 1_048_576,
});
