// Run: node tests/class-record-regression.js
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const script=html.slice(html.indexOf('<script>',html.indexOf('jszip.min.js'))+8,html.lastIndexOf('</script>'));
new vm.Script(script,{filename:'index.html'});
const source=script;
const begin=source.indexOf('const classRecordWriteQueues=new Map();');
const finish=source.indexOf('function videoAssignHistoryForStudent',begin);
assert(begin>=0&&finish>begin,'class record functions found');
const code=source.slice(begin,finish);
const saved={};let fail=false;
const db={classRecords:{}};
const fsdb={collection:()=>({doc:(key)=>({set:async(data)=>{if(fail)throw Error('offline');const d=saved[key]||{};for(const [sid,patch] of Object.entries(data))d[sid]={...(d[sid]||{}),...patch};saved[key]=d;}})})};
const context={Map,Promise,Object,console,db,fsdb,render:()=>{},alert:()=>{},stepShortLabel:()=>'',stepLabel:()=>''};
vm.createContext(context);vm.runInContext(code,context);
(async()=>{
  await Promise.all([
    context.updateClassRec('A','2026-10-08','S1','attendance','출석'),
    context.updateClassRec('A','2026-10-08','S1','note','첫 기록'),
    context.updateClassRec('A','2026-10-08','S2','attendance','지각')
  ]);
  assert.equal(saved['A_2026-10-08'].S1.note,'첫 기록');
  assert.equal(saved['A_2026-10-08'].S1.attendance,'출석');
  assert.equal(saved['A_2026-10-08'].S2.attendance,'지각');
  context.mergeClassRecordServer('A_2026-10-08',saved['A_2026-10-08']);
  assert.equal(db.classRecords['A_2026-10-08'].S1.note,'첫 기록');
  fail=true;
  const ok=await context.updateClassRec('A','2026-10-08','S1','note','오프라인');
  assert.equal(ok,false);
  console.log('PASS: syntax, consecutive writes, multiple students, server reload, failed write notification');
})().catch(e=>{console.error(e);process.exitCode=1});