'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import NextLink, { LinkProps } from 'next/link';
import { useRouter as useNextRouter, usePathname, useSearchParams } from 'next/navigation';
import { route } from './route';

// Expose global route() on window for 100% compatibility with ported components
if (typeof window !== 'undefined') {
  (window as any).route = route;
}

// Navigation event bus (replaces router.on('start' | 'finish', ...))
type NavEventType = 'start' | 'finish' | 'navigate' | 'error' | 'invalid' | 'before';
type NavEvent = { detail: { visit: { url: URL; method: string } } };
type NavListener = (event: NavEvent) => void;

const navListeners: Record<string, Set<NavListener>> = {};

function emitNavEvent(type: NavEventType, url?: string, method = 'get') {
  const listeners = navListeners[type];
  if (!listeners) return;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(
      url || (typeof window !== 'undefined' ? window.location.href : 'http://localhost'),
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    );
  } catch {
    parsedUrl = new URL('http://localhost');
  }
  for (const fn of listeners) {
    try {
      fn({ detail: { visit: { url: parsedUrl, method } } });
    } catch {
      // ignore listener errors
    }
  }
}

// Global nextRouter bridge registered by AppContextProvider
let globalNextRouter: ReturnType<typeof useNextRouter> | null = null;
let globalSetFlash: ((flash: Record<string, any>) => void) | null = null;
let globalRefreshShared: (() => Promise<void>) | null = null;

export interface VisitOptions {
  method?: 'get' | 'post' | 'put' | 'patch' | 'delete';
  data?: any;
  preserveScroll?: boolean;
  preserveState?: boolean;
  replace?: boolean;
  forceFormData?: boolean;
  only?: string[];
  headers?: Record<string, string>;
  onStart?: () => void;
  onSuccess?: (page: { props: Record<string, any> }) => void;
  onError?: (errors: Record<string, string>) => void;
  onFinish?: () => void;
}

function hasFileValues(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof File !== 'undefined' && obj instanceof File) return true;
  if (typeof Blob !== 'undefined' && obj instanceof Blob) return true;
  if (obj instanceof FormData) return true;
  if (Array.isArray(obj)) return obj.some(hasFileValues);
  return Object.values(obj).some(hasFileValues);
}

function objectToFormData(obj: Record<string, any>, form = new FormData(), prefix = ''): FormData {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const formKey = prefix ? `${prefix}[${key}]` : key;
    if (value === null) {
      form.append(formKey, '');
    } else if (typeof File !== 'undefined' && (value instanceof File || value instanceof Blob)) {
      form.append(formKey, value);
    } else if (Array.isArray(value)) {
      value.forEach((item, idx) => {
        if (item !== null && typeof item === 'object' && !(item instanceof File)) {
          objectToFormData(item, form, `${formKey}[${idx}]`);
        } else {
          form.append(`${formKey}[]`, item === null || item === undefined ? '' : String(item));
        }
      });
    } else if (typeof value === 'object' && !(value instanceof Date)) {
      objectToFormData(value, form, formKey);
    } else if (typeof value === 'boolean') {
      form.append(formKey, value ? '1' : '0');
    } else {
      form.append(formKey, String(value));
    }
  }
  return form;
}

const ACTION_REWRITES: Record<string, string> = {
  '/projects': '/api/web-actions/projects',
  '/admin/ai-builders': '/api/web-actions/admin/ai-builders',
  '/admin/ai-providers': '/api/web-actions/admin/ai-providers',
  '/admin/ai-templates': '/api/web-actions/admin/ai-templates',
  '/admin/languages': '/api/web-actions/admin/languages',
  '/admin/plans': '/api/web-actions/admin/plans',
  '/admin/subscriptions': '/api/web-actions/admin/subscriptions',
  '/admin/users': '/api/web-actions/admin/users',
  '/login': '/api/web-actions/login',
  '/register': '/api/web-actions/register',
  '/forgot-password': '/api/web-actions/forgot-password',
  '/reset-password': '/api/web-actions/reset-password',
  '/confirm-password': '/api/web-actions/confirm-password',
  '/profile': '/api/web-actions/profile',
  '/upgrade': '/api/web-actions/upgrade',
  '/install/admin': '/api/web-actions/install/admin',
  '/install/database': '/api/web-actions/install/database',
};

