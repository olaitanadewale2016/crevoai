import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { StockImage } from '@/models/StockImage';
import { searchStockImages, StockImageItem } from '@/lib/stock-images';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || searchParams.get('query') || '';
    const category = searchParams.get('category') || '';
    const type = (searchParams.get('type') as 'background' | 'gallery') || undefined;
    const mood = searchParams.get('mood') || '';
    const tone = searchParams.get('tone') || '';
    const format = searchParams.get('format') || '';
    const limit = Math.min(30, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));

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
      customImages,
      baseUrl,
    });

    const isJsonRequest =
      format === 'json' ||
      req.headers.get('accept')?.includes('application/json');

    if (isJsonRequest) {
      return NextResponse.json({
        success: true,
        query: query || category || 'all',
        count: results.length,
        images: results,
      });
    }

    // Direct Image Request mode (<img src="/api/images/stock?q=..." />)
    if (results.length > 0) {
      const selected = results[0];
      const targetUrl = selected.url.startsWith('/') ? `${baseUrl}${selected.url}` : selected.url;
      return NextResponse.redirect(new URL(targetUrl, req.url), 307);
    }

    // Fallback default image redirect
    return NextResponse.redirect(
      new URL(
        'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
        req.url
      ),
      307
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to search stock images' },
      { status: 500 }
    );
  }
}
