import { redirect } from 'next/navigation';
import DatabaseIndex from '@/Pages/Database/Index';
import { connectDB } from '@/lib/db';
import {
  getSessionContext,
  hasVerifiedEmail,
  getUserCurrentPlan,
  serializeUser,
} from '@/lib/auth';
import { decryptJson } from '@/lib/crypto';
import {
  getSystemFirebaseConfig,
  getSystemAdminServiceAccount,
  FirebaseServiceAccount,
} from '@/lib/firebase-admin';
import { Project } from '@/models';

export const dynamic = 'force-dynamic';

export default async function DatabasePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (!(await hasVerifiedEmail(ctx.user))) redirect('/verify-email');

  await connectDB();
  const user = ctx.user;

  const [projectDocs, plan, sysFirebaseCfg, sysAdminSa] = await Promise.all([
    Project.find({ user_id: user._id, deleted_at: null })
      .sort({ updated_at: -1 })
      .select(
        '_id name uses_system_firebase firebase_config firebase_admin_service_account'
      )
      .lean(),
    getUserCurrentPlan(user),
    getSystemFirebaseConfig(),
    getSystemAdminServiceAccount(),
  ]);

  const firebaseEnabled = Boolean(plan?.enable_firebase);
  const canUseOwnConfig = Boolean(plan?.allow_user_firebase_config);
  const systemFirebaseConfigured = Boolean(
    sysFirebaseCfg?.apiKey && sysFirebaseCfg?.projectId && sysFirebaseCfg?.authDomain
  );
  const adminSdkConfigured = Boolean(sysAdminSa);

  const projects = projectDocs.map((p) => {
    const usesSystem = p.uses_system_firebase !== false;
    const customConfig = usesSystem ? null : decryptJson(p.firebase_config);
    const customSa = usesSystem
      ? null
      : decryptJson<FirebaseServiceAccount>(p.firebase_admin_service_account);
    const hasCustomSa = Boolean(
      customSa?.project_id && customSa?.private_key && customSa?.client_email
    );

    return {
      id: String(p._id),
      name: p.name,
      uses_system_firebase: usesSystem,
      has_custom_config: !usesSystem && Boolean(customConfig),
      collection_prefix: `projects/${String(p._id)}`,
      has_admin_sdk: usesSystem ? adminSdkConfigured : hasCustomSa,
    };
  });

  return (
    <DatabaseIndex
      auth={{ user: serializeUser(user) as any }}
      projects={projects}
      firebaseEnabled={firebaseEnabled}
      canUseOwnConfig={canUseOwnConfig}
      systemFirebaseConfigured={systemFirebaseConfigured}
      systemFirebaseConfig={
        firebaseEnabled && systemFirebaseConfigured ? sysFirebaseCfg : null
      }
      adminSdkConfigured={adminSdkConfigured}
    />
  );
}
