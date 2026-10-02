export const RULE_VERSION = '2026-10-01.1';
export const PROJECT = ['yntegra', 'sampson cay', 'rosewood exuma', 'turtlegrass'];
export const RULES = {
  Consultation: ['consultation', 'consult', 'community support', 'job sign-up', 'job sign up', 'abysmal failure'],
  'Solar farm': ['solar farm', 'salami slicing', 'salami-slicing', 'piecemeal', 'piece-meal'],
  Environment: ['mangrove', 'wholly inadequate', 'ecology', 'biodiversity', 'environmental impact', 'depp', 'eia'],
  Infrastructure: ['seawall', '390-foot', 'service dock', 'dredging', 'tidal flow', 'barge', 'limestone'],
  Employment: ['employment', 'jobs', 'training', 'bamsi', 'btvi', 'university of the bahamas'],
  'Court proceedings': ['judicial review', 'farquharson', 'supreme court', 'interlocutory', 'stay of proceedings', 'court of appeal']
};
export const normalize = text => text.toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
export function classify(text) {
  const value = normalize(text);
  if (!PROJECT.some(term => value.includes(term))) return [];
  return Object.entries(RULES).flatMap(([theme, terms]) => {
    const matched = terms.filter(term => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(value));
    return matched.length ? [{theme, matched, ruleVersion: RULE_VERSION}] : [];
  });
}
export function isCriticismEvidence(sourceId, tags, content) {
  return criticismThemes(sourceId, tags, content).length > 0;
}
export function criticismThemes(sourceId, tags, content) {
  if (sourceId === 'project') return [];
  const themes = Array.isArray(tags) ? tags.filter(tag => String(tag?.theme || '').trim()) : [];
  if (!themes.length) return [];
  const knownOpposition = new Set(['turtlegrass', 'sea', 'save-exuma', 'save_exuma', 'over-yonder', 'over_yonder']);
  if (knownOpposition.has(sourceId)) return themes.map(tag => tag.theme);
  const value = normalize(content || '');
  const signals = [
    /\bopposition\b/, /\boppos(?:e|ed|es|ing)\b/, /\bchalleng(?:e|ed|es|ing)\b/,
    /\bcritic(?:al(?:ly)?|s|ism|ized|ised|ize|ise|izing|ising)?\b/,
    /\balleg(?:e|ed|es|ing|ation|ations)\b/,
    /\bfail(?:ed|ing|ure|ures|s)?\b/, /\binadequate\b/,
    /\bdestroy(?:ed|s|ing)?\b/, /\bdestruction\b/, /\bharm(?:ed|ful|s|ing)?\b/,
    /\billegal(?:ity)?\b/, /\bunlawful\b/, /\bsalami\b/, /\bpiece[-\s]?meal\b/,
    /\bjudicial\s+review\b/, /\bcourt\s+told\b/, /\bhalt(?:ed|s|ing)?\b/,
    /\bstop(?:ped|s|ping)?\b/, /\breject(?:ed|ion|s|ing)?\b/,
    /\bcontrovers(?:y|ies|ial)\b/
  ];
  return themes.filter(tag => {
    const terms = [...(Array.isArray(tag.matched) ? tag.matched : []), tag.theme]
      .map(term => normalize(String(term || '')))
      .filter(Boolean);
    return terms.some(term => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const plural = term.endsWith('s') ? '' : 's?';
      const matches = value.matchAll(new RegExp(`(^|[^a-z0-9])(${escaped}${plural})(?=$|[^a-z0-9])`, 'g'));
      for (const match of matches) {
        const position = match.index + match[1].length;
        const matchedLength = match[2].length;
        const priorBoundary = Math.max(...['.', '?', '!', ';'].map(mark => value.lastIndexOf(mark, position)));
        const nextBoundaries = ['.', '?', '!', ';'].map(mark => value.indexOf(mark, position + matchedLength)).filter(index => index >= 0);
        const nextBoundary = nextBoundaries.length ? Math.min(...nextBoundaries) + 1 : value.length;
        const context = value.slice(Math.max(priorBoundary + 1, position - 180), Math.min(nextBoundary, position + matchedLength + 180));
        if (signals.some(pattern => pattern.test(context))) return true;
      }
      return false;
    });
  }).map(tag => tag.theme);
}
export function canonical(input, base) {
  try {
    const url = new URL(input, base);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}
export function canPublish(row, version, itemHash, reviewStatus) {
  return reviewStatus === 'reviewed' && !!row && row.version === version && row.edited === 1 && !!row.draft?.trim() && row.basis_hash === itemHash;
}
