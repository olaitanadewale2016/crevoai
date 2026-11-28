export interface FirebaseCapabilityUser {
  role?: string | null;
}

export interface FirebaseCapabilityPlan {
  enable_firebase?: boolean | null;
  allow_user_firebase_config?: boolean | null;
  enable_file_storage?: boolean | null;
  max_storage_mb?: number | null;
  max_file_size_mb?: number | null;
  allowed_file_types?: string[] | null;
}

export function isFirebaseAllowedForUser(
  user: FirebaseCapabilityUser | null | undefined,
  plan: FirebaseCapabilityPlan | null | undefined
): boolean {
  return Boolean(user?.role === 'admin' || plan?.enable_firebase);
}

export function isCustomFirebaseAllowedForUser(
  user: FirebaseCapabilityUser | null | undefined,
  plan: FirebaseCapabilityPlan | null | undefined
): boolean {
  return Boolean(user?.role === 'admin' || plan?.allow_user_firebase_config);
}

export function isFileStorageAllowedForUser(
  user: FirebaseCapabilityUser | null | undefined,
  plan: FirebaseCapabilityPlan | null | undefined
): boolean {
  return Boolean(user?.role === 'admin' || plan?.enable_file_storage);
}

export function getEffectiveMaxFileSizeMb(
  user: FirebaseCapabilityUser | null | undefined,
  plan: FirebaseCapabilityPlan | null | undefined
): number {
  if (plan?.max_file_size_mb && plan.max_file_size_mb > 0) {
    return Number(plan.max_file_size_mb);
  }
  return user?.role === 'admin' ? 100 : 10;
}

export function getProjectFirebasePrefix(projectId: string): string {
  return `projects/${String(projectId).replace(/^\/+|\/+$/g, '')}`;
}

export function resolveEffectiveFirebaseSource(
  usesSystemFirebase: boolean | null | undefined
): 'system' | 'custom' {
  return usesSystemFirebase === false ? 'custom' : 'system';
}

/**
 * Ensures a Firestore collection/document path stays inside the allowed project prefix.
 */
export function isPathWithinProjectPrefix(path: string, prefix: string): boolean {
  const cleanPath = String(path || '').replace(/^\/+|\/+$/g, '');
  const cleanPrefix = String(prefix || '').replace(/^\/+|\/+$/g, '');
  if (!cleanPath || !cleanPrefix) return false;
  if (cleanPath.includes('..') || cleanPath.includes('//')) return false;
  return cleanPath === cleanPrefix || cleanPath.startsWith(`${cleanPrefix}/`);
}

/**
 * Parses either plain JSON or a standard Firebase Console JavaScript config snippet
 * (e.g. `const firebaseConfig = { apiKey: "...", ... };`).
 */
