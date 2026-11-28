import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFollowUpEditIntent,
  buildFollowUpPreservationDirective,
  stripSystemMarkersFromPrompt,
} from './edit-intent';

test('classifyFollowUpEditIntent defaults to strict logo & UI preservation for targeted requests', () => {
  const cases = [
    'Add a testimonials section below pricing',
    'Fix the login button so it saves user details to Firebase',
    'Add menstrual cycle logging with calendar view',
    'Change the submit button text to Save Entry',
    'Make the pricing cards slightly wider',
    'Add a new FAQ page and link it in the footer',
    'Redesign the pricing card to show monthly and yearly toggle',
  ];

  for (const prompt of cases) {
    const intent = classifyFollowUpEditIntent(prompt);
    assert.equal(intent.wantsLogoChange, false, `Expected wantsLogoChange=false for: ${prompt}`);
    assert.equal(intent.wantsFullRedesign, false, `Expected wantsFullRedesign=false for: ${prompt}`);
    assert.equal(intent.wantsThemeChange, false, `Expected wantsThemeChange=false for: ${prompt}`);
  }
});

test('classifyFollowUpEditIntent detects explicit logo changes and respects explicit logo-keep negations', () => {
  assert.equal(classifyFollowUpEditIntent('Change the logo to a minimalist leaf icon').wantsLogoChange, true);
  assert.equal(classifyFollowUpEditIntent('Replace the logo with this uploaded image').wantsLogoChange, true);
  assert.equal(classifyFollowUpEditIntent('Use a new logo in the navbar').wantsLogoChange, true);
  assert.equal(classifyFollowUpEditIntent('Remove the logo from the header').wantsLogoChange, true);

  // Explicit negations must keep wantsLogoChange=false
  assert.equal(classifyFollowUpEditIntent("Don't change the logo, just add a dark mode toggle").wantsLogoChange, false);
  assert.equal(classifyFollowUpEditIntent('Keep the existing logo and update the hero text').wantsLogoChange, false);
});

test('classifyFollowUpEditIntent distinguishes whole-app redesigns from single-section redesigns', () => {
  assert.equal(classifyFollowUpEditIntent('Redesign the entire app with a modern minimalist style').wantsFullRedesign, true);
  assert.equal(classifyFollowUpEditIntent('Start over from scratch with a completely new website').wantsFullRedesign, true);
  assert.equal(classifyFollowUpEditIntent('Overhaul the whole UI layout').wantsFullRedesign, true);

  // Scoped redesign of one section must NOT unlock full-app rewrite
  assert.equal(classifyFollowUpEditIntent('Redesign the footer section').wantsFullRedesign, false);
  assert.equal(classifyFollowUpEditIntent('Revamp the hero section copy').wantsFullRedesign, false);
  assert.equal(classifyFollowUpEditIntent("Don't change the entire UI, only fix the form").wantsFullRedesign, false);
});

test('classifyFollowUpEditIntent detects explicit global theme/color requests without triggering full redesign', () => {
  const intent = classifyFollowUpEditIntent('Change the color palette to warm emerald green');
  assert.equal(intent.wantsThemeChange, true);
  assert.equal(intent.wantsFullRedesign, false);
  assert.equal(intent.wantsLogoChange, false);
});

test('stripSystemMarkersFromPrompt prevents injected system notes from causing false logo/redesign triggers', () => {
  const promptWithNotes =
    'Fix the save button on the profile page\n\n[Follow-Up Edit Mode — Strict Logo & UI Preservation]\nDO NOT change the logo or redesign the entire app.';
  assert.equal(stripSystemMarkersFromPrompt(promptWithNotes), 'Fix the save button on the profile page');

  const intent = classifyFollowUpEditIntent(promptWithNotes);
  assert.equal(intent.wantsLogoChange, false);
  assert.equal(intent.wantsFullRedesign, false);
});

test('buildFollowUpPreservationDirective locks logo, UI, and theme on routine follow-ups', () => {
  const directive = buildFollowUpPreservationDirective('Add a search bar to the dashboard');
  assert.ok(directive.includes('LOCKED LOGO & BRAND IDENTITY'));
  assert.ok(directive.includes('PRESERVE ENTIRE EXISTING UI & LAYOUT'));
  assert.ok(directive.includes('PRESERVE GLOBAL THEME & FONTS'));
  assert.ok(directive.includes('100% FUNCTIONAL BUTTONS, CTAs & MENU LINKS'));

  const logoUpdateDirective = buildFollowUpPreservationDirective('Replace the logo with the attached file');
  assert.ok(logoUpdateDirective.includes('LOGO UPDATE REQUESTED'));
  assert.ok(logoUpdateDirective.includes('PRESERVE ENTIRE EXISTING UI & LAYOUT'));
});
