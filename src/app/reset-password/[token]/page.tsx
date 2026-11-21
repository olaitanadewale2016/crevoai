import { redirect } from 'next/navigation';
import ResetPassword from '@/Pages/Auth/ResetPassword';
import { getSessionContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ email?: string }>;
}) {
  const sessionCtx = await getSessionContext();
  if (sessionCtx?.user) {
    redirect('/create');
  }

  const [{ token }, sp] = await Promise.all([params, searchParams]);
  return <ResetPassword token={token} email={sp.email || ''} />;
}