export function parseFirebaseConfigSnippet(input: string): Record<string, string> | null {
  if (!input || !input.trim()) return null;
  try {
    const trimmed = input.trim();
    const configMatch = trimmed.match(/(?:const|let|var)\s+firebaseConfig\s*=\s*(\{[\s\S]*?\})\s*;?/);
    let jsonStr: string;

    if (configMatch) {
      jsonStr = configMatch[1];
    } else {
      const objectMatch = trimmed.match(/\{[\s\S]*?apiKey[\s\S]*?\}/);
      jsonStr = objectMatch ? objectMatch[0] : trimmed;
    }

    // Strip single-line JS comments outside string values
    jsonStr = jsonStr.replace(/^\s*\/\/.*$/gm, '');
    // Quote unquoted JS object keys
    jsonStr = jsonStr.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
    // Convert single-quoted string literals to double-quoted JSON strings
    jsonStr = jsonStr.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
    // Remove trailing commas
    jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');

    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.trim()) {
        out[k] = v.trim();
      }
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Classify Firestore REST ping response accurately (distinguishing missing Firestore
 * database from missing test document or active security rules).
 */
export function classifyFirestoreConnectionResponse(
  status: number,
  bodyText: string
): { connected: boolean; ok: boolean; error: string | null } {
  let parsedStatus = '';
  let parsedMessage = '';
  try {
    const parsed = JSON.parse(bodyText);
    parsedStatus = String(parsed?.error?.status || '');
    parsedMessage = String(parsed?.error?.message || '');
  } catch {
    parsedMessage = bodyText;
  }

  if (status === 200) {
    return { connected: true, ok: true, error: null };
  }

  if (status === 404) {
    const lower = parsedMessage.toLowerCase();
    if (
      lower.includes('database (default) does not exist') ||
      lower.includes('does not exist for project') ||
      lower.includes('cloud firestore api has not been used')
    ) {
      return {
        connected: false,
        ok: false,
        error:
          'Cloud Firestore database not found for this Firebase project. Create a Firestore database in Firebase Console first.',
      };
    }
    if (parsedStatus === 'NOT_FOUND' || lower.includes('document')) {
      return { connected: true, ok: true, error: null };
    }
    return {
      connected: false,
      ok: false,
      error:
        'Firestore database not found. Please create a Cloud Firestore database in Firebase Console first.',
    };
  }

  if (status === 403) {
    const lower = parsedMessage.toLowerCase();
    if (lower.includes('cloud firestore api has not been used') || lower.includes('disabled')) {
      return {
        connected: false,
        ok: false,
        error: 'Cloud Firestore API is disabled on this Firebase project. Enable Cloud Firestore in Firebase Console.',
      };
    }
    if (parsedStatus === 'PERMISSION_DENIED' || lower.includes('missing or insufficient permissions')) {
      return { connected: true, ok: true, error: null };
    }
    return {
      connected: false,
      ok: false,
      error: parsedMessage || 'Access denied. Check your Firebase API key and Firestore security rules.',
    };
  }

  return {
    connected: false,
    ok: false,
    error: `Firebase responded with HTTP ${status}: ${(parsedMessage || bodyText).slice(0, 200)}`,
  };
}

/**
 * Generates Cloud Firestore security rules for a specific project.
 * Supports:
 * - Private per-user data & subcollections under `users/{userId}/...` (owner-only read/write)
 * - Publicly visible documents (`visibility == 'public'`)
 * - Authenticated user read/write for shared project collections
 */
export function generateProjectFirestoreRules(projectId: string, collectionPrefix?: string): string {
  const rawPrefix = (collectionPrefix ?? getProjectFirebasePrefix(projectId)).replace(/^\/+|\/+$/g, '');
  const basePath = rawPrefix ? `/${rawPrefix}` : '';
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Project-specific rules for project: ${projectId}
    match ${basePath}/users/{userId} {
      // Users can read and write their own profile/settings document
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // Users can read and write their own private subcollections (e.g., cycles, logs, journals)
      match /{subcollection}/{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    match ${basePath}/{collection}/{document=**} {
      // Allow read access to explicitly public documents
      allow read: if resource != null && resource.data.get('visibility', '') == 'public';

      // Allow read/write access to authenticated users on shared project collections
      allow read, write: if request.auth != null && collection != 'users';
    }
  }
}`;
}

/**
 * Generates Firebase Cloud Storage security rules for a specific project.
 */
export function generateProjectStorageRules(projectId: string, collectionPrefix?: string): string {
  const rawPrefix = (collectionPrefix ?? getProjectFirebasePrefix(projectId)).replace(/^\/+|\/+$/g, '');
  const basePath = rawPrefix ? `/${rawPrefix}` : '';
  return `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Private user uploads for project: ${projectId}
    match ${basePath}/uploads/users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Shared authenticated uploads for project: ${projectId}
    match ${basePath}/uploads/public/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}`;
}

/**
 * Generates multi-tenant Cloud Firestore security rules for the platform System Firebase project.
 */
export function generateSystemFirestoreRules(): string {
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Multi-tenant isolation: every Crevo project stores data under /projects/{projectId}/...
    match /projects/{projectId}/users/{userId} {
      // Each signed-in app user owns their profile/settings document
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // Each signed-in app user owns their private subcollections (e.g., cycles, logs, notes)
      match /{subcollection}/{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    match /projects/{projectId}/{collection}/{document=**} {
      // Public documents readable without login
      allow read: if resource != null && resource.data.get('visibility', '') == 'public';

      // Authenticated app users can read/write shared project collections
      allow read, write: if request.auth != null && collection != 'users';
    }
  }
}`;
}

/**
 * Generates multi-tenant Firebase Cloud Storage security rules for the platform System Firebase project.
 */
export function generateSystemStorageRules(): string {
  return `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Private per-user uploads scoped by project & user UID
    match /projects/{projectId}/uploads/users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Shared project uploads
    match /projects/{projectId}/uploads/public/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}`;
}

/**
 * Converts a Firestore REST API typed value into a plain JavaScript value.
 */
export function firestoreValueToJs(val: any): unknown {
  if (!val || typeof val !== 'object') return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('stringValue' in val) return String(val.stringValue);
  if ('timestampValue' in val) return String(val.timestampValue);
  if ('referenceValue' in val) return String(val.referenceValue);
  if ('bytesValue' in val) return String(val.bytesValue);
  if ('geoPointValue' in val) return val.geoPointValue;
  if ('arrayValue' in val) {
    const arr = Array.isArray(val.arrayValue?.values) ? val.arrayValue.values : [];
    return arr.map((item: any) => firestoreValueToJs(item));
  }
  if ('mapValue' in val) {
    return firestoreFieldsToJsObject(val.mapValue?.fields);
  }
  return null;
}

export function firestoreFieldsToJsObject(fields?: Record<string, any> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [key, val] of Object.entries(fields)) {
    out[key] = firestoreValueToJs(val);
  }
  return out;
}

/**
 * Converts a plain JavaScript value into a Firestore REST API typed value.
 */
export function jsToFirestoreValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { nullValue: null };
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value
          .filter((item) => item !== undefined)
          .map((item) => jsToFirestoreValue(item)),
      },
    };
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: jsObjectToFirestoreFields(value as Record<string, unknown>),
      },
    };
  }
  return { stringValue: String(value) };
}

export function jsObjectToFirestoreFields(
  obj: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const fields: Record<string, Record<string, unknown>> = {};
  for (const [key, val] of Object.entries(obj || {})) {
    if (val === undefined) continue;
    fields[key] = jsToFirestoreValue(val);
  }
  return fields;
}
