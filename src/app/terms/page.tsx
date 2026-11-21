'use client';

import dynamic from 'next/dynamic';
import { usePage } from '@/lib/inertia-compat';
import type { PageProps } from '@/types';

const Terms = dynamic(() => import('@/Pages/Legal/Terms'), { ssr: false });

export default function TermsPage() {
  const { props } = usePage<PageProps>();

  return (
    <Terms
      {...(props as any)}
      canLogin={true}
      canRegister={Boolean(props.appSettings?.enable_registration ?? true)}
    />
  );
}
