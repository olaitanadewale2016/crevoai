import { redirect } from 'next/navigation';
import Login from '@/Pages/Auth/Login';
import { getSessionContext, isDemoMode } from '@/lib/auth';
import { getSharedAppProps } from '@/services/shared-context';
import { AppPageProvider } from '@/lib/inertia-compat';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; message?: string; error?: string }>;
}) {
  const sessionCtx = await getSessionContext();
  if (sessionCtx?.user) {
    redirect('/create');
  }

  const sp = await searchParams;
  const status = sp.status || sp.message || undefined;
  const demoCredentials = isDemoMode()
    ? { email: 'admin@crevo.ai', password: 'password' }
    : null;

  if (sp.error || sp.message) {
    const shared = await getSharedAppProps();
    return (
      <AppPageProvider
        initialProps={{
          ...shared,
          flash: {
            ...shared.flash,
            error: sp.error || shared.flash.error,
            message: sp.message || shared.flash.message,
          },
        }}
      >
        <Login
          status={status}
          canResetPassword={true}
          demoCredentials={demoCredentials}
        />
      </AppPageProvider>
    );
  }

  return (
    <Login
      status={status}
      canResetPassword={true}
      demoCredentials={demoCredentials}
    />
  );
}
