/**
 * Keeps the two languages honest.
 *
 * The expensive failure mode for a bilingual project is not a missing
 * translation, it is a translation that silently falls back to English for
 * months without anyone noticing. This catches it at build time.
 */
import { describe, expect, it } from 'vitest';
import { en } from '../src/content/en';
import { fr } from '../src/content/fr';

describe('the French and English dictionaries', () => {
  it('cover exactly the same keys', () => {
    const missingInFrench = Object.keys(en).filter((key) => !(key in fr));
    const missingInEnglish = Object.keys(fr).filter((key) => !(key in en));
    expect(missingInFrench).toEqual([]);
    expect(missingInEnglish).toEqual([]);
  });

  it('keep the same placeholders in both languages', () => {
    for (const key of Object.keys(en)) {
      const placeholders = (text: string) => (text.match(/\{[a-z]+\}/g) ?? []).sort();
      expect(placeholders(fr[key]!), key).toEqual(placeholders(en[key]!));
    }
  });

  it('never leave a value empty', () => {
    for (const [key, value] of Object.entries({ ...en, ...fr })) {
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });
});
