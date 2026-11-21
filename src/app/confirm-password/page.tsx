import { redirect } from 'next/navigation';
import ConfirmPassword from '@/Pages/Auth/ConfirmPassword';
import { getSessionContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ConfirmPasswordPage() {
  const sessionCtx = await getSessionContext();
  if (!sessionCtx?.user) {
    redirect('/login');
  }

  return <ConfirmPassword />;
}
