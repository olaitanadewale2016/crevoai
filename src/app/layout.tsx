import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { getSharedAppProps } from '@/services/shared-context';
import { AppProviders } from '@/components/AppProviders';
import { getAssetUrl } from '@/lib/assets';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const shared = await getSharedAppProps();
  const siteName = shared.appSettings?.site_name || 'Crevo';
  const siteDescription = shared.appSettings?.site_description || '';
  const favicon = shared.appSettings?.site_favicon
    ? getAssetUrl(shared.appSettings.site_favicon)
    : '/favicon.ico';

  return {
    title: {
      default: siteName,
      template: `%s - ${siteName}`,
    },
    description: siteDescription || undefined,
    icons: {
      icon: favicon || '/favicon.ico',
      shortcut: favicon || '/favicon.ico',
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const sharedProps = await getSharedAppProps();
  const siteName = sharedProps.appSettings?.site_name || 'Crevo';
  const defaultTheme = sharedProps.appSettings?.default_theme || 'system';
  const colorTheme = sharedProps.appSettings?.color_theme || 'neutral';
  const locale = sharedProps.locale?.current || 'en';
  const isRtl = Boolean(sharedProps.locale?.isRtl);

  const antiFoucScript = `
    (function() {
      try {
        var defaultTheme = ${JSON.stringify(defaultTheme)};
        var theme = localStorage.getItem('app-theme') || defaultTheme;
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (theme === 'dark' || (theme === 'system' && prefersDark)) {
          document.documentElement.classList.add('dark');
        }
        var isRtl = localStorage.getItem('app-locale-rtl') === 'true';
        if (isRtl) {
          document.documentElement.dir = 'rtl';
        }
        window.__APP_NAME__ = ${JSON.stringify(siteName)};
      } catch (e) {}
    })();
  `;

  return (
    <html
      lang={locale.replace('_', '-')}
      dir={isRtl ? 'rtl' : 'ltr'}
      data-theme={colorTheme}
      className={inter.variable}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: antiFoucScript }} />
      </head>
      <body className="font-sans antialiased">
        <AppProviders initialProps={sharedProps}>{children}</AppProviders>
      </body>
    </html>
  );
}
