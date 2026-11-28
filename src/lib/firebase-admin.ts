import { GoogleAuth } from 'google-auth-library';
import { getSetting, getSettingGroup } from './settings';
import { decryptJson } from './crypto';
import { IProject } from '@/models/Project';
import {
  classifyFirestoreConnectionResponse,
  firestoreFieldsToJsObject,
  generateProjectFirestoreRules,
  generateProjectStorageRules,
  generateSystemFirestoreRules,
  generateSystemStorageRules,
  jsObjectToFirestoreFields,
  resolveEffectiveFirebaseSource,
} from './firebase-policy';

export {
  generateProjectFirestoreRules,
  generateProjectStorageRules,
  generateSystemFirestoreRules,
  generateSystemStorageRules,
};

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
    apiKey: String(integrations.firebase_system_api_key || '').trim(),
    authDomain: String(integrations.firebase_system_auth_domain || '').trim(),
    projectId: String(integrations.firebase_system_project_id || '').trim(),
    storageBucket: String(integrations.firebase_system_storage_bucket || '').trim(),
    messagingSenderId: String(integrations.firebase_system_messaging_sender_id || '').trim(),
    appId: String(integrations.firebase_system_app_id || '').trim(),
  };
}

export async function getSystemAdminServiceAccount(): Promise<FirebaseServiceAccount | null> {
  const sa = await getSetting<FirebaseServiceAccount | null>('firebase_admin_service_account', null);
  if (!sa || !sa.project_id || !sa.private_key || !sa.client_email) return null;
  return sa;
}

export async function getProjectFirebaseConfig(project: IProject): Promise<FirebaseWebConfig | null> {
  const source = resolveEffectiveFirebaseSource(project.uses_system_firebase);
  if (source === 'custom') {
    if (!project.firebase_config) return null;
    const custom = decryptJson<FirebaseWebConfig>(project.firebase_config);
    if (custom?.projectId && custom?.apiKey) return custom;
    return null;
  }
  return getSystemFirebaseConfig();
}

export async function getProjectAdminServiceAccount(
  project: IProject
): Promise<{ credentials: FirebaseServiceAccount; isSystem: boolean } | null> {
  const source = resolveEffectiveFirebaseSource(project.uses_system_firebase);
  if (source === 'custom') {
    if (!project.firebase_admin_service_account) return null;
    const custom = decryptJson<FirebaseServiceAccount>(project.firebase_admin_service_account);
    if (custom?.project_id && custom?.private_key && custom?.client_email) {
      return { credentials: custom, isSystem: false };
    }
    return null;
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
  const authDomain = cfg.authDomain!.trim();
  const storageBucket = cfg.storageBucket!.trim();
  if (!authDomain.endsWith('.firebaseapp.com') && !authDomain.endsWith('.web.app')) {
    return 'authDomain must end with .firebaseapp.com or .web.app';
  }
  if (
    !storageBucket.endsWith('.appspot.com') &&
    !storageBucket.endsWith('.firebasestorage.app')
  ) {
    return 'storageBucket must end with .appspot.com or .firebasestorage.app';
  }
  return null;
}

export function generateFirestoreRules(projectId: string, collectionPrefix?: string): string {
  return generateProjectFirestoreRules(projectId, collectionPrefix);
}

export async function testFirebaseWebConnection(
  config: Partial<FirebaseWebConfig> & { apiKey: string; projectId: string }
): Promise<{ connected: boolean; ok: boolean; error: string | null }> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      config.projectId.trim()
    )}/databases/(default)/documents/_test_connection_/ping?key=${encodeURIComponent(config.apiKey.trim())}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const text = await res.text().catch(() => '');
    return classifyFirestoreConnectionResponse(res.status, text);
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

function buildFirestoreDocPath(projectId: string, relativePath?: string): string {
  const clean = (relativePath || '').replace(/^\/+|\/+$/g, '');
  const encodedSegments = clean
    ? clean
        .split('/')
        .filter(Boolean)
        .map((seg) => encodeURIComponent(seg))
        .join('/')
    : '';
  return `projects/${encodeURIComponent(projectId)}/databases/(default)/documents${
    encodedSegments ? `/${encodedSegments}` : ''
  }`;
}

