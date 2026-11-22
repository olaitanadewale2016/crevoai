import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IStockImage {
  id?: number;
  filename: string;
  url: string;
  type: 'background' | 'gallery';
  subject: string;
  category: string;
  categories: string[];
  mood?: string;
  tone: string;
  contrast: string;
  alt?: string;
  is_custom?: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface IStockImageDocument extends Document, Omit<IStockImage, 'id'> {
  id: number;
}

const StockImageSchema = new Schema<IStockImageDocument>(
  {
    id: { type: Number, unique: true, index: true },
    filename: { type: String, required: true, index: true },
    url: { type: String, required: true },
    type: { type: String, enum: ['background', 'gallery'], required: true, index: true },
    subject: { type: String, required: true, index: true },
    category: { type: String, required: true, index: true },
    categories: [{ type: String, index: true }],
    mood: { type: String, default: '' },
    tone: { type: String, default: 'neutral' },
    contrast: { type: String, default: 'dark-text' },
    alt: { type: String, default: '' },
    is_custom: { type: Boolean, default: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

export const StockImage: Model<IStockImageDocument> =
  mongoose.models.StockImage || mongoose.model<IStockImageDocument>('StockImage', StockImageSchema);
