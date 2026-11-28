import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFirestoreConnectionResponse,
  firestoreFieldsToJsObject,
  generateProjectFirestoreRules,
  generateProjectStorageRules,
  generateSystemFirestoreRules,
  generateSystemStorageRules,
  getEffectiveMaxFileSizeMb,
  getProjectFirebasePrefix,
  isCustomFirebaseAllowedForUser,
  isFileStorageAllowedForUser,
  isFirebaseAllowedForUser,
  isPathWithinProjectPrefix,
  jsObjectToFirestoreFields,
  parseFirebaseConfigSnippet,
  resolveEffectiveFirebaseSource,
} from './firebase-policy';

describe('firebase-policy helpers', () => {
  it('grants Firebase and file storage access to admins and eligible plan users only', () => {
    const admin = { role: 'admin' };
    const regular = { role: 'user' };
    const freePlan = {
      enable_firebase: false,
      allow_user_firebase_config: false,
      enable_file_storage: false,
      max_file_size_mb: 10,
    };
    const proPlan = {
      enable_firebase: true,
      allow_user_firebase_config: true,
      enable_file_storage: true,
      max_file_size_mb: 50,
    };

    assert.equal(isFirebaseAllowedForUser(admin, freePlan), true);
    assert.equal(isFileStorageAllowedForUser(admin, freePlan), true);
    assert.equal(isCustomFirebaseAllowedForUser(admin, null), true);
    assert.equal(getEffectiveMaxFileSizeMb(admin, null), 100);

    assert.equal(isFirebaseAllowedForUser(regular, freePlan), false);
    assert.equal(isFileStorageAllowedForUser(regular, freePlan), false);
    assert.equal(isCustomFirebaseAllowedForUser(regular, freePlan), false);

    assert.equal(isFirebaseAllowedForUser(regular, proPlan), true);
    assert.equal(isFileStorageAllowedForUser(regular, proPlan), true);
    assert.equal(isCustomFirebaseAllowedForUser(regular, proPlan), true);
    assert.equal(getEffectiveMaxFileSizeMb(regular, proPlan), 50);
  });

  it('never falls back to system Firebase when custom Firebase mode is explicitly selected', () => {
    assert.equal(resolveEffectiveFirebaseSource(true), 'system');
    assert.equal(resolveEffectiveFirebaseSource(undefined), 'system');
    assert.equal(resolveEffectiveFirebaseSource(null), 'system');
    assert.equal(resolveEffectiveFirebaseSource(false), 'custom');
  });

  it('validates project namespace boundaries for Firestore browsing', () => {
    const prefix = getProjectFirebasePrefix('proj-123');
    assert.equal(prefix, 'projects/proj-123');
    assert.equal(isPathWithinProjectPrefix('projects/proj-123/users/uid-1/cycles', prefix), true);
    assert.equal(isPathWithinProjectPrefix('/projects/proj-123/reviews/', prefix), true);
    assert.equal(isPathWithinProjectPrefix('projects/other-proj/users/uid-1/cycles', prefix), false);
    assert.equal(isPathWithinProjectPrefix('projects/proj-123/../other/secret', prefix), false);
    assert.equal(isPathWithinProjectPrefix('users/uid-1/cycles', prefix), false);
  });

  it('parses both plain JSON and Firebase Console JS config snippets', () => {
    const jsSnippet = `
      import { initializeApp } from "firebase/app";
      // Your web app's Firebase configuration
      const firebaseConfig = {
        apiKey: "AIzaSyExampleKey1234567890",
        authDomain: 'my-cycle-app.firebaseapp.com',
        projectId: "my-cycle-app",
        storageBucket: "my-cycle-app.firebasestorage.app",
        messagingSenderId: "1234567890",
        appId: "1:1234567890:web:abcdef123456",
      };
      const app = initializeApp(firebaseConfig);
    `;

    const parsed = parseFirebaseConfigSnippet(jsSnippet);
    assert.ok(parsed);
    assert.equal(parsed.apiKey, 'AIzaSyExampleKey1234567890');
    assert.equal(parsed.authDomain, 'my-cycle-app.firebaseapp.com');
    assert.equal(parsed.projectId, 'my-cycle-app');
    assert.equal(parsed.storageBucket, 'my-cycle-app.firebasestorage.app');

    const jsonParsed = parseFirebaseConfigSnippet(JSON.stringify(parsed));
    assert.deepEqual(jsonParsed, parsed);
    assert.equal(parseFirebaseConfigSnippet('not valid config'), null);
  });

  it('accurately distinguishes missing Firestore database from valid NOT_FOUND or PERMISSION_DENIED pings', () => {
    const missingDb = classifyFirestoreConnectionResponse(
      404,
      JSON.stringify({
        error: {
          code: 404,
          message: 'The database (default) does not exist for project demo-app Please visit https://console.cloud.google.com/datastore/setup',
          status: 'NOT_FOUND',
        },
      })
    );
    assert.equal(missingDb.connected, false);
    assert.match(missingDb.error || '', /Firestore database not found/i);

    const missingPingDoc = classifyFirestoreConnectionResponse(
      404,
      JSON.stringify({
        error: {
          code: 404,
          message: 'Document "projects/demo-app/databases/(default)/documents/_test_connection_/ping" not found.',
          status: 'NOT_FOUND',
        },
      })
    );
    assert.equal(missingPingDoc.connected, true);
    assert.equal(missingPingDoc.error, null);

    const rulesActive = classifyFirestoreConnectionResponse(
      403,
      JSON.stringify({
        error: {
          code: 403,
          message: 'Missing or insufficient permissions.',
          status: 'PERMISSION_DENIED',
        },
      })
    );
    assert.equal(rulesActive.connected, true);
  });

  it('generates owner-isolated Firestore and Firebase Storage rules for projects and system', () => {
    const projectRules = generateProjectFirestoreRules('proj-abc');
    assert.match(projectRules, /match \/projects\/proj-abc\/users\/\{userId\}/);
    assert.match(projectRules, /request\.auth\.uid == userId/);
    assert.match(projectRules, /match \/\{subcollection\}\/\{document=\*\*\}/);
    assert.match(projectRules, /resource != null && resource\.data\.get\('visibility', ''\) == 'public'/);

    const projectStorage = generateProjectStorageRules('proj-abc');
    assert.match(projectStorage, /service firebase\.storage/);
    assert.match(projectStorage, /match \/projects\/proj-abc\/uploads\/users\/\{userId\}\/\{allPaths=\*\*\}/);

    const sysRules = generateSystemFirestoreRules();
    assert.match(sysRules, /match \/projects\/\{projectId\}\/users\/\{userId\}/);

    const sysStorage = generateSystemStorageRules();
    assert.match(sysStorage, /match \/projects\/\{projectId\}\/uploads\/users\/\{userId\}\/\{allPaths=\*\*\}/);
  });

  it('round-trips Firestore REST API document payloads cleanly including nested cycle entries', () => {
    const cycleLog = {
      startDate: '2026-11-01',
      cycleLength: 28,
      flowIntensity: 2.5,
      isOvulationDay: false,
      symptoms: ['cramps', 'fatigue'],
      meta: { mood: 'calm', notes: null },
      ignoredUndefined: undefined,
    };

    const restFields = jsObjectToFirestoreFields(cycleLog);
    assert.equal('ignoredUndefined' in restFields, false);

    const roundTripped = firestoreFieldsToJsObject(restFields);
    assert.deepEqual(roundTripped, {
      startDate: '2026-11-01',
      cycleLength: 28,
      flowIntensity: 2.5,
      isOvulationDay: false,
      symptoms: ['cramps', 'fatigue'],
      meta: { mood: 'calm', notes: null },
    });
  });
});
