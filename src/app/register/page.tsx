import { redirect } from 'next/navigation';
import Register from '@/Pages/Auth/Register';
import { getSessionContext } from '@/lib/auth';
import { getSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const sessionCtx = await getSessionContext();
  if (sessionCtx?.user) {
    redirect('/create');
  }

  const registrationEnabled = await getSetting<boolean>('enable_registration', true);
  if (!registrationEnabled) {
    redirect('/login?error=Registration+is+currently+disabled.');
  }

  return <Register />;
}
