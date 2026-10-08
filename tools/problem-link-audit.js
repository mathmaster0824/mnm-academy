'use strict';

/**
 * Pure, read-only link classification. No Firebase SDK, writes or network calls.
 * Resolver must return {exists:true|false} or {error:string}; unknown is not missing.
 */
function classifyLink(record, targets = {}) {
  const canonical = String(record?.problemId || '').trim();
  const draft = String(record?.problemDraftId || '').trim();
  function resolve(kind, id) {
    const entry = targets[kind]?.[id];
    if (!entry || entry.error || typeof entry.exists !== 'boolean') return 'unknown-read-error';
    return entry.exists ? 'exists' : 'missing';
  }
  if (canonical) {
    const state = resolve('problems', canonical);
    if (state === 'exists') return 'linked';
    if (state === 'missing') return 'broken-canonical';
    return 'unknown-read-error';
  }
  if (draft) {
    const state = resolve('problemDrafts', draft);
    if (state === 'exists') return 'candidate';
    if (state === 'missing') return 'broken-draft';
    return 'unknown-read-error';
  }
  return 'unverified';
}

function summarize(records, targets = {}) {
  const counts = {total:0,linked:0,candidate:0,'broken-canonical':0,'broken-draft':0,unverified:0,'unknown-read-error':0};
  for (const record of records) {
    counts.total++;
    counts[classifyLink(record, targets)]++;
  }
  return counts;
}

module.exports = {classifyLink, summarize};
