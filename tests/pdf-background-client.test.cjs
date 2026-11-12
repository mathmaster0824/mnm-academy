const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
test('returning to the page imports persisted results once and preserves reviewed drafts after interrupted acknowledgment',async()=>{
 const store=new Map(),id='a'.repeat(64),sourceId='pdfjob_'+id;
 const existing={problemNo:'1',answer:'teacher edited',status:'saved'};
 store.set('problemDrafts/'+sourceId+'_1_1',existing);
 const doc=(col,id)=>({key:col+'/'+id,set:async(data,opts)=>store.set(col+'/'+id,opts?.merge?{...store.get(col+'/'+id),...data}:data)});
 const fsdb={collection:col=>({doc:id=>doc(col,id)}),runTransaction:async cb=>{
   const writes=[];await cb({get:async ref=>({exists:store.has(ref.key),data:()=>store.get(ref.key)}),set:(ref,data)=>writes.push([ref.key,data])});
   for(const [key,data]of writes)store.set(key,data);
 }};
 let failAck=true,loads=0;
 const ctx=vm.createContext({Response,Request,Headers,URL,Blob,File,FormData,console,window:{addEventListener(){}},document:{getElementById:()=>null,addEventListener(){}},setInterval(){},session:{mode:'director'},PHOTO_API_BASE:'https://test',photoApiToken:async()=>'test',readMnmJsonResponse:r=>r.json(),fsdb,problemStore:{ingest:{}},problemPdfInferType:()=> 'mc',mergeProblemRuleAnalysis:d=>d,problemDraftConfidence:()=>.5,problemDraftStatus:()=> 'review',loadProblemIngestQueue:async()=>{loads++;},escapeHtml:s=>String(s),fetch:async url=>{
   if(url.endsWith('/imported')){if(failAck){failAck=false;throw new Error('connection closed');}return Response.json({ok:true});}
   const second=url.includes('from=11');
   return Response.json({ok:true,job:{id,fileName:'exam.pdf',pageCount:11,problemCount:2},sourceMeta:{materialKind:'exam'},answerMap:[],problems:[{problemNo:second?'2':'1',page:second?11:1,ordinal:1,printedProblemNo:second?'2':'1',rawText:'test',cropKey:'test',cropHash:'test',media:[]}],nextPage:second?null:11});
 }});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../pdf-background-import.js'),'utf8')+';globalThis.importResult=importPdfBackgroundResult;',ctx);
 await assert.rejects(()=>ctx.importResult(id),/connection closed/);
 assert.equal(store.get('problemDrafts/'+sourceId+'_1_1').answer,'teacher edited');
 assert.equal(store.get('problemDrafts/'+sourceId+'_11_1').pastExam,true);
 await ctx.importResult(id);
 assert.equal([...store.keys()].filter(k=>k.startsWith('problemDrafts/')).length,2);
 assert.equal(store.get('problemSources/'+sourceId).backgroundImportState,'complete');
 assert.equal(store.get('problemSources/'+sourceId).problemCount,2);assert.equal(loads,1);
});
test('large PDF fingerprint hashes bounded slices and uploader resumes acknowledged parts after a network interruption',async()=>{
 const sizes=[],parts=new Set([1]),sent=[];let dropped=false,completed=false;
 const ctx=vm.createContext({Response,Request,Headers,URL,Blob,File,FormData,console,window:{addEventListener(){}},document:{getElementById:()=>null,addEventListener(){}},setInterval(){},session:{mode:'director'},PHOTO_API_BASE:'https://test',photoApiToken:async()=>'test',readMnmJsonResponse:r=>r.json(),sha256BlobHex:async blob=>{sizes.push(blob.size);return 'a'.repeat(64);},fetch:async(url,opts)=>{
   if(url.endsWith('/source-init'))return Response.json({ok:true,job:{sourceUploaded:false,sourceParts:[...parts]}});
   if(url.includes('/source-part/')){const n=Number(url.split('/').pop());sent.push({n,size:opts.body.size});parts.add(n);if(n===2&&!dropped){dropped=true;throw new Error('response lost');}return Response.json({ok:true});}
   if(url.endsWith('/source-complete')){completed=true;return Response.json({ok:true});}throw new Error(url);
 }});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../pdf-background-import.js'),'utf8')+';globalThis.fingerprint=pdfSourceFingerprint;globalThis.upload=uploadPdfOriginalParts;',ctx);
 const file=new File([new Uint8Array(20*1024*1024)],'large.pdf',{type:'application/pdf'});
 const first=await ctx.fingerprint(file),second=await ctx.fingerprint(file);assert.equal(first,second);assert.ok(sizes.every(size=>size<=8*1024*1024));
 await ctx.upload(file,'job');assert.deepEqual(sent.map(p=>p.n),[2,3]);assert.deepEqual(sent.map(p=>p.size),[8*1024*1024,4*1024*1024]);assert.equal(completed,true);
});
