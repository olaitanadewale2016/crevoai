import { GoogleAuth } from 'google-auth-library';
import { getSetting, getSettingGroup } from './settings';
import { decryptJson } from './crypto';
import { IProject } from '@/models/Project';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface FirebaseServiceAccount {
  type: string;
  project_id: string;
  private_key_id?: string;
  private_key: string;
  client_email: string;
  client_id?: string;
  auth_uri?: string;
  token_uri?: string;
}

export async function getSystemFirebaseConfig(): Promise<FirebaseWebConfig | null> {
  const integrations = await getSettingGroup('integrations');
  if (!integrations.firebase_system_project_id || !integrations.firebase_system_api_key) {
    return null;
  }
  return {
    apiKey: integrations.firebase_system_api_key || '',
    authDomain: integrations.firebase_system_auth_domain || '',
    projectId: integrations.firebase_system_project_id || '',
    storageBucket: integrations.firebase_system_storage_bucket || '',
    messagingSenderId: integrations.firebase_system_messaging_sender_id || '',
    appId: integrations.firebase_system_app_id || '',
  };
}

export async function getSystemAdminServiceAccount(): Promise<FirebaseServiceAccount | null> {
  const sa = await getSetting<FirebaseServiceAccount | null>('firebase_admin_service_account', null);
  if (!sa || !sa.project_id || !sa.private_key || !sa.client_email) return null;
  return sa;
}

export async function getProjectFirebaseConfig(project: IProject): Promise<FirebaseWebConfig | null> {
  if (!project.uses_system_firebase && project.firebase_config) {
    const custom = decryptJson<FirebaseWebConfig>(project.firebase_config);
    if (custom?.projectId && custom?.apiKey) return custom;
  }
  return getSystemFirebaseConfig();
}

export async function getProjectAdminServiceAccount(
  project: IProject
): Promise<{ credentials: FirebaseServiceAccount; isSystem: boolean } | null> {
  if (!project.uses_system_firebase && project.firebase_admin_service_account) {
    const custom = decryptJson<FirebaseServiceAccount>(project.firebase_admin_service_account);
    if (custom?.project_id && custom?.private_key && custom?.client_email) {
      return { credentials: custom, isSystem: false };
    }
  }
  const sys = await getSystemAdminServiceAccount();
  if (sys) return { credentials: sys, isSystem: true };
  return null;
}

export function validateFirebaseWebConfig(cfg: Partial<FirebaseWebConfig>): string | null {
  const required: (keyof FirebaseWebConfig)[] = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
  ];
  for (const k of required) {
    if (!cfg[k] || typeof cfg[k] !== 'string' || !cfg[k]!.trim()) {
      return `Missing required Firebase field: ${k}`;
    }
  }
  if (!cfg.authDomain!.endsWith('.firebaseapp.com') && !cfg.authDomain!.endsWith('.web.app')) {
    return 'authDomain must end with .firebaseapp.com or .web.app';
  }
  if (
    !cfg.storageBucket!.endsWith('.appspot.com') &&
    !cfg.storageBucket!.endsWith('.firebasestorage.app')
  ) {
    return 'storageBucket must end with .appspot.com or .firebasestorage.app';
  }
  return null;
}

export function generateFirestoreRules(projectId: string): string {
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Scoped rules for Crevo project ${projectId}
    match /projects/${projectId}/{collection}/{document=**} {
      allow read, write: if true;
    }
  }
}`;
}

export async function testFirebaseWebConnection(
  config: Partial<FirebaseWebConfig> & { apiKey: string; projectId: string }
): Promise<{ connected: boolean; ok: boolean; error: string | null }> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      config.projectId
    )}/databases/(default)/documents/_test_connection_/ping?key=${encodeURIComponent(config.apiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    // 200, 404 (not found), and 403 (security rules) all confirm valid Firebase project + API key
    if (res.status === 200 || res.status === 404 || res.status === 403) {
      return { connected: true, ok: true, error: null };
    }
    const text = await res.text().catch(() => '');
    return { connected: false, ok: false, error: `Firebase responded with HTTP ${res.status}: ${text.slice(0, 200)}` };
  } catch (err: any) {
    return { connected: false, ok: false, error: err?.message || 'Failed to connect to Firebase' };
  }
}

async function getFirestoreAccessToken(sa: FirebaseServiceAccount): Promise<string> {
  const auth = new GoogleAuth({
    credentials: {
      client_email: sa.client_email,
      private_key: sa.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/datastore'],
  });
  const client = await auth.getClient();
  const tokenRes = await client.getAccessToken();
  if (!tokenRes.token) throw new Error('Failed to obtain Google OAuth2 access token');
  return tokenRes.token;
}

export async function listFirestoreCollections(
  sa: FirebaseServiceAccount,
  parentPrefix?: string
): Promise<Array<{ name: string; document_count: number | string; sample_fields: string[] }>> {
  const token = await getFirestoreAccessToken(sa);
  const cleanPrefix = (parentPrefix || '').replace(/^\/+|\/+$/g, '');
  const baseDocPath = `projects/${sa.project_id}/databases/(default)/documents${cleanPrefix ? `/${cleanPrefix}` : ''}`;

  const listUrl = `https://firestore.googleapis.com/v1/${baseDocPath}:listCollectionIds`;
  const res = await fetch(listUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pageSize: 100 }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Firestore listCollectionIds failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const json = (await res.json()) as { collectionIds?: string[] };
  const ids = json.collectionIds || [];

  const collections = await Promise.all(
    ids.map(async (colName) => {
      try {
        const docsUrl = `https://firestore.googleapis.com/v1/${baseDocPath}/${encodeURIComponent(
          colName
        )}?pageSize=100`;
        const dRes = await fetch(docsUrl, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!dRes.ok) {
          return { name: colName, document_count: 0, sample_fields: [] };
        }
        const dJson = (await dRes.json()) as {
          documents?: Array<{ fields?: Record<string, unknown> }>;
          nextPageToken?: string;
        };
        const docs = dJson.documents || [];
        const fieldSet = new Set<string>();
        for (const doc of docs) {
          for (const key of Object.keys(doc.fields || {})) {
            if (fieldSet.size < 20) fieldSet.add(key);
          }
        }
        return {
          name: colName,
          document_count: dJson.nextPageToken ? '100+' : docs.length,
          sample_fields: Array.from(fieldSet),
        };
      } catch {
        return { name: colName, document_count: 0, sample_fields: [] };
      }
    })
  );

  return collections;
}

export async function testFirebaseAdminConnection(
  sa?: FirebaseServiceAccount | null
): Promise<{ connected: boolean; ok: boolean; error: string | null }> {
  try {
    const targetSa = sa || (await getSystemAdminServiceAccount());
    if (!targetSa) {
      return { connected: false, ok: false, error: 'Firebase Admin SDK not configured' };
    }
    await listFirestoreCollections(targetSa);
    return { connected: true, ok: true, error: null };
  } catch (err: any) {
    return { connected: false, ok: false, error: err?.message || 'Admin SDK connection failed' };
  }
}
