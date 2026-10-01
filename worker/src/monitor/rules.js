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
export function canonical(input, base) {
  try {
    const url = new URL(input, base);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}
export function canPublish(row, version, itemHash) {
  return !!row && row.version === version && row.edited === 1 && !!row.draft?.trim() && row.basis_hash === itemHash;
}
