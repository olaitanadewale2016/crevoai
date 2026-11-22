import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { StockImage } from '@/models/StockImage';
import { searchStockImages, StockImageItem } from '@/lib/stock-images';

export const dynamic = 'force-dynamic';

const DIRECT_FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1200&q=80',
];

function computeSeedHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || searchParams.get('query') || '';
    const category = searchParams.get('category') || '';
    const type = (searchParams.get('type') as 'background' | 'gallery') || undefined;
    const mood = searchParams.get('mood') || '';
    const tone = searchParams.get('tone') || '';
    const format = searchParams.get('format') || '';
    const seed = searchParams.get('seed') || '';
    const idxParam = searchParams.get('index') ?? searchParams.get('offset');
    const explicitIndex =
      idxParam !== null && !Number.isNaN(Number(idxParam))
        ? Math.abs(parseInt(idxParam, 10))
        : undefined;
    const isJsonRequest =
      format === 'json' ||
      Boolean(req.headers.get('accept')?.includes('application/json'));
    const rawLimit = searchParams.get('limit');
    const limit = Math.min(
      30,
      Math.max(1, parseInt(rawLimit || (isJsonRequest ? '10' : '12'), 10))
    );

    // Fetch custom stock images uploaded by admin from DB if available
    let customImages: StockImageItem[] = [];
    try {
      await connectDB();
      const customDbImages = await StockImage.find({}).lean();
      if (customDbImages && customDbImages.length > 0) {
        customImages = customDbImages.map((doc: any) => ({
          filename: doc.filename,
          url: doc.url,
          type: doc.type,
          subject: doc.subject,
          category: doc.category,
          categories: doc.categories || [doc.category],
          mood: doc.mood,
          tone: doc.tone,
          contrast: doc.contrast,
          alt: doc.alt || doc.subject,
          source: 'custom',
        }));
      }
    } catch (dbErr) {
      // Non-blocking: proceed with curated and local stock images
    }

    const host = req.headers.get('host') || 'localhost:3000';
    const proto = req.headers.get('x-forwarded-proto') || 'http';
    const baseUrl = `${proto}://${host}`;

    const results = searchStockImages({
      query,
      category,
      type,
      mood,
      tone,
      limit,
      index: explicitIndex,
      seed,
      customImages,
      baseUrl,
    });

    if (isJsonRequest) {
      return NextResponse.json({
        success: true,
        query: query || category || 'all',
        count: results.length,
        images: results,
      });
    }

    const selectionSeed = `${query}|${category}|${type || ''}|${mood}|${tone}|${seed}`;
    const slotIndex =
      explicitIndex !== undefined ? explicitIndex : computeSeedHash(selectionSeed);

    // Direct Image Request mode (<img src="/api/images/stock?q=..." />)
    if (results.length > 0) {
      const selected = results[slotIndex % results.length];
      const targetUrl = selected.url.startsWith('/') ? `${baseUrl}${selected.url}` : selected.url;
      return NextResponse.redirect(new URL(targetUrl, req.url), 307);
    }

    // Fallback default image redirect (spread across diverse pool by query/index)
    const fallbackUrl = DIRECT_FALLBACK_IMAGES[slotIndex % DIRECT_FALLBACK_IMAGES.length];
    return NextResponse.redirect(new URL(fallbackUrl, req.url), 307);
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to search stock images' },
      { status: 500 }
    );
  }
}
