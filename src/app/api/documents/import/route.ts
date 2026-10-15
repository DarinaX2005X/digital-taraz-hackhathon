import { getDocumentImportHandler } from '@/features/documents/server';

export const runtime = 'nodejs';
export async function POST(request: Request) { return getDocumentImportHandler()(request); }
