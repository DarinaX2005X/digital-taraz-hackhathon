import 'server-only';

import {
  BuildCampaignWorkInputSchema,
  BusinessWorkResultSchema,
  type BusinessWorkToolDescriptor,
  type BuildCampaignWorkInput,
} from '@/contracts/business-work';

import { buildCampaignWork, createCampaignWorkService, type CampaignWorkDependencies } from './build-campaign-work';

const descriptor = (execute: BusinessWorkToolDescriptor<BuildCampaignWorkInput>['execute']): BusinessWorkToolDescriptor<BuildCampaignWorkInput> => ({
  name: 'campaign.build-work',
  version: 1,
  purpose: 'Build two evidence-bound editable campaign directions, their source brief, and an optional checked work plan. The operation does not publish or claim advertising results.',
  inputSchema: BuildCampaignWorkInputSchema,
  outputSchema: BusinessWorkResultSchema,
  policy: 'edit',
  costClass: 'local',
  deadlineMs: 30_000,
  idempotency: 'operation-receipt',
  execute,
});

export function createCampaignWorkToolDescriptor(dependencies: CampaignWorkDependencies): BusinessWorkToolDescriptor<BuildCampaignWorkInput> {
  return descriptor(createCampaignWorkService(dependencies));
}

export const campaignWorkToolDescriptor = descriptor(buildCampaignWork);

