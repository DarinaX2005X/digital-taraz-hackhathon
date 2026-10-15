import { getDesignImportHandler } from '@/features/design-export/server';
export const runtime='nodejs';
export async function POST(request:Request){return getDesignImportHandler()(request);}
