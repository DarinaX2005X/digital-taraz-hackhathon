import { getMaterialHandler } from '@/features/materials/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request:Request){return getMaterialHandler()(request);}
export async function POST(request:Request){return getMaterialHandler()(request);}
