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
  const defaultTheme =
    initialProps.appSettings?.default_theme === 'light' ||
    initialProps.appSettings?.default_theme === 'dark' ||
    initialProps.appSettings?.default_theme === 'system'
      ? initialProps.appSettings.default_theme
      : 'system';

  return (
    <ThemeProvider defaultTheme={defaultTheme}>
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
