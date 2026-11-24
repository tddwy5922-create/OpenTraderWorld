/**
 * Plain-label translation for the two places the app still ships English in code:
 * the module registry (`name`), the dashboard workspace presets (`name`) and the
 * dashboard widget registry (`label`, `blurb`, `variants[].label`).
 *
 * Everything else renders through `$t('some.key')`; these are registry constants that
 * have no key of their own, so they are looked up here by their English text.
 *
 * Only `zh` has a table. Any other locale, and any string missing from the table, keeps
 * the English it came with — a partial translation is never worse than no translation.
 */
import { get } from 'svelte/store';
import { locale } from './index.js';
import zh from './labels.zh.json';

const GROUPS = [
  'module_names',
  'workspace_names',
  'widget_labels',
  'widget_blurbs',
  'widget_subtitles',
  'variant_labels'
];

/** Translate a registry label for the active locale. */
export function labelOf(text) {
  if (!text) return text;
  if (get(locale) !== 'zh') return text;
  for (const g of GROUPS) {
    const hit = zh[g]?.[text];
    if (hit) return hit;
  }
  return text;
}
