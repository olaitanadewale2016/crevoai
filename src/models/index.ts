export * from './Counter';
export * from './User';
export * from './Project';
export * from './Billing';
export * from './BuilderAi';
export * from './System';
export * from './StockImage';

import {
  Counter,
  SessionModel,
  PasswordResetToken,
  CacheEntry,
  CacheLock,
  RateLimit,
} from './Counter';
import {
  User,
  UserAiSettings,
  UserConsent,
  DataExportRequest,
  AccountDeletionRequest,
  AuditLog,
  UserNotification,
} from './User';
import { Project, ProjectShare, ProjectFile, Template } from './Project';
import {
  Plan,
  Subscription,
  Transaction,
  Plugin,
  ReferralCode,
  Referral,
  ReferralCreditTransaction,
} from './Billing';
import { Builder, AiProvider, BuildCreditUsage } from './BuilderAi';
import {
  SystemSetting,
  Language,
  LandingSection,
  LandingContent,
  LandingItem,
  CronLog,
  SentryPendingReport,
} from './System';
import { StockImage } from './StockImage';

export async function ensureAllIndexes(): Promise<void> {
  const models = [
    Counter,
    SessionModel,
    PasswordResetToken,
    CacheEntry,
    CacheLock,
    RateLimit,
    User,
    UserAiSettings,
    UserConsent,
    DataExportRequest,
    AccountDeletionRequest,
    AuditLog,
    UserNotification,
    Project,
    ProjectShare,
    ProjectFile,
    Template,
    Plan,
    Subscription,
    Transaction,
    Plugin,
    ReferralCode,
    Referral,
    ReferralCreditTransaction,
    Builder,
    AiProvider,
    BuildCreditUsage,
    SystemSetting,
    Language,
    LandingSection,
    LandingContent,
    LandingItem,
    CronLog,
    SentryPendingReport,
    StockImage,
  ];
  await Promise.all(models.map((m) => m.syncIndexes().catch(() => m.createIndexes())));
}
