import type { AIVarPreset } from '@/lib/db/schema';

export interface AIVarPresetDef {
  label: string;
  prompt: string;
}

export const AI_VAR_PRESETS: Record<Exclude<AIVarPreset, 'custom'>, AIVarPresetDef> = {
  firstName:           { label: 'First name',           prompt: 'Generate a single realistic first name. Output only the name — no quotes, no punctuation, no commentary.' },
  lastName:            { label: 'Last name',            prompt: 'Generate a single realistic last name. Output only the name — no quotes, no punctuation, no commentary.' },
  middleName:          { label: 'Middle name',          prompt: 'Generate a single realistic middle name. Output only the name — no quotes, no punctuation, no commentary.' },
  fullName:            { label: 'Full name',            prompt: 'Generate a realistic full name (first and last). Output only the name — no quotes, no commentary.' },
  email:               { label: 'Email address',        prompt: 'Generate a realistic but obviously fake email address. Output only the address — no quotes, no commentary.' },
  company:             { label: 'Company name',         prompt: 'Generate a plausible company name. Output only the name — no quotes, no commentary.' },
  jobTitle:            { label: 'Job title',            prompt: 'Generate a plausible job title. Output only the title — no quotes, no commentary.' },
  ukAddress:           { label: 'UK address (1-line)',  prompt: 'Generate a single-line UK postal address (street, town, postcode). Output only the address on one line — no quotes, no commentary.' },
  ukAddressMultiline:  { label: 'UK address (multi)',   prompt: 'Generate a multi-line UK postal address with street, town, county, and postcode separated by newlines. Output only the address — no quotes, no commentary.' },
  usAddress:           { label: 'US address',           prompt: 'Generate a single-line US street address (street, city, state, ZIP). Output only the address — no quotes, no commentary.' },
  ukPhone:             { label: 'UK phone',             prompt: 'Generate a UK mobile phone number in international format (e.g. +44 7xxx xxxxxx). Output only the number — no quotes, no commentary.' },
  usPhone:             { label: 'US phone',             prompt: 'Generate a US phone number in (XXX) XXX-XXXX format. Output only the number — no quotes, no commentary.' },
};

export const AI_VAR_PRESET_KEYS = Object.keys(AI_VAR_PRESETS) as Array<Exclude<AIVarPreset, 'custom'>>;

export function buildAIVarPrompt(v: { aiPreset?: AIVarPreset; aiCustomPrompt?: string }): string {
  if (v.aiPreset === 'custom') return (v.aiCustomPrompt ?? '').trim();
  if (v.aiPreset) return AI_VAR_PRESETS[v.aiPreset].prompt;
  return '';
}

/** Strip surrounding quotes / chat fluff from a single-line AI response. */
export function sanitizeAIVarOutput(raw: string): string {
  let out = (raw ?? '').trim();
  // Drop wrapping quotes (single, double, smart)
  const quotePairs: Array<[string, string]> = [
    ['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['`', '`'],
  ];
  for (const [open, close] of quotePairs) {
    if (out.startsWith(open) && out.endsWith(close) && out.length >= 2) {
      out = out.slice(open.length, out.length - close.length).trim();
      break;
    }
  }
  return out;
}
