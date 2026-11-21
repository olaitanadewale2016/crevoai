'use client';

import React, { ReactNode, Suspense } from 'react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { AppPageProvider, SharedAppProps } from '@/lib/inertia-compat';
import { ReCaptchaProvider } from '@/components/Auth/ReCaptchaProvider';
import ImpersonationBanner from '@/components/ImpersonationBanner';
import CookieConsentBanner from '@/components/CookieConsentBanner';

export function AppProviders({
  initialProps,
  children,
}: {
  initialProps: SharedAppProps;
  children: ReactNode;
}) {
  return (
    <ThemeProvider>
      <Suspense fallback={null}>
        <AppPageProvider initialProps={initialProps}>
          <LanguageProvider>
            <ReCaptchaProvider>
              <ImpersonationBanner />
              {children}
              <CookieConsentBanner />
            </ReCaptchaProvider>
          </LanguageProvider>
        </AppPageProvider>
      </Suspense>
    </ThemeProvider>
  );
}