async function performRequest(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  url: string,
  data?: any,
  options: VisitOptions = {}
) {
  const effectiveMethod =
    data && typeof data === 'object' && '_method' in data && typeof data._method === 'string'
      ? (data._method.toLowerCase() as VisitOptions['method']) || method
      : method;

  let requestUrl = url;
  if (effectiveMethod !== 'get') {
    const [pathPart, queryPart] = url.split('?');
    const cleanPath = pathPart.replace(/\/+$/, '');
    if (ACTION_REWRITES[cleanPath]) {
      requestUrl = ACTION_REWRITES[cleanPath] + (queryPart ? `?${queryPart}` : '');
    }
  }

  options.onStart?.();
  emitNavEvent('start', requestUrl, effectiveMethod);

  try {
    if (effectiveMethod === 'get') {
      let targetUrl = url;
      if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        const u = new URL(url, window.location.origin);
        for (const [k, v] of Object.entries(data)) {
          if (v !== undefined && v !== null && v !== '') {
            u.searchParams.set(k, String(v));
          } else {
            u.searchParams.delete(k);
          }
        }
        targetUrl = `${u.pathname}${u.search}${u.hash}`;
      }
      if (globalNextRouter) {
        if (options.replace) {
          globalNextRouter.replace(targetUrl, { scroll: !options.preserveScroll });
        } else {
          globalNextRouter.push(targetUrl, { scroll: !options.preserveScroll });
        }
      } else {
        window.location.href = targetUrl;
      }
      options.onSuccess?.({ props: {} });
      emitNavEvent('finish', targetUrl, 'get');
      options.onFinish?.();
      return;
    }

    const useFormData =
      options.forceFormData || data instanceof FormData || hasFileValues(data);
    let fetchMethod = effectiveMethod.toUpperCase();
    let body: BodyInit | undefined;
    const reqHeaders: Record<string, string> = {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.headers || {}),
    };

    if (data !== undefined) {
      if (useFormData) {
        body = data instanceof FormData ? data : objectToFormData(data);
        // Keep spoofed _method in POST FormData if backend expects POST or send real method
        if (fetchMethod === 'PUT' || fetchMethod === 'PATCH') {
          if (body instanceof FormData && !body.has('_method')) {
            body.append('_method', fetchMethod);
          }
        }
      } else {
        reqHeaders['Content-Type'] = 'application/json';
        body = JSON.stringify(data);
      }
    }

    const res = await fetch(requestUrl, {
      method: fetchMethod,
      headers: reqHeaders,
      body,
      credentials: 'same-origin',
    });

    // External redirect header (mirrors Inertia::location)
    const externalLoc = res.headers.get('X-Inertia-Location');
    if (externalLoc) {
      window.location.href = externalLoc;
      return;
    }

    // Handle native fetch redirects (HTTP 302/303 followed by browser)
    if (res.redirected && res.url) {
      try {
        const redirectedUrl = new URL(res.url);
        const targetPath = `${redirectedUrl.pathname}${redirectedUrl.search}${redirectedUrl.hash}`;
        if (targetPath !== window.location.pathname + window.location.search) {
          if (globalNextRouter) {
            await globalRefreshShared?.();
            globalNextRouter.push(targetPath, { scroll: !options.preserveScroll });
          } else {
            window.location.href = targetPath;
          }
          options.onSuccess?.({ props: {} });
          emitNavEvent('finish', targetPath, effectiveMethod);
          options.onFinish?.();
          return;
        }
      } catch {
        // ignore and fallback
      }
    }

    let json: any = {};
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      json = await res.json().catch(() => ({}));
    }

    if (!res.ok) {
      const errs: Record<string, string> =
        json.errors && typeof json.errors === 'object'
          ? Object.fromEntries(
              Object.entries(json.errors).map(([k, v]) => [
                k,
                Array.isArray(v) ? String(v[0]) : String(v),
              ])
            )
          : { error: json.error || json.message || `Request failed (${res.status})` };

      if (json.flash && globalSetFlash) {
        globalSetFlash(json.flash);
      } else if (errs.error && globalSetFlash) {
        globalSetFlash({ error: errs.error });
      }
      options.onError?.(errs);
      emitNavEvent('error', url, effectiveMethod);
      emitNavEvent('finish', url, effectiveMethod);
      options.onFinish?.();
      return;
    }

    if (json.external_url) {
      window.location.href = json.external_url;
      return;
    }

    if (json.flash && globalSetFlash) {
      globalSetFlash(json.flash);
    } else if (json.success_message && globalSetFlash) {
      globalSetFlash({ success: json.success_message });
    } else if (json.message && typeof json.message === 'string' && globalSetFlash) {
      globalSetFlash({ success: json.message, message: json.message });
    } else if (json.bankTransfer && globalSetFlash) {
      globalSetFlash({ bankTransfer: json.bankTransfer });
    }

    if (json.redirect) {
      if (json.hard_redirect) {
        window.location.href = json.redirect;
        return;
      }
      if (globalNextRouter) {
        await globalRefreshShared?.();
        globalNextRouter.push(json.redirect, { scroll: !options.preserveScroll });
        globalNextRouter.refresh();
      } else {
        window.location.href = json.redirect;
      }
    } else {
      await globalRefreshShared?.();
      globalNextRouter?.refresh();
    }

    options.onSuccess?.({ props: json });
    emitNavEvent('finish', url, effectiveMethod);
    options.onFinish?.();
  } catch (err: any) {
    const errs = { error: err?.message || 'Network error' };
    options.onError?.(errs);
    emitNavEvent('error', url, effectiveMethod);
    emitNavEvent('finish', url, effectiveMethod);
    options.onFinish?.();
  }
}

