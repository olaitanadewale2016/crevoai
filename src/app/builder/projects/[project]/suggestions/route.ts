import { NextRequest, NextResponse } from 'next/server';
import { GET as getProjectSuggestions } from '@/app/project/[project]/suggestions/route';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  return getProjectSuggestions(req, props);
}