export async function listFirestoreCollections(
  sa: FirebaseServiceAccount,
  parentPrefix?: string
): Promise<Array<{ id: string; path: string; name: string; document_count: number | string; sample_fields: string[] }>> {
  const token = await getFirestoreAccessToken(sa);
  const cleanPrefix = (parentPrefix || '').replace(/^\/+|\/+$/g, '');
  const baseDocPath = buildFirestoreDocPath(sa.project_id, cleanPrefix);

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
      const fullPath = cleanPrefix ? `${cleanPrefix}/${colName}` : colName;
      try {
        const docsUrl = `https://firestore.googleapis.com/v1/${baseDocPath}/${encodeURIComponent(
          colName
        )}?pageSize=100`;
        const dRes = await fetch(docsUrl, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!dRes.ok) {
          return { id: colName, path: fullPath, name: colName, document_count: 0, sample_fields: [] };
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
          id: colName,
          path: fullPath,
          name: colName,
          document_count: dJson.nextPageToken ? '100+' : docs.length,
          sample_fields: Array.from(fieldSet),
        };
      } catch {
        return { id: colName, path: fullPath, name: colName, document_count: 0, sample_fields: [] };
      }
    })
  );

  return collections;
}

export async function listFirestoreDocuments(
  sa: FirebaseServiceAccount,
  collectionPath: string,
  pageSize = 50
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const token = await getFirestoreAccessToken(sa);
  const fullColPath = buildFirestoreDocPath(sa.project_id, collectionPath);
  const url = `https://firestore.googleapis.com/v1/${fullColPath}?pageSize=${Math.min(Math.max(1, pageSize), 100)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Firestore list documents failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    documents?: Array<{ name?: string; fields?: Record<string, any> }>;
  };
  return (json.documents || []).map((doc) => {
    const parts = (doc.name || '').split('/');
    const id = parts[parts.length - 1] || '';
    return {
      id,
      data: firestoreFieldsToJsObject(doc.fields),
    };
  });
}

export async function createFirestoreDocument(
  sa: FirebaseServiceAccount,
  collectionPath: string,
  data: Record<string, unknown>
): Promise<{ id: string; data: Record<string, unknown> }> {
  const token = await getFirestoreAccessToken(sa);
  const fullColPath = buildFirestoreDocPath(sa.project_id, collectionPath);
  const url = `https://firestore.googleapis.com/v1/${fullColPath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: jsObjectToFirestoreFields(data) }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Firestore create document failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const created = (await res.json()) as { name?: string; fields?: Record<string, any> };
  const parts = (created.name || '').split('/');
  return {
    id: parts[parts.length - 1] || '',
    data: firestoreFieldsToJsObject(created.fields),
  };
}

export async function setFirestoreDocument(
  sa: FirebaseServiceAccount,
  collectionPath: string,
  documentId: string,
  data: Record<string, unknown>
): Promise<{ id: string; data: Record<string, unknown> }> {
  const token = await getFirestoreAccessToken(sa);
  const fullDocPath = buildFirestoreDocPath(sa.project_id, `${collectionPath}/${documentId}`);
  const url = `https://firestore.googleapis.com/v1/${fullDocPath}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: jsObjectToFirestoreFields(data) }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Firestore save document failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const updated = (await res.json()) as { fields?: Record<string, any> };
  return {
    id: documentId,
    data: firestoreFieldsToJsObject(updated.fields),
  };
}

export async function deleteFirestoreDocument(
  sa: FirebaseServiceAccount,
  collectionPath: string,
  documentId: string
): Promise<void> {
  const token = await getFirestoreAccessToken(sa);
  const fullDocPath = buildFirestoreDocPath(sa.project_id, `${collectionPath}/${documentId}`);
  const url = `https://firestore.googleapis.com/v1/${fullDocPath}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok && res.status !== 404) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Firestore delete document failed (${res.status}): ${errText.slice(0, 200)}`);
  }
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