export const router = {
  visit(url: string, options: VisitOptions = {}) {
    return performRequest(options.method || 'get', url, options.data, options);
  },
  get(url: string, data?: any, options: VisitOptions = {}) {
    return performRequest('get', url, data, options);
  },
  post(url: string, data?: any, options: VisitOptions = {}) {
    return performRequest('post', url, data, options);
  },
  put(url: string, data?: any, options: VisitOptions = {}) {
    return performRequest('put', url, data, options);
  },
  patch(url: string, data?: any, options: VisitOptions = {}) {
    return performRequest('patch', url, data, options);
  },
  delete(url: string, options: VisitOptions = {}) {
    return performRequest('delete', url, options.data, options);
  },
  reload(options: VisitOptions = {}) {
    options.onStart?.();
    emitNavEvent('start');
    Promise.resolve(globalRefreshShared?.()).finally(() => {
      globalNextRouter?.refresh();
      options.onSuccess?.({ props: {} });
      emitNavEvent('finish');
      options.onFinish?.();
    });
  },
  on(event: NavEventType, listener: NavListener): () => void {
    if (!navListeners[event]) navListeners[event] = new Set();
    navListeners[event].add(listener);
    return () => {
      navListeners[event]?.delete(listener);
    };
  },
};

// Shared Page Context (replaces Inertia usePage)
export interface SharedAppProps {
  csrf_token?: string;
  isDemo?: boolean;
  flash: {
    success?: string | null;
    error?: string | null;
    message?: string | null;
    bankTransfer?: any;
  };
  auth: {
    user: any | null;
  };
  recentProjects: any[] | null;
  appSettings: Record<string, any>;
  hasUpgradablePlans: boolean;
  translations: Record<string, string>;
  locale: {
    current: string;
    isRtl: boolean;
    available: Array<{
      code: string;
      country_code: string | null;
      name: string;
      native_name: string;
      is_rtl: boolean;
    }>;
  };
  broadcastConfig: any | null;
  userCredits: {
    remaining: number;
    monthlyLimit: number;
    isUnlimited: boolean;
    usingOwnKey: boolean;
  } | null;
  unreadNotificationCount: number;
  impersonating: true | null;
  errors?: Record<string, string>;
  [key: string]: any;
}

interface PageContextValue {
  props: SharedAppProps;
  url: string;
  setFlash: (flash: Partial<SharedAppProps['flash']>) => void;
  refreshShared: () => Promise<void>;
}

const PageContext = createContext<PageContextValue | null>(null);

