import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionContext, getUserCurrentPlan } from '@/lib/auth';
import { getProjectFirebaseConfig } from '@/lib/firebase-admin';
import { Project } from '@/models/Project';
import { getChatFollowUpSuggestions } from '@/services/internal-ai';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ project: string }> }
) {
  const { project: projectId } = await props.params;
  const ctx = await getSessionContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  await connectDB();
  const project = await Project.findOne({
    _id: projectId,
    user_id: ctx.user._id,
  });

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const historyList = (project.conversation_history || []) as Array<{ role: string; content: string }>;
  const lastAssistantMsg = historyList
    .filter((m) => m.role === 'assistant')
    .slice(-1)[0]?.content || '';
  const isStorageClarification =
    /\?/.test(lastAssistantMsg) &&
    /\b(?:firebase|supabase|localstorage|local\s+storage|database|backend)\b/i.test(
      lastAssistantMsg
    );

  if (isStorageClarification) {
    const [plan, firebaseCfg] = await Promise.all([
      getUserCurrentPlan(ctx.user),
      getProjectFirebaseConfig(project).catch(() => null),
    ]);
    const canFirebase = Boolean(ctx.user.role === 'admin' || plan?.enable_firebase);
    const canSupabase = Boolean(
      ctx.user.role === 'admin' || plan?.enable_firebase || plan?.enable_supabase
    );
    const storageChoices: string[] = [
      'Use localStorage (interactive demo — start building now)',
    ];
    if (project.supabase_config) {
      storageChoices.push('Use my connected Supabase database (start building)');
    } else if (canSupabase) {
      storageChoices.push("I'll connect Supabase in Settings -> Database first");
    }
    if (firebaseCfg) {
      storageChoices.push('Use Firebase Firestore & Auth (start building)');
    } else if (canFirebase) {
      storageChoices.push("I'll connect Firebase in Settings -> Database first");
    }
    if (storageChoices.length < 3) {
      storageChoices.push('Use custom REST API / backend hooks');
    }
    return NextResponse.json({ suggestions: storageChoices.slice(0, 3) });
  }

  const suggestions = await getChatFollowUpSuggestions(
    project.conversation_history || [],
    3
  );

  let finalSuggestions = suggestions && Array.isArray(suggestions) && suggestions.length > 0 ? [...suggestions] : [];

  // Reliable contextual fallback so users ALWAYS get relevant actionable next-step suggestions
  if (finalSuggestions.length < 3) {
    const lastUserMsg = historyList
      .filter((m) => m.role === 'user')
      .slice(-1)[0]?.content?.toLowerCase() || '';
    const projectName = (project.name || '').toLowerCase();

    const contextualPool: string[] = [];
    if (
      /\b(?:facebook|social|feed|community|post|comment|chat|forum)\b/.test(
        `${lastUserMsg} ${projectName}`
      )
    ) {
      contextualPool.push(
        'Add Stories bar & story viewer modal',
        'Add notifications & friend requests view',
        'Add Messenger-style direct chat drawer',
        'Connect persistent database in Settings -> Database'
      );
    } else if (lastUserMsg.includes('task') || lastUserMsg.includes('todo') || projectName.includes('task')) {
      contextualPool.push(
        'Add task priority filter (High, Med, Low)',
        'Add due date reminders and calendar view',
        'Add category tags and status labels',
        'Add celebratory confetti on task complete'
      );
    } else if (lastUserMsg.includes('store') || lastUserMsg.includes('shop') || lastUserMsg.includes('cart') || projectName.includes('shop')) {
      contextualPool.push(
        'Add shopping cart checkout modal',
        'Add product search and price filter',
        'Add customer star reviews section',
        'Add discount promo code banner'
      );
    } else if (lastUserMsg.includes('portfolio') || lastUserMsg.includes('agency') || projectName.includes('portfolio')) {
      contextualPool.push(
        'Add interactive project showcase modal',
        'Add client testimonials slider',
        'Add contact inquiry form with validation',
        'Add resume download button'
      );
    } else if (lastUserMsg.includes('restaurant') || lastUserMsg.includes('cafe') || lastUserMsg.includes('food')) {
      contextualPool.push(
        'Add online table reservation form',
        'Create menu with dietary tag filters',
        'Add business hours and Google map card',
        'Showcase chef special dishes'
      );
    } else {
      contextualPool.push(
        'Add dark mode theme toggle',
        'Create responsive contact section',
        'Add customer testimonial cards',
        'Improve typography and hero spacing',
        'Add smooth page transition animations'
      );
    }

    for (const item of contextualPool) {
      if (!finalSuggestions.includes(item) && finalSuggestions.length < 3) {
        finalSuggestions.push(item);
      }
    }
  }

  return NextResponse.json({ suggestions: finalSuggestions });
}
