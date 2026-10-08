'use strict';
const assert = require('node:assert/strict');
const {classifyLink} = require('../tools/problem-link-audit');
const {auditProblemLinksReadOnly} = require('../tools/problem-link-firestore-readonly');

function mockDb({data,failCollections=[],failTargets=[]}) {
  const calls=[];
  const db={
    collection(name){
      return {
        orderBy(field){
          assert.equal(field,'__name__');
          let after=null,limit=100;
          const query={
            limit(n){limit=n;return query;},
            startAfter(doc){after=doc.id;return query;},
            async get(){
              calls.push('read:'+name);
              if(failCollections.includes(name))throw Object.assign(new Error('denied'),{code:'permission-denied'});
              const entries=data[name]||[];
              const offset=after===null?0:entries.findIndex(x=>x.id===after)+1;
              const batch=entries.slice(offset,offset+limit).map(x=>({id:x.id,data:()=>({...x})}));
              return {docs:batch,size:batch.length,empty:batch.length===0};
            }
          };
          return query;
        },
        doc(id){
          return {async get(){
            calls.push('doc:'+name+':'+id);
            if(failTargets.includes(name+'/'+id))throw Object.assign(new Error('denied'),{code:'permission-denied'});
            return {exists:!!(data[name]||[]).find(x=>x.id===id)};
          }};
        }
      };
    }
  };
  return {db,calls};
}

(async()=>{
  const fixture=mockDb({data:{
    questions:[{id:'q1',problemId:'p1'},{id:'q2',problemDraftId:'d1'},{id:'q3'}],
    solutionPhotos:[{id:'s1',problemId:'missing'}],
    problems:[{id:'p1'}],problemDrafts:[{id:'d1'}]
  }});
  const report=await auditProblemLinksReadOnly(fixture.db,classifyLink,{pageSize:2});
  assert.deepEqual(report.counts,{total:4,linked:1,candidate:1,'broken-canonical':1,'broken-draft':0,unverified:1,'unknown-read-error':0});
  assert.equal(report.complete,true);
  assert.equal(fixture.calls.some(x=>x.startsWith('write:')),false);
  assert.equal(fixture.calls.filter(x=>x==='read:questions').length,2);

  const denied=mockDb({data:{questions:[{id:'q1',problemId:'p1'}],solutionPhotos:[],problems:[{id:'p1'}]},failTargets:['problems/p1']});
  const r2=await auditProblemLinksReadOnly(denied.db,classifyLink);
  assert.equal(r2.counts['unknown-read-error'],1);
  assert.equal(r2.counts['broken-canonical'],0);

  const blocked=mockDb({data:{questions:[],solutionPhotos:[]},failCollections:['questions']});
  const r3=await auditProblemLinksReadOnly(blocked.db,classifyLink);
  assert.equal(r3.complete,false);
  assert.equal(r3.collectionErrors[0].error,'collection-read-error');

  const limited=mockDb({data:{questions:[{id:'q1'},{id:'q2'}],solutionPhotos:[]}});
  const r4=await auditProblemLinksReadOnly(limited.db,classifyLink,{maxRecords:1});
  assert.equal(r4.complete,false);
  assert.equal(r4.counts.total,1);

  console.log('problem-link-firestore-readonly: 10 checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
