import { NextRequest, NextResponse } from 'next/server';

/**
 * Parses JSON, multipart/form-data, or application/x-www-form-urlencoded uniformly.
 * Supports Laravel nested bracket keys like `features[0][name]` or `plan_ids[]`.
 */
export type ParsedRequest<T = Record<string, any>> = T & {
  body: T;
  files: Record<string, File>;
  formData?: FormData;
};

/**
 * Parses JSON, multipart/form-data, or application/x-www-form-urlencoded uniformly.
 * Supports Laravel nested bracket keys like `features[0][name]` or `plan_ids[]`.
 */
export async function parseRequestBody<T = Record<string, any>>(req: NextRequest): Promise<ParsedRequest<T>> {
  const ct = (req.headers.get('content-type') || '').toLowerCase();

  if (ct.includes('application/json')) {
    const json = await req.json().catch(() => ({}));
    const bodyObj = json && typeof json === 'object' ? json : {};
    const result: any = { ...bodyObj };
    result.body = bodyObj;
    result.files = {};
    return result as ParsedRequest<T>;
  }

  if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
    const fd = await req.formData();
    const body: Record<string, any> = {};
    const files: Record<string, File> = {};

    for (const [key, val] of fd.entries()) {
      if (typeof File !== 'undefined' && val instanceof File) {
        files[key] = val;
        continue;
      }
      const strVal = String(val);
      if (key.endsWith('[]')) {
        const base = key.slice(0, -2);
        if (!Array.isArray(body[base])) body[base] = [];
        body[base].push(strVal);
      } else if (key.includes('[')) {
        // Parse bracket path e.g. config[apiKey] or features[0][name]
        const parts = key.replace(/\]/g, '').split('[');
        let cursor = body;
        for (let i = 0; i < parts.length - 1; i++) {
          const p = parts[i];
          const nextIsIndex = /^\d+$/.test(parts[i + 1]);
          if (cursor[p] === undefined) {
            cursor[p] = nextIsIndex ? [] : {};
          }
          cursor = cursor[p];
        }
        cursor[parts[parts.length - 1]] = strVal;
      } else {
        body[key] = strVal;
      }
    }
    const result: any = { ...body };
    result.body = body;
    result.files = files;
    result.formData = fd;
    return result as ParsedRequest<T>;
  }

  // Fallback attempt JSON
  const text = await req.text().catch(() => '');
  if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      const json = JSON.parse(text);
      const bodyObj = json && typeof json === 'object' ? json : {};
      const result: any = { ...bodyObj };
      result.body = bodyObj;
      result.files = {};
      return result as ParsedRequest<T>;
    } catch {
      // ignore
    }
  }
  const empty: any = {};
  empty.body = {};
  empty.files = {};
  return empty as ParsedRequest<T>;
}

export function toBool(val: unknown, fallback = false): boolean {
  if (typeof val === 'boolean') return val;
  if (val === '1' || val === 'true' || val === 'on' || val === 1) return true;
  if (val === '0' || val === 'false' || val === 'off' || val === 0 || val === '') return false;
  return fallback;
}

export function validationError(errors: Record<string, string>, status = 422) {
  const first = Object.values(errors)[0] || 'Validation failed.';
  return NextResponse.json({ message: first, error: first, errors }, { status });
}

export function buildPaginatedResponse<T>(params: {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  basePath?: string;
}) {
  const { data, total, page, perPage, basePath = '' } = params;
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? null : (page - 1) * perPage + 1;
  const to = total === 0 ? null : Math.min(total, page * perPage);
  return {
    data,
    current_page: page,
    last_page: lastPage,
    per_page: perPage,
    total,
    from,
    to,
    has_more: page < lastPage,
    links: {
      first: `${basePath}?page=1`,
      last: `${basePath}?page=${lastPage}`,
      prev: page > 1 ? `${basePath}?page=${page - 1}` : null,
      next: page < lastPage ? `${basePath}?page=${page + 1}` : null,
    },
  };
}

export function formatHumanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
