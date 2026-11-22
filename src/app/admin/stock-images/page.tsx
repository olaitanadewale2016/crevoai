import { redirect } from 'next/navigation';
import { connectDB } from '@/lib/db';
import { getSessionContext, serializeUser } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { StockImage } from '@/models/StockImage';
import StockImagesView from '@/Pages/Admin/StockImages';
import {
  ALL_PRESET_IMAGES,
  LOCAL_STOCK_IMAGES,
  CURATED_INDUSTRY_IMAGES,
  StockImageItem,
} from '@/lib/stock-images';

export const dynamic = 'force-dynamic';

export default async function AdminStockImagesPage() {
  const ctx = await getSessionContext();
  if (!ctx || ctx.user.role !== 'admin') {
    redirect('/login');
  }

  const sharedProps = await getSharedAppProps();

  let customImages: StockImageItem[] = [];
  try {
    await connectDB();
    const customDocs = await StockImage.find({}).sort({ created_at: -1 }).lean();
    customImages = customDocs.map((doc: any) => ({
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
      source: 'custom' as const,
    }));
  } catch (err) {
    console.error('Error fetching custom stock images:', err);
  }

  const allImages: StockImageItem[] = [
    ...customImages,
    ...CURATED_INDUSTRY_IMAGES,
    ...LOCAL_STOCK_IMAGES,
  ];

  const stats = {
    total: allImages.length,
    backgrounds: allImages.filter((i) => i.type === 'background').length,
    gallery: allImages.filter((i) => i.type === 'gallery').length,
    custom: customImages.length,
  };

  return (
    <StockImagesView
      {...(sharedProps as any)}
      user={serializeUser(ctx.user) as any}
      initialImages={allImages}
      stats={stats}
    />
  );
}
