import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListBucketsCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

export type R2Visibility = 'public' | 'private';

let _s3Client: S3Client | null = null;

function getR2Endpoint(): string {
  if (process.env.R2_ENDPOINT) return process.env.R2_ENDPOINT;
  if (process.env.R2_ACCOUNT_ID) {
    return `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }
  return '';
}

export function isR2Configured(): boolean {
  return Boolean(
    getR2Endpoint() &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      (process.env.R2_PRIVATE_BUCKET || process.env.R2_PUBLIC_BUCKET)
  );
}

export function getR2Client(): S3Client {
  if (_s3Client) return _s3Client;
  const endpoint = getR2Endpoint();
  _s3Client = new S3Client({
    region: 'auto',
    endpoint: endpoint || 'https://placeholder.r2.cloudflarestorage.com',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: true,
  });
  return _s3Client;
}

export function getR2Bucket(visibility: R2Visibility): string {
  if (visibility === 'public') {
    return process.env.R2_PUBLIC_BUCKET || process.env.R2_PRIVATE_BUCKET || 'crevo-public';
  }
  return process.env.R2_PRIVATE_BUCKET || process.env.R2_PUBLIC_BUCKET || 'crevo-private';
}

export function getPublicAssetUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^https?:\/\//i.test(key) || key.startsWith('data:')) return key;
  const cleanKey = key.replace(/^\/+/, '').replace(/^storage\//, '');
  const base = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
  if (base) {
    return `${base}/${cleanKey}`;
  }
  return `/storage/${cleanKey}`;
}

export const getR2PublicUrl = getPublicAssetUrl;

export async function r2PutBuffer(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType = 'application/octet-stream',
  visibility: R2Visibility = 'private'
): Promise<void> {
  await r2PutObject({
    visibility,
    key,
    body,
    contentType,
  });
}

export async function r2PutObject(params: {
  visibility: R2Visibility;
  key: string;
  body: Buffer | Uint8Array | string | Readable;
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
}): Promise<void> {
  const client = getR2Client();
  const bucket = getR2Bucket(params.visibility);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: params.key.replace(/^\/+/, ''),
      Body: params.body,
      ContentType: params.contentType || 'application/octet-stream',
      CacheControl: params.cacheControl,
      ContentDisposition: params.contentDisposition,
    })
  );
}

export async function r2GetObject(visibility: R2Visibility, key: string): Promise<{
  body: ReadableStream | Readable | null;
  contentType: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
} | null> {
  const client = getR2Client();
  const bucket = getR2Bucket(visibility);
  try {
    const res = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key.replace(/^\/+/, ''),
      })
    );
    return {
      body: (res.Body as any) ?? null,
      contentType: res.ContentType || guessContentType(key),
      contentLength: res.ContentLength,
      etag: res.ETag,
      lastModified: res.LastModified,
    };
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

export async function r2GetBuffer(
  visibilityOrKey: R2Visibility | string,
  keyOpt?: string
): Promise<Buffer | null> {
  const visibility: R2Visibility = keyOpt !== undefined ? (visibilityOrKey as R2Visibility) : 'private';
  const key: string = keyOpt !== undefined ? keyOpt : visibilityOrKey;
  const obj = await r2GetObject(visibility, key);
  if (!obj?.body) return null;
  if (typeof (obj.body as any).transformToByteArray === 'function') {
    const arr = await (obj.body as any).transformToByteArray();
    return Buffer.from(arr);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of obj.body as AsyncIterable<Uint8Array | Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function r2CopyObject(
  sourceOrParams:
    | string
    | {
        sourceVisibility?: R2Visibility;
        sourceKey: string;
        destVisibility?: R2Visibility;
        destKey: string;
      },
  destKeyOpt?: string,
  visibilityOpt: R2Visibility = 'private'
): Promise<void> {
  const client = getR2Client();
  let srcKey: string;
  let dstKey: string;
  let srcVis: R2Visibility = visibilityOpt;
  let dstVis: R2Visibility = visibilityOpt;

  if (typeof sourceOrParams === 'object') {
    srcKey = sourceOrParams.sourceKey;
    dstKey = sourceOrParams.destKey;
    srcVis = sourceOrParams.sourceVisibility || 'private';
    dstVis = sourceOrParams.destVisibility || srcVis;
  } else {
    srcKey = sourceOrParams;
    dstKey = destKeyOpt || '';
  }

  const srcBucket = getR2Bucket(srcVis);
  const destBucket = getR2Bucket(dstVis);
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: destBucket,
        Key: dstKey.replace(/^\/+/, ''),
        CopySource: `${srcBucket}/${srcKey.replace(/^\/+/, '')}`,
      })
    );
  } catch (err) {
    // If copy fails across regions or unsupported, fallback to get + put
    const buf = await r2GetBuffer(srcVis, srcKey);
    if (buf) {
      await r2PutObject({
        visibility: dstVis,
        key: dstKey,
        body: buf,
      });
    }
  }
}

export async function r2Exists(visibility: R2Visibility, key: string): Promise<boolean> {
  const client = getR2Client();
  const bucket = getR2Bucket(visibility);
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key.replace(/^\/+/, ''),
      })
    );
    return true;
  } catch {
    return false;
  }
}

export async function r2DeleteObject(
  visibilityOrKey: R2Visibility | string,
  keyOrVisibilityOpt?: R2Visibility | string
): Promise<void> {
  let visibility: R2Visibility = 'private';
  let key = '';

  if (visibilityOrKey === 'public' || visibilityOrKey === 'private') {
    visibility = visibilityOrKey;
    key = String(keyOrVisibilityOpt || '');
  } else {
    key = visibilityOrKey;
    if (keyOrVisibilityOpt === 'public' || keyOrVisibilityOpt === 'private') {
      visibility = keyOrVisibilityOpt;
    }
  }
  if (!key) return;
  const client = getR2Client();
  const bucket = getR2Bucket(visibility);
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key.replace(/^\/+/, ''),
      })
    );
  } catch {
    // ignore missing
  }
}

export async function r2ListKeys(
  visibilityOrPrefix: R2Visibility | string,
  prefixOpt?: string
): Promise<string[]> {
  const visibility: R2Visibility = prefixOpt !== undefined ? (visibilityOrPrefix as R2Visibility) : 'private';
  const prefix: string = prefixOpt !== undefined ? prefixOpt : visibilityOrPrefix;
  const client = getR2Client();
  const bucket = getR2Bucket(visibility);
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix.replace(/^\/+/, ''),
        ContinuationToken: continuationToken,
      })
    );
    for (const item of res.Contents ?? []) {
      if (item.Key) keys.push(item.Key);
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

export async function r2ListPrefixes(visibility: R2Visibility, prefix: string): Promise<string[]> {
  const client = getR2Client();
  const bucket = getR2Bucket(visibility);
  const prefixes: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix.replace(/^\/+/, ''),
        Delimiter: '/',
        ContinuationToken: continuationToken,
      })
    );
    for (const cp of res.CommonPrefixes ?? []) {
      if (cp.Prefix) prefixes.push(cp.Prefix);
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return prefixes;
}

export async function r2DeletePrefix(visibility: R2Visibility, prefix: string): Promise<number> {
  const keys = await r2ListKeys(visibility, prefix);
  if (keys.length === 0) return 0;
  const client = getR2Client();
  const bucket = getR2Bucket(visibility);
  let deleted = 0;

  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );
    deleted += batch.length;
  }

  return deleted;
}

export async function r2GetSignedUrl(params: {
  visibility: R2Visibility;
  key: string;
  expiresInSeconds?: number;
  downloadFilename?: string;
  contentType?: string;
}): Promise<string> {
  const client = getR2Client();
  const bucket = getR2Bucket(params.visibility);
  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: params.key.replace(/^\/+/, ''),
    ResponseContentDisposition: params.downloadFilename
      ? `attachment; filename="${params.downloadFilename.replace(/"/g, '')}"`
      : undefined,
    ResponseContentType: params.contentType,
  });
  return getSignedUrl(client, cmd, { expiresIn: params.expiresInSeconds ?? 3600 });
}

export async function testR2Connection(): Promise<{ ok: boolean; error?: string }> {
  if (!isR2Configured()) {
    return { ok: false, error: 'Cloudflare R2 environment variables are not configured.' };
  }
  try {
    const client = getR2Client();
    await client.send(new ListBucketsCommand({}));
    return { ok: true };
  } catch (e: any) {
    // Some R2 scoped tokens disallow ListBuckets; fallback to ListObjectsV2 on configured bucket
    try {
      const client = getR2Client();
      await client.send(
        new ListObjectsV2Command({
          Bucket: getR2Bucket('private'),
          MaxKeys: 1,
        })
      );
      return { ok: true };
    } catch (e2: any) {
      return { ok: false, error: e2?.message || e?.message || 'R2 connection failed' };
    }
  }
}

export function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
    otf: 'font/otf',
    pdf: 'application/pdf',
    zip: 'application/zip',
    txt: 'text/plain; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    wasm: 'application/wasm',
    map: 'application/json',
  };
  return map[ext] || 'application/octet-stream';
}
