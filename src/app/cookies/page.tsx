'use client';

import dynamic from 'next/dynamic';
import { usePage } from '@/lib/inertia-compat';
import type { PageProps } from '@/types';

const Cookies = dynamic(() => import('@/Pages/Legal/Cookies'), { ssr: false });

export default function CookiesPage() {
  const { props } = usePage<PageProps>();

  return (
    <Cookies
      {...(props as any)}
      canLogin={true}
      canRegister={Boolean(props.appSettings?.enable_registration ?? true)}
    />
  );
}
