import { redirect } from 'next/navigation';
import VerifyEmail from '@/Pages/Auth/VerifyEmail';
import { getSessionContext, hasVerifiedEmail } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sessionCtx = await getSessionContext();
  if (!sessionCtx?.user) {
    redirect('/login');
  }

  if (await hasVerifiedEmail(sessionCtx.user)) {
    redirect('/create');
  }

  const sp = await searchParams;
  return <VerifyEmail status={sp.status} />;
}
