'use strict';

/**
 * Opt-in, read-only Firestore audit.
 * Usage in an already authenticated app context:
 *   const report = await auditProblemLinksReadOnly(fsdb, classifyLink);
 * Does not initialize credentials, mutate documents, or export student content.
 */
async function auditProblemLinksReadOnly(fsdb, classifyLink, {pageSize=100, maxRecords=10000}={}) {
  if (!fsdb || typeof classifyLink !== 'function') throw new Error('Firestore and classifier required');
  const collections=['questions','solutionPhotos'];
  const records=[];
  const failures=[];
  for (const collection of collections) {
    let last=null;
    for (;;) {
      if (records.length >= maxRecords) { failures.push({collection,error:'limit-reached'}); break; }
      const take=Math.min(pageSize,maxRecords-records.length);
      let query=fsdb.collection(collection).orderBy('__name__').limit(take);
      if(last) query=query.startAfter(last);
      let snap;
      try { snap=await query.get(); }
      catch(e) { failures.push({collection,error:'collection-read-error',code:String(e?.code||'')}); break; }
      for(const doc of snap.docs) {
        const d=doc.data()||{};
        records.push({collection,id:doc.id,problemId:String(d.problemId||''),problemDraftId:String(d.problemDraftId||'')});
      }
      if(snap.empty || snap.size < take) break;
      last=snap.docs[snap.docs.length-1];
    }
  }
  const targetIds={problems:new Set(),problemDrafts:new Set()};
  for(const r of records){
    if(r.problemId)targetIds.problems.add(r.problemId);
    if(r.problemDraftId)targetIds.problemDrafts.add(r.problemDraftId);
  }
  const targets={problems:{},problemDrafts:{}};
  for(const col of Object.keys(targetIds)){
    for(const id of targetIds[col]){
      try {
        const doc=await fsdb.collection(col).doc(id).get();
        targets[col][id]={exists:doc.exists};
      }catch(e){
        targets[col][id]={error:String(e?.code||'read-error')};
      }
    }
  }
  const counts={total:0,linked:0,candidate:0,'broken-canonical':0,'broken-draft':0,unverified:0,'unknown-read-error':0};
  const byCollection={};
  for(const record of records){
    const status=classifyLink(record,targets);
    counts.total++; counts[status]++;
    const bucket=byCollection[record.collection] ||= {...Object.fromEntries(Object.keys(counts).map(k=>[k,0]))};
    bucket.total++;bucket[status]++;
  }
  return {counts,byCollection,collectionErrors:failures,complete:failures.length===0};
}
module.exports={auditProblemLinksReadOnly};
