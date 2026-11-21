import { redirect } from 'next/navigation';
import ForgotPassword from '@/Pages/Auth/ForgotPassword';
import { getSessionContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sessionCtx = await getSessionContext();
  if (sessionCtx?.user) {
    redirect('/create');
  }

  const sp = await searchParams;
  return <ForgotPassword status={sp.status} />;
}
