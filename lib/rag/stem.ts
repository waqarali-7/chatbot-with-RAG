/**
 * Porter stemmer, condensed. Standard IR preprocessing rather than anything
 * tuned to this corpus: it ties price/pricing, cancel/cancellation and
 * examine/examination, which a 5-character truncation does not.
 */
const C = '[^aeiou]';
const V = '[aeiouy]';
const CC = `(?:${C})(?:[^aeiouy])*`;
const VV = `(?:${V})(?:[aeiou])*`;
const MGR0 = new RegExp(`^(?:${CC})?(?:${VV})(?:${CC})`);
const MEQ1 = new RegExp(`^(?:${CC})?(?:${VV})(?:${CC})(?:${VV})?$`);
const MGR1 = new RegExp(`^(?:${CC})?(?:${VV})(?:${CC})(?:${VV})(?:${CC})`);
const HAS_VOWEL = new RegExp(`^(?:${CC})?${V}`);

const STEP2: Record<string, string> = {
  ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize', bli: 'ble',
  alli: 'al', entli: 'ent', eli: 'e', ousli: 'ous', ization: 'ize', ation: 'ate',
  ator: 'ate', alism: 'al', iveness: 'ive', fulness: 'ful', ousness: 'ous',
  aliti: 'al', iviti: 'ive', biliti: 'ble', logi: 'log',
};
const STEP3: Record<string, string> = {
  icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic', ful: '', ness: '',
};
const STEP4 = /^(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;

export function stem(w: string): string {
  if (w.length < 3) return w;
  let word = w;

  if (word.startsWith('y')) word = 'Y' + word.slice(1);

  // Step 1a
  if (/sses$|ies$/.test(word)) word = word.slice(0, -2);
  else if (/ss$/.test(word)) { /* keep */ }
  else if (/s$/.test(word)) word = word.slice(0, -1);

  // Step 1b
  if (/eed$/.test(word)) {
    const s = word.slice(0, -3);
    if (MGR0.test(s)) word = word.slice(0, -1);
  } else {
    const m = /^(.*)(ed|ing)$/.exec(word);
    if (m && HAS_VOWEL.test(m[1])) {
      word = m[1];
      if (/(at|bl|iz)$/.test(word)) word += 'e';
      else if (/([^aeiouylsz])\1$/.test(word)) word = word.slice(0, -1);
      else if (new RegExp(`^${CC}${V}[^aeiouwxy]$`).test(word)) word += 'e';
    }
  }

  // Step 1c
  const m1c = /^(.*)y$/.exec(word);
  if (m1c && HAS_VOWEL.test(m1c[1])) word = m1c[1] + 'i';

  // Step 2
  const m2 = /^(.*?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/.exec(word);
  if (m2 && MGR0.test(m2[1])) word = m2[1] + STEP2[m2[2]];

  // Step 3
  const m3 = /^(.*?)(icate|ative|alize|iciti|ical|ful|ness)$/.exec(word);
  if (m3 && MGR0.test(m3[1])) word = m3[1] + STEP3[m3[2]];

  // Step 4
  const m4 = /^(.*?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ism|ate|iti|ous|ive|ize)$/.exec(word)
    ?? /^(.*?)(s|t)(ion)$/.exec(word);
  if (m4) {
    const stemPart = m4.length === 4 ? m4[1] + m4[2] : m4[1];
    const suffix = m4.length === 4 ? m4[3] : m4[2];
    if (MGR1.test(stemPart) && (m4.length === 4 || STEP4.test(suffix))) word = stemPart;
  }

  // Step 5
  const m5 = /^(.*)e$/.exec(word);
  if (m5) {
    const s = m5[1];
    if (MGR1.test(s) || (MEQ1.test(s) && !new RegExp(`^${CC}${V}[^aeiouwxy]$`).test(s))) word = s;
  }
  if (/ll$/.test(word) && MGR1.test(word.slice(0, -1))) word = word.slice(0, -1);

  return word.toLowerCase();
}
