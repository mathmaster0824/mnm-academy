const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {deflateSync}=require('node:zlib');
const source=fs.readFileSync(require('node:path').join(__dirname,'../worker/mnm-photo-api.js'),'utf8').replace('export default {','globalThis.worker = {');
function runtime(bucket,run){
  const c=vm.createContext({crypto:webcrypto,Response,Request,Headers,URL,Blob,FormData,File,TextEncoder,TextDecoder,Uint8Array,DataView,CompressionStream,DecompressionStream,atob,btoa,fetch:async()=>new Response('{}')});
  vm.runInContext(source+';globalThis.api=pdfImportApi;globalThis.tick=pdfImportTick;globalThis.decode=pdfDecodePng;globalThis.crop=pdfCropPng;globalThis.chunk=pdfPngChunk;globalThis.join=pdfJoin;',c);
  return {c,env:{PHOTOS:bucket,AI:{run:run||(async()=>({response:'{"segments":[]}'}))}}};
}
class Bucket{
  constructor(){this.data=new Map();this.seq=0;this.uploads=new Map();}
  async head(key){const o=this.data.get(key);return o?{etag:o.etag,size:o.bytes.length,httpMetadata:o.httpMetadata}:null;}
  async createMultipartUpload(key,options={}){const uploadId='upload-'+(++this.seq);this.uploads.set(uploadId,{key,options,parts:new Map()});return {uploadId,key,...this.resumeMultipartUpload(key,uploadId)};}
  resumeMultipartUpload(key,uploadId){const bucket=this;return {
    async uploadPart(n,value){const u=bucket.uploads.get(uploadId);if(!u||u.key!==key)throw new Error('NoSuchUpload');const bytes=new Uint8Array(await new Response(value).arrayBuffer()),etag=`etag-${uploadId}-${n}`;u.parts.set(n,{bytes,etag});return {partNumber:n,etag};},
    async complete(parts){const u=bucket.uploads.get(uploadId);if(!u||u.key!==key)throw new Error('NoSuchUpload');const bytes=[];for(const p of parts){const v=u.parts.get(p.partNumber);assert.equal(p.etag,v.etag);bytes.push(v.bytes);}await bucket.put(key,new Blob(bytes),u.options);bucket.uploads.delete(uploadId);if(bucket.failAfterComplete){bucket.failAfterComplete=false;throw new Error('acknowledgment lost');}return bucket.head(key);},
    async abort(){bucket.uploads.delete(uploadId);}
  };}
  async get(key){const o=this.data.get(key);if(!o)return null;const bytes=o.bytes.slice();return {etag:o.etag,size:bytes.length,httpMetadata:o.httpMetadata,body:new Blob([bytes]).stream(),arrayBuffer:async()=>bytes.buffer,json:async()=>JSON.parse(new TextDecoder().decode(bytes))};}
  async put(key,value,options={}){const previous=this.data.get(key),cond=options.onlyIf;if(cond?.etagMatches&&previous?.etag!==cond.etagMatches)return null;if(cond?.etagDoesNotMatch==='*'&&previous)return null;const bytes=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(await new Response(value).arrayBuffer());const o={bytes,etag:String(++this.seq),httpMetadata:options.httpMetadata||{}};this.data.set(key,o);return o;}
  async list({prefix='',limit=100,cursor}={}){const keys=[...this.data.keys()].filter(k=>k.startsWith(prefix)).sort(),start=cursor?Number(cursor):0,part=keys.slice(start,start+limit);return {objects:part.map(key=>({key})),truncated:start+limit<keys.length,cursor:String(start+limit)};}
}
function png(c,width=8,height=8,filter=0){
  const channels=4,stride=width*channels,pixels=Uint8Array.from({length:stride*height},(_,i)=>i%4===3?255:(i*17)%256),raw=new Uint8Array((stride+1)*height);
  const paeth=(a,b,d)=>{const p=a+b-d,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-d);return pa<=pb&&pa<=pc?a:pb<=pc?b:d;};
  for(let y=0;y<height;y++){raw[y*(stride+1)]=filter;for(let x=0;x<stride;x++){const k=y*stride+x,a=x>=channels?pixels[k-channels]:0,b=y?pixels[k-stride]:0,d=y&&x>=channels?pixels[k-stride-channels]:0;raw[y*(stride+1)+1+x]=(pixels[k]-(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,d)))&255;}}
  const header=new Uint8Array(13),v=new DataView(header.buffer);v.setUint32(0,width);v.setUint32(4,height);header[8]=8;header[9]=6;
  return {pixels,bytes:c.join([new Uint8Array([137,80,78,71,13,10,26,10]),c.chunk('IHDR',header),c.chunk('IDAT',new Uint8Array(deflateSync(raw))),c.chunk('IEND',new Uint8Array())])};
}
const auth={role:'director',uid:'director-test'};
async function call(r,path='',body,raw){const request=new Request('https://example.test/pdf-imports'+path,body===undefined?{}:{method:'POST',body:raw?body:JSON.stringify(body)});const res=await r.c.api(request,r.env,new URL(request.url),auth);return {status:res.status,data:await res.json()};}
async function stage(r,count=2){
 const made=await call(r,'',{fileHash:'a'.repeat(64),fileName:'test.pdf',pageCount:count,sourceMeta:{materialKind:'exam'},answerMap:[]});const id=made.data.job.id;
 await call(r,'/'+id+'/source',new Blob(['%PDF-test']),true);
 for(let n=1;n<=count;n++){const image=png(r.c),form=new FormData();form.append('file',new Blob([image.bytes],{type:'image/png'}),'page.png');form.append('meta',JSON.stringify({width:8,height:8,regions:n===1?[{problemNo:'1',left:0,top:0,right:.5,bottom:.5,rawText:'test'}]:null}));assert.equal((await call(r,'/'+id+'/pages/'+n,form,true)).status,200);}
 return id;
}
test('PNG filters 0–4 roundtrip and crop preserves pixels',async()=>{
 const {c}=runtime(new Bucket());for(let filter=0;filter<=4;filter++){const fixture=png(c,8,8,filter),decoded=await c.decode(fixture.bytes);assert.deepEqual([...decoded.pixels],[...fixture.pixels]);const cropped=await c.decode(await c.crop(decoded,{left:.25,top:.25,right:.75,bottom:.75}));assert.equal(cropped.width,4);assert.equal(cropped.height,4);for(let y=0;y<4;y++)assert.deepEqual([...cropped.pixels.slice(y*16,y*16+16)],[...fixture.pixels.slice(((y+2)*8+2)*4,((y+2)*8+6)*4)]);}
});
test('server keeps processing after browser context is discarded, stores crops, resumes without duplicates',async()=>{
 const bucket=new Bucket();let first=runtime(bucket);const id=await stage(first);assert.equal((await call(first,'/'+id+'/start',{})).status,503);await first.c.tick(first.env);assert.equal((await call(first,'/'+id+'/start',{})).status,202);
 first=null;let aiCalls=0;const server=runtime(bucket,async()=>{aiCalls++;return {response:aiCalls===1?'not JSON':'{"segments":[{"problemNo":"2","left":0,"top":0,"right":1,"bottom":1}]}'}});
 await server.c.tick(server.env);const result=await call(server,'/'+id+'/result');assert.equal(result.status,200);assert.equal(result.data.problems.length,2);assert.equal(result.data.job.status,'ready');assert.equal(aiCalls,2);for(const p of result.data.problems){assert.ok(await bucket.get(p.cropKey));assert.equal(p.cropHash.length,64);}
 await server.c.tick(server.env);assert.equal(aiCalls,2);const duplicate=await call(server,'',{fileHash:'a'.repeat(64),fileName:'test.pdf',pageCount:2,sourceMeta:{materialKind:'exam'},answerMap:[]});assert.equal(duplicate.data.job.id,id);assert.equal(duplicate.data.job.status,'ready');
});
test('two persistent page failures stop; retry keeps successful page and its crop',async()=>{
 const bucket=new Bucket();let calls=0;let r=runtime(bucket,async()=>{calls++;return {response:'bad'};});const id=await stage(r);await r.c.tick(r.env);await call(r,'/'+id+'/start',{});await r.c.tick(r.env);
 const j=(await call(r,'/'+id)).data.job;assert.equal(j.status,'error');assert.deepEqual(j.donePages,[1]);assert.deepEqual(j.failedPages,[2]);assert.equal(calls,4);assert.equal((await call(r,'/'+id+'/result')).status,409);
 const successKeys=[...bucket.data.keys()].filter(k=>k.includes('/crops/'));r=runtime(bucket,async()=>({response:'{"segments":[{"problemNo":"2","left":0,"top":0,"right":1,"bottom":1}]}'}));await call(r,'/'+id+'/retry',{});await r.c.tick(r.env);assert.equal((await call(r,'/'+id)).data.job.status,'ready');assert.equal(successKeys.filter(k=>bucket.data.has(k)).length,1);
});
test('scheduler lease prevents concurrent workers; authorization isolates jobs and job metadata is not a public photo',async()=>{
 const bucket=new Bucket(),r=runtime(bucket);const id=await stage(r,1);await r.c.tick(r.env);await call(r,'/'+id+'/start',{});
 await bucket.put('_pdf-import/lease.json',JSON.stringify({owner:'other',until:Date.now()+60000}));await r.c.tick(r.env);assert.equal((await call(r,'/'+id)).data.job.status,'queued');
 const req=new Request('https://example.test/pdf-imports/'+id);const other=await r.c.api(req,r.env,new URL(req.url),{role:'director',uid:'other'});assert.equal(other.status,404);
 const anon=await r.c.worker.fetch(new Request('https://example.test/pdf-imports'),r.env);assert.equal(anon.status,401);
 const privatePhoto=await r.c.worker.fetch(new Request('https://example.test/photo?key=_pdf-import/scheduler.json'),r.env);assert.equal(privatePhoto.status,400);
});
test('20MB PDF uploads as resumable 8MB parts, reconstructs one exact original, survives completion acknowledgment loss',async()=>{
 const bucket=new Bucket();let r=runtime(bucket);
 const made=await call(r,'',{fileHash:'b'.repeat(64),fileName:'large.pdf',pageCount:1,sourceMeta:{},answerMap:[]}),id=made.data.job.id;
 const bytes=new Uint8Array(20*1024*1024);bytes.set(new TextEncoder().encode('%PDF-1.7'));bytes[bytes.length-1]=123;
 let init=await call(r,'/'+id+'/source-init',{size:bytes.length});assert.equal(init.status,200);
 const send=async(n)=>call(r,'/'+id+'/source-part/'+n,new Blob([bytes.slice((n-1)*8*1024*1024,Math.min(n*8*1024*1024,bytes.length))]),true);
 assert.equal((await send(1)).status,200);assert.equal((await call(r,'/'+id+'/source-complete',{})).status,409);
 r=runtime(bucket);init=await call(r,'/'+id+'/source-init',{size:bytes.length});assert.deepEqual(init.data.job.sourceParts,[1]);
 assert.equal((await call(r,'/'+id+'/source-part/2',new Blob(['short']),true)).status,400);
 assert.equal((await send(2)).status,200);assert.equal((await send(3)).status,200);
 bucket.failAfterComplete=true;await assert.rejects(()=>call(r,'/'+id+'/source-complete',{}),/acknowledgment lost/);
 r=runtime(bucket);const recovered=await call(r,'/'+id+'/source-init',{size:bytes.length});assert.equal(recovered.data.job.sourceUploaded,true);
 const sourceKey=[...bucket.data.keys()].find(k=>k.endsWith('/source.pdf'));assert.deepEqual(bucket.data.get(sourceKey).bytes,bytes);assert.equal([...bucket.data.keys()].filter(k=>k.endsWith('/source.pdf')).length,1);assert.equal(bucket.uploads.size,0);
});
test('multipart endpoints reject oversized declarations, wrong parts and another director',async()=>{
 const bucket=new Bucket(),r=runtime(bucket);const made=await call(r,'',{fileHash:'c'.repeat(64),fileName:'large.pdf',pageCount:1}),id=made.data.job.id;
 assert.equal((await call(r,'/'+id+'/source-init',{size:513*1024*1024})).status,413);
 assert.equal((await call(r,'/'+id+'/source-init',{size:20*1024*1024})).status,200);
 assert.equal((await call(r,'/'+id+'/source-part/4',new Blob(['x']),true)).status,409);
 const req=new Request('https://example.test/pdf-imports/'+id+'/source-init',{method:'POST',body:JSON.stringify({size:20*1024*1024})});const other=await r.c.api(req,r.env,new URL(req.url),{role:'director',uid:'another-director'});assert.equal(other.status,404);
});
