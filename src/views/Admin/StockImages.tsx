'use client';

import { useState, useMemo, useEffect } from 'react';
import AdminLayout from '@/Layouts/AdminLayout';
import { AdminPageHeader } from '@/components/Admin/AdminPageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Image as ImageIcon,
  Upload,
  Search,
  Sparkles,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  Layers,
  Palette,
  Eye,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/contexts/LanguageContext';
import { StockImageItem, formatImageUsageJsx } from '@/lib/stock-images';
import { User } from '@/types';

interface StockImagesProps {
  user: User;
  initialImages: StockImageItem[];
  stats: {
    total: number;
    backgrounds: number;
    gallery: number;
    custom: number;
  };
}

export default function StockImagesView({ user, initialImages, stats: initialStats }: StockImagesProps) {
  const { t } = useTranslation();
  const [images, setImages] = useState<StockImageItem[]>(initialImages || []);
  const [stats, setStats] = useState(initialStats || { total: 0, backgrounds: 0, gallery: 0, custom: 0 });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [toneFilter, setToneFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const PAGE_SIZE = 48;

  // Modals state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isLabOpen, setIsLabOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<StockImageItem | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Upload Form state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadType, setUploadType] = useState<'gallery' | 'background'>('gallery');
  const [uploadSubject, setUploadSubject] = useState('');
  const [uploadCategory, setUploadCategory] = useState('');
  const [uploadTone, setUploadTone] = useState('light');
  const [uploadContrast, setUploadContrast] = useState('dark-text');
  const [uploadMood, setUploadMood] = useState('');
  const [uploadAlt, setUploadAlt] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // AI Test Lab state
  const [labPrompt, setLabPrompt] = useState('luxury dental clinic');
  const [labResults, setLabResults] = useState<StockImageItem[]>([]);
  const [isSearchingLab, setIsSearchingLab] = useState(false);

  const fetchImages = async () => {
    try {
      const res = await fetch('/api/admin/stock-images');
      const data = await res.json();
      if (data.success) {
        setImages(data.images);
        setStats(data.stats);
      }
    } catch (err) {
      toast.error('Failed to refresh images');
    }
  };

  const filteredImages = useMemo(() => {
    return images.filter((img) => {
      if (typeFilter !== 'all' && img.type !== typeFilter) return false;
      if (toneFilter !== 'all' && img.tone.toLowerCase() !== toneFilter.toLowerCase()) return false;
      if (categoryFilter !== 'all') {
        const cat = categoryFilter.toLowerCase();
        const matchesCategory =
          img.category.toLowerCase().includes(cat) ||
          img.categories.some((c) => c.toLowerCase().includes(cat));
        if (!matchesCategory) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesSearch =
          img.subject.toLowerCase().includes(q) ||
          img.category.toLowerCase().includes(q) ||
          img.categories.some((c) => c.toLowerCase().includes(q)) ||
          img.alt.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }
      return true;
    });
  }, [images, typeFilter, toneFilter, categoryFilter, search]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, typeFilter, toneFilter, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredImages.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedImages = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredImages.slice(start, start + PAGE_SIZE);
  }, [filteredImages, safePage]);

  const handleCopy = async (text: string, identifier: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(identifier);
      toast.success(t('Copied to clipboard!'));
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (e) {
      toast.error('Failed to copy');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      const url = URL.createObjectURL(file);
      setUploadPreview(url);
      if (!uploadSubject) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ');
        setUploadSubject(nameWithoutExt);
      }
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !uploadSubject.trim()) {
      toast.error(t('Please select a file and enter a subject'));
      return;
    }

    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      fd.append('type', uploadType);
      fd.append('subject', uploadSubject.trim());
      fd.append('category', uploadCategory.trim() || 'general');
      fd.append('tone', uploadTone);
      fd.append('contrast', uploadContrast);
      fd.append('mood', uploadMood.trim());
      fd.append('alt', uploadAlt.trim());

      const res = await fetch('/api/admin/stock-images', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (data.success) {
        toast.success(t('Stock image uploaded and registered successfully!'));
        setIsUploadOpen(false);
        setUploadFile(null);
        setUploadPreview(null);
        setUploadSubject('');
        setUploadCategory('');
        fetchImages();
      } else {
        toast.error(data.error || 'Failed to upload image');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error uploading image');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteImage = async (img: StockImageItem) => {
    if (!confirm(t('Are you sure you want to remove this stock image?'))) return;

    try {
      const res = await fetch(`/api/admin/stock-images?filename=${encodeURIComponent(img.filename)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        toast.success(t('Image removed successfully'));
        fetchImages();
      } else {
        toast.error(data.error || 'Failed to delete');
      }
    } catch (err) {
      toast.error('Error removing image');
    }
  };

  const runTestLab = async () => {
    if (!labPrompt.trim()) return;
    setIsSearchingLab(true);
    try {
      const res = await fetch(`/api/images/stock?q=${encodeURIComponent(labPrompt.trim())}&format=json&limit=6`);
      const data = await res.json();
      if (data.success && data.images) {
        setLabResults(data.images);
      }
    } catch (e) {
      toast.error('Test search failed');
    } finally {
      setIsSearchingLab(false);
    }
  };

  return (
    <AdminLayout user={user} title={t('Stock Image Library')}>
      <div className="space-y-6 p-6">
        {/* Page Header */}
        <AdminPageHeader
          title={t('Stock Image Library')}
          subtitle={t(
            'Curated photography and backgrounds available to the AI builder and website projects.'
          )}
          action={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsLabOpen(true)}>
                <Sparkles className="h-4 w-4 mr-2 text-primary" />
                {t('AI Test Lab')}
              </Button>
              <Button size="sm" onClick={() => setIsUploadOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                {t('Upload Image')}
              </Button>
            </div>
          }
        />

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t('Total Stock Images')}
              </CardTitle>
              <ImageIcon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {t('Including curated & local')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t('Backgrounds')}
              </CardTitle>
              <Layers className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.backgrounds.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">{t('Hero & section textures')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t('Gallery Photography')}
              </CardTitle>
              <Palette className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.gallery.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">{t('Cards & featured photos')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t('Custom Uploads')}
              </CardTitle>
              <Upload className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.custom.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">{t('Admin managed custom files')}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters Bar */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('Search by topic, subject or category...')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                {/* Type Filter */}
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder={t('All Types')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('All Types')}</SelectItem>
                    <SelectItem value="gallery">{t('Gallery')}</SelectItem>
                    <SelectItem value="background">{t('Background')}</SelectItem>
                  </SelectContent>
                </Select>

                {/* Tone Filter */}
                <Select value={toneFilter} onValueChange={setToneFilter}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue placeholder={t('All Tones')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('All Tones')}</SelectItem>
                    <SelectItem value="light">{t('Light')}</SelectItem>
                    <SelectItem value="dark">{t('Dark')}</SelectItem>
                    <SelectItem value="warm">{t('Warm')}</SelectItem>
                    <SelectItem value="cool">{t('Cool')}</SelectItem>
                    <SelectItem value="neutral">{t('Neutral')}</SelectItem>
                  </SelectContent>
                </Select>

                {/* Category Filter */}
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder={t('All Niches')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('All Niches')}</SelectItem>
                    <SelectItem value="dentist">{t('Dentist / Medical')}</SelectItem>
                    <SelectItem value="law">{t('Law / Accounting')}</SelectItem>
                    <SelectItem value="fitness">{t('Fitness / Gym / Yoga')}</SelectItem>
                    <SelectItem value="automotive">{t('Automotive / Cars')}</SelectItem>
                    <SelectItem value="technology">{t('Tech / SaaS / AI')}</SelectItem>
                    <SelectItem value="pets">{t('Pets / Veterinary')}</SelectItem>
                    <SelectItem value="real-estate">{t('Real Estate / Interior')}</SelectItem>
                    <SelectItem value="architecture">{t('Architecture / Urban')}</SelectItem>
                    <SelectItem value="construction">{t('Construction / Trades')}</SelectItem>
                    <SelectItem value="plumbing">{t('Plumbing / Solar / HVAC')}</SelectItem>
                    <SelectItem value="beauty">{t('Beauty / Salon / Spa')}</SelectItem>
                    <SelectItem value="restaurant">{t('Restaurant / Dining')}</SelectItem>
                    <SelectItem value="coffee">{t('Coffee / Cafe / Bakery')}</SelectItem>
                    <SelectItem value="hospitality">{t('Hospitality / Wine / Bar')}</SelectItem>
                    <SelectItem value="cleaning">{t('Cleaning / Maid Services')}</SelectItem>
                    <SelectItem value="education">{t('Education / Courses')}</SelectItem>
                    <SelectItem value="photography">{t('Photography / Creative')}</SelectItem>
                    <SelectItem value="travel">{t('Travel / Hotels / Resorts')}</SelectItem>
                    <SelectItem value="fashion">{t('E-Commerce / Fashion')}</SelectItem>
                    <SelectItem value="jewelry">{t('Jewelry / Watches / Luxury')}</SelectItem>
                    <SelectItem value="finance">{t('Finance / Crypto')}</SelectItem>
                    <SelectItem value="wedding">{t('Weddings / Events / Florist')}</SelectItem>
                    <SelectItem value="music">{t('Music / Podcast / Audio')}</SelectItem>
                    <SelectItem value="gaming">{t('Gaming / Esports')}</SelectItem>
                    <SelectItem value="nonprofit">{t('Nonprofit / Green Energy')}</SelectItem>
                    <SelectItem value="agriculture">{t('Agriculture / Farms / Organic')}</SelectItem>
                    <SelectItem value="logistics">{t('Logistics / Shipping')}</SelectItem>
                    <SelectItem value="manufacturing">{t('Manufacturing / Industrial')}</SelectItem>
                    <SelectItem value="coworking">{t('Coworking / Business')}</SelectItem>
                    <SelectItem value="avatar">{t('Portraits / Avatars')}</SelectItem>
                    <SelectItem value="abstract">{t('Abstract / Textures')}</SelectItem>
                    <SelectItem value="nature">{t('Nature / Landscapes')}</SelectItem>
                  </SelectContent>
                </Select>

                <Button variant="ghost" size="icon" onClick={fetchImages} title={t('Refresh')}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results Summary & Top Pagination */}
        {filteredImages.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
            <p>
              {t('Showing')}{' '}
              <span className="font-medium text-foreground">
                {((safePage - 1) * PAGE_SIZE + 1).toLocaleString()}–
                {Math.min(safePage * PAGE_SIZE, filteredImages.length).toLocaleString()}
              </span>{' '}
              {t('of')}{' '}
              <span className="font-medium text-foreground">
                {filteredImages.length.toLocaleString()}
              </span>{' '}
              {t('images')}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  {t('Previous')}
                </Button>
                <span className="text-xs font-medium px-2">
                  {t('Page')} {safePage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                >
                  {t('Next')}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Images Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {paginatedImages.map((img) => (
            <Card
              key={img.filename + img.url}
              className="overflow-hidden group hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              <div>
                <div className="relative aspect-video bg-muted overflow-hidden">
                  <img
                    src={img.url}
                    alt={img.alt}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute top-2 left-2 flex gap-1">
                    <Badge variant={img.type === 'background' ? 'secondary' : 'default'} className="text-[10px] uppercase font-semibold">
                      {img.type}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] bg-background/80 backdrop-blur-sm">
                      {img.source}
                    </Badge>
                  </div>
                  <div className="absolute top-2 right-2 flex gap-1">
                    <Badge variant="secondary" className="text-[10px] bg-background/80 backdrop-blur-sm capitalize">
                      {img.tone}
                    </Badge>
                  </div>
                </div>

                <div className="p-4 space-y-1.5">
                  <h4 className="font-semibold text-sm line-clamp-1 capitalize" title={img.subject}>
                    {img.subject}
                  </h4>
                  <p className="text-xs text-muted-foreground line-clamp-1 capitalize">
                    {t('Category')}: <span className="font-medium text-foreground">{img.category}</span>
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-2" title={img.alt}>
                    {img.alt}
                  </p>
                </div>
              </div>

              <div className="p-4 pt-0 border-t mt-3 flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => setSelectedImage(img)}
                >
                  <Eye className="h-3.5 w-3.5 mr-1" />
                  {t('Details')}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleCopy(img.url, img.filename)}
                  title={t('Copy URL')}
                >
                  {copiedUrl === img.filename ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                {img.source === 'custom' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDeleteImage(img)}
                    title={t('Delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>

        {/* Bottom Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentPage(1);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              disabled={safePage <= 1}
            >
              {t('First')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentPage((p) => Math.max(1, p - 1));
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              disabled={safePage <= 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              {t('Previous')}
            </Button>
            <span className="text-sm text-muted-foreground px-3">
              {t('Page')} <span className="font-medium text-foreground">{safePage}</span> {t('of')}{' '}
              <span className="font-medium text-foreground">{totalPages}</span>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentPage((p) => Math.min(totalPages, p + 1));
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              disabled={safePage >= totalPages}
            >
              {t('Next')}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentPage(totalPages);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              disabled={safePage >= totalPages}
            >
              {t('Last')}
            </Button>
          </div>
        )}

        {filteredImages.length === 0 && (
          <div className="text-center py-16 border rounded-2xl bg-muted/20">
            <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground/60 mb-3" />
            <h3 className="text-lg font-semibold">{t('No stock images found')}</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              {t('Try adjusting your search filters or upload custom photos for this niche.')}
            </p>
          </div>
        )}

        {/* Upload Stock Image Dialog */}
        <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('Upload Stock Image')}</DialogTitle>
              <DialogDescription>
                {t('Add a new high-resolution photo or background texture to the platform library.')}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              {/* File upload */}
              <div className="space-y-2">
                <Label>{t('Image File (PNG, JPG, WebP)')}</Label>
                <Input type="file" accept="image/*" onChange={handleFileChange} required />
                {uploadPreview && (
                  <div className="relative aspect-video rounded-lg overflow-hidden border mt-2">
                    <img src={uploadPreview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('Type')}</Label>
                  <Select value={uploadType} onValueChange={(v: any) => setUploadType(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gallery">{t('Gallery / Card')}</SelectItem>
                      <SelectItem value="background">{t('Background Texture')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>{t('Tone')}</Label>
                  <Select value={uploadTone} onValueChange={setUploadTone}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">{t('Light')}</SelectItem>
                      <SelectItem value="dark">{t('Dark')}</SelectItem>
                      <SelectItem value="warm">{t('Warm')}</SelectItem>
                      <SelectItem value="cool">{t('Cool')}</SelectItem>
                      <SelectItem value="neutral">{t('Neutral')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{t('Subject (e.g. Modern Dental Clinic)')}</Label>
                <Input
                  value={uploadSubject}
                  onChange={(e) => setUploadSubject(e.target.value)}
                  placeholder={t('e.g. Luxury Car Detailing')}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('Category')}</Label>
                  <Input
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value)}
                    placeholder={t('e.g. automotive')}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('Text Contrast')}</Label>
                  <Select value={uploadContrast} onValueChange={setUploadContrast}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dark-text">{t('Dark Text (Light BG)')}</SelectItem>
                      <SelectItem value="light-text">{t('Light Text (Dark BG)')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{t('Alt Text Suggestion')}</Label>
                <Input
                  value={uploadAlt}
                  onChange={(e) => setUploadAlt(e.target.value)}
                  placeholder={t('Descriptive alt text for accessibility')}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsUploadOpen(false)}>
                  {t('Cancel')}
                </Button>
                <Button type="submit" disabled={isUploading}>
                  {isUploading ? t('Uploading...') : t('Save to Library')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Image Details & JSX Snippet Dialog */}
        <Dialog open={Boolean(selectedImage)} onOpenChange={(open) => !open && setSelectedImage(null)}>
          <DialogContent className="max-w-xl">
            {selectedImage && (
              <>
                <DialogHeader>
                  <DialogTitle className="capitalize">{selectedImage.subject}</DialogTitle>
                  <DialogDescription>
                    {t('Ready-to-use code snippets and metadata for website generation.')}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="relative aspect-video rounded-xl overflow-hidden border">
                    <img src={selectedImage.url} alt={selectedImage.alt} className="w-full h-full object-cover" />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-muted">
                      <span className="text-muted-foreground block">{t('Type')}</span>
                      <span className="font-semibold uppercase">{selectedImage.type}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-muted">
                      <span className="text-muted-foreground block">{t('Category')}</span>
                      <span className="font-semibold capitalize">{selectedImage.category}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-muted">
                      <span className="text-muted-foreground block">{t('Tone')}</span>
                      <span className="font-semibold capitalize">{selectedImage.tone}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-muted">
                      <span className="text-muted-foreground block">{t('Contrast')}</span>
                      <span className="font-semibold capitalize">{selectedImage.contrast}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">{t('Direct Image URL')}</Label>
                    <div className="flex gap-2">
                      <Input readOnly value={selectedImage.url} className="text-xs font-mono" />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopy(selectedImage.url, 'modal-url')}
                      >
                        {copiedUrl === 'modal-url' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">{t('Recommended JSX Code')}</Label>
                    <pre className="p-3 bg-muted rounded-xl text-xs font-mono overflow-x-auto whitespace-pre-wrap text-foreground/90 max-h-48">
                      {formatImageUsageJsx(selectedImage)}
                    </pre>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => handleCopy(formatImageUsageJsx(selectedImage), 'modal-jsx')}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    {t('Copy JSX Snippet')}
                  </Button>
                  <Button onClick={() => setSelectedImage(null)}>{t('Close')}</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* AI Test Lab Modal */}
        <Dialog open={isLabOpen} onOpenChange={setIsLabOpen}>
          <DialogContent className="max-w-2xl max-h-[calc(var(--vvh,100dvh)-1.5rem)] sm:max-h-[min(85dvh,calc(var(--vvh,100dvh)-2rem))] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                {t('AI Image Test Lab')}
              </DialogTitle>
              <DialogDescription>
                {t('Type any customer website prompt or niche to see exactly how the AI builder retrieves images.')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={labPrompt}
                  onChange={(e) => setLabPrompt(e.target.value)}
                  placeholder={t('e.g. luxury dental clinic, auto repair garage, pet grooming')}
                  onKeyDown={(e) => e.key === 'Enter' && runTestLab()}
                />
                <Button onClick={runTestLab} disabled={isSearchingLab}>
                  {isSearchingLab ? <RefreshCw className="h-4 w-4 animate-spin" /> : t('Test AI Query')}
                </Button>
              </div>

              {labResults.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('Retrieved Photography for')} &quot;{labPrompt}&quot; ({labResults.length})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {labResults.map((img) => (
                      <div key={img.url} className="border rounded-xl p-3 bg-muted/30 space-y-2">
                        <div className="aspect-video rounded-lg overflow-hidden border">
                          <img src={img.url} alt={img.alt} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold truncate">{img.subject}</span>
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {img.source}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-1">{img.alt}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button onClick={() => setIsLabOpen(false)}>{t('Close')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