export function AppPageProvider({
  initialProps,
  children,
}: {
  initialProps: SharedAppProps;
  children: ReactNode;
}) {
  const nextRouter = useNextRouter();
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const [sharedProps, setSharedProps] = useState<SharedAppProps>(initialProps);

  useEffect(() => {
    setSharedProps((prev) => ({
      ...initialProps,
      flash: prev.flash?.success || prev.flash?.error || prev.flash?.bankTransfer ? prev.flash : initialProps.flash,
    }));
  }, [initialProps]);

  const setFlash = useCallback((flash: Partial<SharedAppProps['flash']>) => {
    setSharedProps((prev) => ({
      ...prev,
      flash: { ...prev.flash, ...flash },
    }));
  }, []);

  const refreshShared = useCallback(async () => {
    try {
      const res = await fetch('/api/app-context', { credentials: 'same-origin' });
      if (res.ok) {
        const fresh = await res.json();
        setSharedProps((prev) => ({
          ...prev,
          ...fresh,
          flash: prev.flash,
        }));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    globalNextRouter = nextRouter;
    globalSetFlash = setFlash;
    globalRefreshShared = refreshShared;
    return () => {
      if (globalNextRouter === nextRouter) globalNextRouter = null;
    };
  }, [nextRouter, setFlash, refreshShared]);

  // Real-time synchronization of theme, title, and metadata to DOM when sharedProps change
  useEffect(() => {
    if (typeof document === 'undefined' || !sharedProps.appSettings) return;
    const settings = sharedProps.appSettings;
    if (settings.color_theme) {
      document.documentElement.setAttribute('data-theme', settings.color_theme);
    }
    if (settings.site_name) {
      (window as any).__APP_NAME__ = settings.site_name;
    }
  }, [sharedProps.appSettings]);

  // Real-time Pusher listener for immediate setting updates across all client sessions
  useEffect(() => {
    const key = sharedProps.appSettings?.pusher_key || process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = sharedProps.appSettings?.pusher_cluster || process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'mt1';
    if (!key || typeof window === 'undefined') return;

    let pusherInstance: any = null;
    let channel: any = null;

    import('pusher-js')
      .then(({ default: Pusher }) => {
        pusherInstance = new Pusher(key, { cluster });
        channel = pusherInstance.subscribe('public-system');
        channel.bind('settings.updated', () => {
          refreshShared();
          nextRouter?.refresh();
        });
      })
      .catch(() => {});

    return () => {
      if (channel) channel.unbind_all();
      if (pusherInstance) pusherInstance.disconnect();
    };
  }, [sharedProps.appSettings?.pusher_key, sharedProps.appSettings?.pusher_cluster, refreshShared, nextRouter]);

  // Global Radix DropdownMenu popper reposition fix (ported from Install/resources/js/bootstrap.ts)
  useEffect(() => {
    const handleClick = () => {
      requestAnimationFrame(() => {
        const wrappers = document.querySelectorAll<HTMLElement>(
          '[data-radix-popper-content-wrapper]'
        );
        wrappers.forEach((el) => {
          const style = el.style.transform || '';
          if (style.includes('-200%')) {
            el.style.transform = 'translate(0px, 0px)';
          }
        });
      });
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  const qs = searchParams?.toString();
  const url = qs ? `${pathname}?${qs}` : pathname;

  return (
    <PageContext.Provider value={{ props: sharedProps, url, setFlash, refreshShared }}>
      {children}
    </PageContext.Provider>
  );
}

export function usePage<T extends Record<string, any> = SharedAppProps>(): {
  props: T & SharedAppProps;
  url: string;
} {
  const ctx = useContext(PageContext);
  if (!ctx) {
    return {
      props: {
        flash: {},
        auth: { user: null },
        recentProjects: null,
        appSettings: {},
        hasUpgradablePlans: false,
        translations: {},
        locale: { current: 'en', isRtl: false, available: [] },
        broadcastConfig: null,
        userCredits: null,
        unreadNotificationCount: 0,
        impersonating: null,
      } as any,
      url: '/',
    };
  }
  return { props: ctx.props as T & SharedAppProps, url: ctx.url };
}

// Drop-in Head component (sets document.title cleanly)
export function Head({ title, children }: { title?: string; children?: ReactNode }) {
  const { props } = usePage();
  const siteName = props.appSettings?.site_name || 'Crevo';
  useEffect(() => {
    if (title) {
      document.title = `${title} - ${siteName}`;
    }
  }, [title, siteName]);
  return <>{children}</>;
}

// Drop-in Link component supporting Inertia's method="post" as="button"
export interface InertiaLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  method?: 'get' | 'post' | 'put' | 'patch' | 'delete';
  data?: Record<string, any>;
  as?: 'a' | 'button';
  preserveScroll?: boolean;
  preserveState?: boolean;
  replace?: boolean;
  prefetch?: boolean;
}

export function Link({
  href,
  method = 'get',
  data,
  as = 'a',
  preserveScroll,
  preserveState,
  replace,
  onClick,
  children,
  className,
  ...rest
}: InertiaLinkProps) {
  const lowerMethod = (method || 'get').toLowerCase() as VisitOptions['method'];

  if (as === 'button' || lowerMethod !== 'get') {
    const handleAction = (e: React.MouseEvent<any>) => {
      e.preventDefault();
      onClick?.(e);
      if (!e.defaultPrevented) {
        router.visit(href, {
          method: lowerMethod,
          data,
          preserveScroll,
          preserveState,
          replace,
        });
      }
    };
    if (as === 'button') {
      return (
        <button
          type="button"
          onClick={handleAction}
          className={className}
          {...(rest as any)}
        >
          {children}
        </button>
      );
    }
    return (
      <a href={href} onClick={handleAction} className={className} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <NextLink
      href={href as LinkProps['href']}
      replace={replace}
      scroll={!preserveScroll}
      onClick={onClick}
      className={className}
      {...rest}
    >
      {children}
    </NextLink>
  );
}

// Drop-in useForm hook mirroring @inertiajs/react useForm
export function useForm<TForm extends Record<string, any>>(initialValues: TForm) {
  const initialRef = useRef<TForm>(initialValues);
  const [data, setDataState] = useState<TForm>(initialValues);
  const [errors, setErrorsState] = useState<Partial<Record<keyof TForm | string, string>>>({});
  const [processing, setProcessing] = useState(false);
  const [recentlySuccessful, setRecentlySuccessful] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const transformRef = useRef<((d: TForm) => any) | null>(null);

  const setData = useCallback(
    (
      keyOrUpdater: keyof TForm | Partial<TForm> | ((prev: TForm) => TForm),
      value?: any
    ) => {
      setIsDirty(true);
      if (typeof keyOrUpdater === 'function') {
        setDataState((prev) => keyOrUpdater(prev));
      } else if (typeof keyOrUpdater === 'object' && keyOrUpdater !== null) {
        setDataState((prev) => ({ ...prev, ...keyOrUpdater }));
      } else {
        setDataState((prev) => ({ ...prev, [keyOrUpdater]: value }));
      }
    },
    []
  );

  const reset = useCallback((...fields: (keyof TForm)[]) => {
    if (fields.length === 0) {
      setDataState(initialRef.current);
      setIsDirty(false);
    } else {
      setDataState((prev) => {
        const next = { ...prev };
        for (const f of fields) {
          next[f] = initialRef.current[f];
        }
        return next;
      });
    }
  }, []);

  const clearErrors = useCallback((...fields: (keyof TForm | string)[]) => {
    if (fields.length === 0) {
      setErrorsState({});
    } else {
      setErrorsState((prev) => {
        const next = { ...prev };
        for (const f of fields) delete next[f];
        return next;
      });
    }
  }, []);

  const setError = useCallback(
    (fieldOrErrors: keyof TForm | string | Record<string, string>, value?: string) => {
      if (typeof fieldOrErrors === 'object') {
        setErrorsState((prev) => ({ ...prev, ...fieldOrErrors }));
      } else {
        setErrorsState((prev) => ({ ...prev, [fieldOrErrors]: value || '' }));
      }
    },
    []
  );

  const transform = useCallback((cb: (d: TForm) => any) => {
    transformRef.current = cb;
  }, []);

  const submit = useCallback(
    (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, options: VisitOptions = {}) => {
      setProcessing(true);
      setErrorsState({});
      const payload = transformRef.current ? transformRef.current(data) : data;
      return performRequest(method, url, payload, {
        ...options,
        onSuccess: (page) => {
          setRecentlySuccessful(true);
          setIsDirty(false);
          setTimeout(() => setRecentlySuccessful(false), 2000);
          options.onSuccess?.(page);
        },
        onError: (errs) => {
          setErrorsState(errs as any);
          options.onError?.(errs);
        },
        onFinish: () => {
          setProcessing(false);
          options.onFinish?.();
        },
      });
    },
    [data]
  );

  return {
    data,
    setData,
    errors,
    hasErrors: Object.keys(errors).length > 0,
    processing,
    recentlySuccessful,
    isDirty,
    reset,
    clearErrors,
    setError,
    transform,
    submit,
    get: (url: string, options?: VisitOptions) => submit('get', url, options),
    post: (url: string, options?: VisitOptions) => submit('post', url, options),
    put: (url: string, options?: VisitOptions) => submit('put', url, options),
    patch: (url: string, options?: VisitOptions) => submit('patch', url, options),
    delete: (url: string, options?: VisitOptions) => submit('delete', url, options),
  };
}
