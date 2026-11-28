export interface FollowUpEditIntent {
  wantsFullRedesign: boolean;
  wantsLogoChange: boolean;
  wantsThemeChange: boolean;
}

const STRIP_SYSTEM_NOTE_MARKERS = [
  '\n\n[Follow-Up Edit Mode',
  '\n\n[Attached Images',
  '\n\n[Attached Files',
  '\n\n[Visual Design Blueprint',
  '\n\n[Firebase Database',
  '\n\n[Project File Storage',
  '\n\n[Supabase Database',
  '\n\n[Admin Internal AI',
  '\n\n[Internal AI Provider',
  '\n\nNOTE: The user has asked',
];

export function stripSystemMarkersFromPrompt(prompt: string): string {
  let clean = (prompt || '').trim();
  for (const marker of STRIP_SYSTEM_NOTE_MARKERS) {
    const idx = clean.indexOf(marker);
    if (idx !== -1) {
      clean = clean.slice(0, idx);
    }
  }
  return clean.trim();
}

const KEEP_LOGO_NEGATION_RE =
  /\b(?:don'?t|do\s+not|never|avoid|without)\s+(?:change|touch|alter|replace|modify|edit|remove|delete|update|mess\s+with)\b[^.!?\n]{0,40}\b(?:logo|brand\s*mark|wordmark)\b|\b(?:keep|preserve|retain|leave)\b[^.!?\n]{0,30}\b(?:the\s+|current\s+|existing\s+)?(?:logo|brand\s*mark|wordmark)\b/i;

const LOGO_CHANGE_RE =
  /\b(?:change|replace|update|swap|redesign|remove|delete|edit|modify|fix|resize|make|add|upload|use|set|put|insert)\b[^.!?\n]{0,45}\b(?:logo|brand\s*mark|wordmark|favicon)\b|\b(?:new|different|custom|updated)\s+(?:logo|brand\s*mark|wordmark|favicon)\b|\blogo\b[^.!?\n]{0,30}\b(?:to|with|into|should\s+be|needs\s+to\s+be|change|replace|update|bigger|smaller|removed)\b/i;

const KEEP_UI_NEGATION_RE =
  /\b(?:don'?t|do\s+not|never)\s+(?:change|redesign|alter|touch|rebuild|rewrite)\b[^.!?\n]{0,40}\b(?:the\s+)?(?:entire|whole|rest\s+of\s+the|existing|current)\s+(?:ui|design|layout|app|site|website|page)\b|\bkeep\s+(?:the\s+)?(?:same|existing|current)\s+(?:ui|design|layout)\b/i;

const FULL_REDESIGN_RE =
  /\b(?:redesign|rebuild|remake|recreate|overhaul|revamp|start\s+over|start\s+from\s+scratch|build\s+from\s+scratch|completely\s+new\s+(?:design|ui|layout|website|app)|change\s+(?:the\s+)?(?:entire|whole)\s+(?:ui|design|layout|app|site|website))\b(?:\s+(?:the\s+)?(?:entire|whole|full|complete)?\s*(?:app|site|website|ui|interface|design|layout|project))?/i;

const SCOPED_REDESIGN_TARGET_RE =
  /\b(?:redesign|revamp|overhaul|rebuild)\s+(?:only\s+)?(?:the\s+|this\s+)?(?:hero|header|navbar|nav|footer|sidebar|card|cards|button|buttons|form|modal|dialog|drawer|pricing|testimonial|testimonials|faq|contact|about|login|signup|profile|settings|calendar|chart|table|banner|section)\b/i;

const THEME_CHANGE_RE =
  /\b(?:change|switch|update|make|set|use)\b[^.!?\n]{0,40}\b(?:color\s*(?:scheme|palette|theme)|theme\s*colors?|brand\s*colors?|primary\s*color|background\s*color|dark\s*theme|light\s*theme|dark\s*mode\s+default|color\s*palette|global\s*(?:colors?|fonts?|typography|theme)|font\s*family|typography)\b|\b(?:retheme|re-theme|new\s+color\s+(?:scheme|palette)|different\s+color\s+(?:scheme|palette))\b/i;

/**
 * Classifies whether a follow-up user prompt explicitly asks to change the logo,
 * redesign the entire UI, or alter global theme colors/fonts.
 * Defaults to strict preservation (all false) so targeted changes never break V1's logo or UI.
 */
export function classifyFollowUpEditIntent(rawPrompt: string): FollowUpEditIntent {
  const prompt = stripSystemMarkersFromPrompt(rawPrompt);
  if (!prompt) {
    return {
      wantsFullRedesign: false,
      wantsLogoChange: false,
      wantsThemeChange: false,
    };
  }

  const keepLogo = KEEP_LOGO_NEGATION_RE.test(prompt);
  const wantsLogoChange = !keepLogo && LOGO_CHANGE_RE.test(prompt);

  const keepUi = KEEP_UI_NEGATION_RE.test(prompt);
  const mentionsFullScope =
    /\b(?:entire|whole|full|complete|everything|all\s+pages|from\s+scratch|start\s+over|completely\s+new|the\s+app|the\s+site|the\s+website|the\s+ui)\b/i.test(
      prompt
    );
  const isScopedRedesignOnly =
    SCOPED_REDESIGN_TARGET_RE.test(prompt) && !mentionsFullScope;
  const wantsFullRedesign =
    !keepUi && !isScopedRedesignOnly && FULL_REDESIGN_RE.test(prompt) && mentionsFullScope;

  const wantsThemeChange = wantsFullRedesign || THEME_CHANGE_RE.test(prompt);

  return {
    wantsFullRedesign,
    wantsLogoChange,
    wantsThemeChange,
  };
}

/**
 * Generates an unmistakable, intent-aware follow-up preservation directive injected
 * on BOTH /builder/projects/[project]/start (for existing apps) and /chat turns.
 */
export function buildFollowUpPreservationDirective(rawPrompt: string): string {
  const intent = classifyFollowUpEditIntent(rawPrompt);

  const rules: string[] = [
    '1. UNDERSTAND THE EXACT USER NEED FIRST: Read the user prompt carefully and identify the exact target (page, section, component, button, logic, or text). Do NOT call fetchTemplates or useTemplate.',
  ];

  if (!intent.wantsLogoChange) {
    rules.push(
      '2. LOCKED LOGO & BRAND IDENTITY: The user did NOT ask to change the logo. Keep the exact existing logo image URL, SVG mark, brand icon, and brand name 100% unchanged everywhere (header, navbar, sidebar, footer, login modal).'
    );
  } else {
    rules.push(
      '2. LOGO UPDATE REQUESTED: Apply the exact logo change requested by the user while keeping the rest of the header, navigation, and app layout intact.'
    );
  }

  if (!intent.wantsFullRedesign) {
    rules.push(
      '3. PRESERVE ENTIRE EXISTING UI & LAYOUT: The user did NOT ask to redesign the whole app. Do NOT rewrite untouched pages, navigation/header/footer structure, layout shells, card styles, or working features. Read ONLY the specific target file(s) with `readFiles` and apply minimal, surgical `editFile` patches.'
    );
  } else {
    rules.push(
      '3. FULL REDESIGN EXPLICITLY REQUESTED: Redesign the UI as requested while preserving existing data wiring and working routes (and keeping the existing logo unless the user asked to change it).'
    );
  }

  if (!intent.wantsThemeChange) {
    rules.push(
      '4. PRESERVE GLOBAL THEME & FONTS: Do NOT modify global color variables or fonts in `src/custom.css` unless strictly necessary for the specific component requested.'
    );
  }

  rules.push(
    '5. 100% FUNCTIONAL BUTTONS, CTAs & MENU LINKS: Every button, CTA, form, and menu/footer link you add or edit MUST be fully wired and functional (working modal/dialog/state + toast, registered React Router `<Link to="...">`, `onSubmit`, or existing `#sectionId` scroll — zero dead buttons or `href="#"` placeholders).'
  );

  return `\n\n[Follow-Up Edit Mode — Strict Logo & UI Preservation]\nAn existing customized version of this app is ALREADY built.\n${rules.join('\n')}`;
}
