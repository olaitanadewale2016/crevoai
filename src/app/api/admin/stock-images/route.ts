import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { connectDB } from '@/lib/db';
import { getSessionContext } from '@/lib/auth';
import { StockImage } from '@/models/StockImage';
import { getNextSequence } from '@/models/Counter';
import {
  ALL_PRESET_IMAGES,
  LOCAL_STOCK_IMAGES,
  CURATED_INDUSTRY_IMAGES,
  StockImageItem,
} from '@/lib/stock-images';
import { isR2Configured, r2PutBuffer, r2DeleteObject } from '@/lib/r2';

export const dynamic = 'force-dynamic';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getSessionContext();
    if (!ctx || ctx.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const type = searchParams.get('type') || '';
    const category = searchParams.get('category') || '';
    const tone = searchParams.get('tone') || '';

    // Fetch custom uploaded images from DB
    const customDocs = await StockImage.find({}).sort({ created_at: -1 }).lean();
    const customImages: StockImageItem[] = customDocs.map((doc: any) => ({
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

    let all: StockImageItem[] = [...customImages, ...CURATED_INDUSTRY_IMAGES, ...LOCAL_STOCK_IMAGES];

    if (type && type !== 'all') {
      all = all.filter((img) => img.type === type);
    }
    if (category && category !== 'all') {
      all = all.filter(
        (img) =>
          img.category.toLowerCase().includes(category.toLowerCase()) ||
          img.categories.some((c) => c.toLowerCase().includes(category.toLowerCase()))
      );
    }
    if (tone && tone !== 'all') {
      all = all.filter((img) => img.tone.toLowerCase() === tone.toLowerCase());
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      all = all.filter(
        (img) =>
          img.subject.toLowerCase().includes(q) ||
          img.category.toLowerCase().includes(q) ||
          img.alt.toLowerCase().includes(q)
      );
    }

    const totalCount = all.length;
    const backgroundsCount = all.filter((i) => i.type === 'background').length;
    const galleryCount = all.filter((i) => i.type === 'gallery').length;
    const customCount = customImages.length;

    return NextResponse.json({
      success: true,
      images: all,
      stats: {
        total: totalCount,
        backgrounds: backgroundsCount,
        gallery: galleryCount,
        custom: customCount,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch stock images' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getSessionContext();
    if (!ctx || ctx.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const type = ((formData.get('type') as string) || 'gallery') as 'background' | 'gallery';
    const subject = ((formData.get('subject') as string) || '').trim();
    const category = ((formData.get('category') as string) || 'general').trim();
    const mood = ((formData.get('mood') as string) || '').trim();
    const tone = ((formData.get('tone') as string) || 'neutral').trim();
    const contrast = ((formData.get('contrast') as string) || 'dark-text').trim();
    const alt = ((formData.get('alt') as string) || `${subject} - professional ${category}`).trim();

    if (!file) {
      return NextResponse.json({ error: 'Image file is required' }, { status: 422 });
    }
    if (!subject) {
      return NextResponse.json({ error: 'Subject is required' }, { status: 422 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name || 'image.png') || '.png';
    const prefix = type === 'background' ? 'bg' : 'gal';
    const cleanSubject = slugify(subject);
    const cleanCategory = slugify(category);
    const filename = `${prefix}_${cleanSubject}_${cleanCategory}_${tone}_${contrast}${ext}`;
    const subdir = type === 'background' ? 'backgrounds' : 'gallery';

    // 1. Save to local public/storage/image-library/
    const targetDir = path.join(process.cwd(), 'public', 'storage', 'image-library', subdir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const localFilePath = path.join(targetDir, filename);
    fs.writeFileSync(localFilePath, buffer);

    const storageKey = `image-library/${subdir}/${filename}`;
    const publicUrl = `/storage/${storageKey}`;

    // 2. Sync to R2 if configured
    if (isR2Configured()) {
      try {
        await r2PutBuffer(storageKey, buffer, file.type || 'image/png', 'public');
      } catch (r2Err) {
        console.warn('Failed to upload stock image to R2 (local copy saved):', r2Err);
      }
    }

    // 3. Save metadata to MongoDB
    const id = await getNextSequence('stock_images');
    const categories = cleanCategory.split('-').filter(Boolean);

    const doc = await StockImage.create({
      id,
      filename,
      url: publicUrl,
      type,
      subject,
      category,
      categories,
      mood,
      tone,
      contrast,
      alt,
      is_custom: true,
    });

    return NextResponse.json({
      success: true,
      message: 'Stock image uploaded and registered successfully',
      image: doc,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to upload stock image' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getSessionContext();
    if (!ctx || ctx.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const filename = searchParams.get('filename');

    const query: any = {};
    if (id) query.id = parseInt(id, 10);
    else if (filename) query.filename = filename;
    else {
      return NextResponse.json({ error: 'Missing id or filename' }, { status: 400 });
    }

    const doc = await StockImage.findOne(query);
    if (!doc) {
      return NextResponse.json({ error: 'Stock image not found' }, { status: 404 });
    }

    // Delete from disk
    const subdir = doc.type === 'background' ? 'backgrounds' : 'gallery';
    const localPath = path.join(process.cwd(), 'public', 'storage', 'image-library', subdir, doc.filename);
    if (fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
      } catch (e) {}
    }

    // Delete from R2
    if (isR2Configured()) {
      try {
        await r2DeleteObject('public', `image-library/${subdir}/${doc.filename}`);
      } catch (e) {}
    }

    await StockImage.deleteOne({ _id: doc._id });

    return NextResponse.json({
      success: true,
      message: 'Stock image deleted successfully',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete stock image' },
      { status: 500 }
    );
  }
}
