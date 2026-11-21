'use client';

import dynamic from 'next/dynamic';
import { usePage } from '@/lib/inertia-compat';
import type { PageProps } from '@/types';

const Privacy = dynamic(() => import('@/Pages/Legal/Privacy'), { ssr: false });

export default function PrivacyPage() {
  const { props } = usePage<PageProps>();

  return (
    <Privacy
      {...(props as any)}
      canLogin={true}
      canRegister={Boolean(props.appSettings?.enable_registration ?? true)}
    />
  );
}
