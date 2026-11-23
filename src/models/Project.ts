import mongoose, { Schema, Model } from 'mongoose';
import { generateUuidV7, generateHexToken } from '@/lib/crypto';

export interface IConversationEntry {
  role: 'user' | 'assistant' | 'action' | 'system';
  content: string;
  timestamp?: string;
  created_at?: string | Date;
  category?: string;
  thinking_duration?: number;
  files?: Array<{
    id?: string;
    filename: string;
    original_filename?: string;
    mime_type?: string;
    size?: number;
    url?: string;
  }>;
}

export interface ICompactedEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// 1. Project (UUIDv7 _id string! SoftDeletes via deleted_at!)
export interface IProject {
  _id: string; // UUIDv7 string — matches Go Builder workspace_id, R2 prefixes, Firestore prefix
  user_id: mongoose.Types.ObjectId;
  template_id: mongoose.Types.ObjectId | null;
  name: string;
  description: string | null;
  initial_prompt: string | null;
  initial_file_ids?: string[];
  thumbnail: string | null; // Public R2 key: thumbnails/{project_id}.png
  is_public: boolean;
  is_starred: boolean;
  subdomain: string | null;
  custom_domain: string | null;
  custom_domain_verified: boolean;
  custom_domain_ssl_status: 'pending' | 'active' | 'failed' | null;
  custom_domain_verified_at: Date | null;
  published_title: string | null;
  published_description: string | null;
  published_visibility: 'public' | 'private';
  share_image: string | null; // Public R2 key: share-images/...
  published_at: Date | null;
  custom_instructions: string | null;
  theme_preset: string | null;
  reasoning_effort?: 'low' | 'medium' | 'high';
  api_token: string | null;
  firebase_config: string | null; // AES-256-GCM encrypted JSON
  uses_system_firebase: boolean;
  firebase_admin_service_account: string | null; // AES-256-GCM encrypted JSON
  supabase_config?: string | null; // AES-256-GCM encrypted JSON { url, anonKey }
  storage_used_bytes: number;
  last_viewed_at: Date | null;
  builder_id: mongoose.Types.ObjectId | null;
  build_session_id: string | null;
  build_status: 'idle' | 'pending' | 'building' | 'completed' | 'failed' | 'cancelled' | null;
  build_path: string | null; // Private R2 key: builds/{project_id}/{build_id}.zip
  active_build_id: string | null; // R2 atomic prefix: sites/{project_id}/{active_build_id}/
  last_billed_session_tokens: number; // Safeguard for Go Builder cumulative tokens_used on reused sessions
  build_started_at: Date | null;
  build_completed_at: Date | null;
  conversation_history: IConversationEntry[];
  compacted_history: ICompactedEntry[] | null;
  estimated_tokens: number;
  history_version: number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    _id: { type: String, default: () => generateUuidV7() },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    template_id: { type: Schema.Types.ObjectId, ref: 'Template', default: null },
    name: { type: String, required: true, maxlength: 255 },
    description: { type: String, default: null },
    initial_prompt: { type: String, default: null },
    initial_file_ids: { type: [String], default: [] },
    thumbnail: { type: String, default: null },
    is_public: { type: Boolean, default: false },
    is_starred: { type: Boolean, default: false },
    subdomain: { type: String, default: null, maxlength: 63 },
    custom_domain: { type: String, default: null, maxlength: 255 },
    custom_domain_verified: { type: Boolean, default: false },
    custom_domain_ssl_status: {
      type: String,
      enum: ['pending', 'active', 'failed', null],
      default: null,
    },
    custom_domain_verified_at: { type: Date, default: null },
    published_title: { type: String, default: null, maxlength: 255 },
    published_description: { type: String, default: null, maxlength: 150 },
    published_visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    share_image: { type: String, default: null },
    published_at: { type: Date, default: null, index: true },
    custom_instructions: { type: String, default: null, maxlength: 500 },
    theme_preset: { type: String, default: null, maxlength: 50 },
    reasoning_effort: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    api_token: { type: String, default: () => generateHexToken(32), index: true },
    firebase_config: { type: String, default: null },
    uses_system_firebase: { type: Boolean, default: true },
    firebase_admin_service_account: { type: String, default: null },
    supabase_config: { type: String, default: null },
    storage_used_bytes: { type: Number, default: 0 },
    last_viewed_at: { type: Date, default: null },
    builder_id: { type: Schema.Types.ObjectId, ref: 'Builder', default: null },
    build_session_id: { type: String, default: null, index: true },
    build_status: {
      type: String,
      enum: ['idle', 'pending', 'building', 'completed', 'failed', 'cancelled', null],
      default: null,
    },
    build_path: { type: String, default: null },
    active_build_id: { type: String, default: null },
    last_billed_session_tokens: { type: Number, default: 0 },
    build_started_at: { type: Date, default: null },
    build_completed_at: { type: Date, default: null },
    conversation_history: { type: [Schema.Types.Mixed] as any, default: [] },
    compacted_history: { type: [Schema.Types.Mixed] as any, default: null },
    estimated_tokens: { type: Number, default: 0 },
    history_version: { type: Number, default: 0 },
    deleted_at: { type: Date, default: null, index: true },
  },
  {
    collection: 'projects',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Partial unique indexes for nullable unique fields
ProjectSchema.index(
  { subdomain: 1 },
  { unique: true, partialFilterExpression: { subdomain: { $type: 'string' } } }
);
ProjectSchema.index(
  { custom_domain: 1 },
  { unique: true, partialFilterExpression: { custom_domain: { $type: 'string' } } }
);
ProjectSchema.index({ user_id: 1, deleted_at: 1, last_viewed_at: -1 });
ProjectSchema.index({ user_id: 1, build_status: 1 });

export const Project: Model<IProject> =
  mongoose.models.Project || mongoose.model<IProject>('Project', ProjectSchema);

// 2. ProjectShare
export interface IProjectShare {
  _id: mongoose.Types.ObjectId;
  project_id: string; // Project UUID
  user_id: mongoose.Types.ObjectId;
  permission: 'view' | 'edit' | 'admin';
  created_at: Date;
  updated_at: Date;
}

const ProjectShareSchema = new Schema<IProjectShare>(
  {
    project_id: { type: String, ref: 'Project', required: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    permission: { type: String, enum: ['view', 'edit', 'admin'], default: 'view' },
  },
  {
    collection: 'project_shares',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
ProjectShareSchema.index({ project_id: 1, user_id: 1 }, { unique: true });

export const ProjectShare: Model<IProjectShare> =
  mongoose.models.ProjectShare || mongoose.model<IProjectShare>('ProjectShare', ProjectShareSchema);

// 3. ProjectFile
export interface IProjectFile {
  _id: mongoose.Types.ObjectId;
  project_id: string; // Project UUID
  filename: string; // UUID.ext
  original_filename: string;
  path: string;
  mime_type: string;
  size: number;
  source: 'dashboard' | 'app';
  checksum: string | null;
  created_at: Date;
  updated_at: Date;
}

const ProjectFileSchema = new Schema<IProjectFile>(
  {
    project_id: { type: String, ref: 'Project', required: true },
    filename: { type: String, required: true },
    original_filename: { type: String, required: true },
    path: { type: String, required: true },
    mime_type: { type: String, required: true },
    size: { type: Number, required: true },
    source: { type: String, enum: ['dashboard', 'app'], default: 'dashboard' },
    checksum: { type: String, default: null },
  },
  {
    collection: 'project_files',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
ProjectFileSchema.index({ project_id: 1, path: 1 });
ProjectFileSchema.index({ project_id: 1, filename: 1 });

export const ProjectFile: Model<IProjectFile> =
  mongoose.models.ProjectFile || mongoose.model<IProjectFile>('ProjectFile', ProjectFileSchema);

// 4. Template (embeds plan_ids[] replacing plan_template pivot table; partial unique slug)
export interface ITemplate {
  _id: mongoose.Types.ObjectId;
  slug: string | null;
  name: string;
  description: string | null;
  thumbnail: string | null; // Public R2 key
  zip_path: string | null; // Private R2 key: templates/...
  metadata: Record<string, unknown> | null;
  category: string | null;
  keywords: string[] | null;
  version: string;
  is_system: boolean;
  plan_ids: mongoose.Types.ObjectId[];
  created_at: Date;
  updated_at: Date;
}

const TemplateSchema = new Schema<ITemplate>(
  {
    slug: { type: String, default: null },
    name: { type: String, required: true },
    description: { type: String, default: null },
    thumbnail: { type: String, default: null },
    zip_path: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
    category: { type: String, default: null },
    keywords: { type: [String], default: null },
    version: { type: String, default: '1.0.0' },
    is_system: { type: Boolean, default: false, index: true },
    plan_ids: { type: [Schema.Types.ObjectId], ref: 'Plan', default: [], index: true },
  },
  {
    collection: 'templates',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);
TemplateSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: 'string' } } }
);

export const Template: Model<ITemplate> =
  mongoose.models.Template || mongoose.model<ITemplate>('Template', TemplateSchema);
