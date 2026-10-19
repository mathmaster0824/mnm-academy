const assert=require('assert');
const C=require('../functions/monthlyReportCore.js');
const student={id:'stu_b',name:'나',grade:'중2'};
const classes=[{id:'cls_y',name:'Y반'},{id:'cls_x',name:'X반'}];
const rec=(o)=>Object.assign({attendance:'출석'},o);
const input={month:'2026-09',today:'2026-10-01',student,classes,
  records:[
    {clsId:'cls_y',date:'2026-09-08',rec:rec({stepId:'s1',stepLabelSnapshot:'[중2-2] 삼각형의 성질',lessonDetail:'외심 작도 복습,\n교재 82쪽 3~7번',homeworkCompletionLevel:'상',dailyTestScore:90,conceptMemo:'SECRET'})},
    {clsId:'cls_y',date:'2026-09-15',rec:rec({attendance:'지각',stepLabelSnapshot:'[중2-2] 사각형',homeworkCompletionLevel:'하',dailyTestScore:60,note:'집중력 저하'})},
    {clsId:'cls_x',date:'2026-09-09',rec:rec({stepId:'__etc__',stepLabelSnapshot:'기타·직접입력',lessonDetail:'영재 문제 풀이'})},
    {clsId:'cls_x',date:'2026-09-16',rec:rec({attendance:'결석'})},
    {clsId:'cls_x',date:'2026-08-31',rec:rec({stepLabelSnapshot:'다른 달'})}],
  plans:[{clsId:'cls_y',weekStart:'2026-09-07',plan:{stu_b:{mon:'p.10',tue:'p.12'}}},{clsId:'cls_x',weekStart:'2026-09-07',plan:{stu_b:{wed:'영재1'}}},
         {clsId:'cls_y',weekStart:'2026-08-31',plan:{stu_b:{mon:'과거(리스타트 이전)'}}}],
  submissions:[{date:'2026-09-07',classId:'cls_y',sub:{status:'제출완료'}},{date:'2026-09-08',classId:'cls_y',sub:{status:'대기'}},{date:'2026-09-09',classId:'cls_x',sub:{status:'제출완료'}}],
  kmm:[{date:'2026-09-20',score:85,range:'1~3단원'},{date:'2026-10-02',score:50}],
  stepLabelOf:(id,r)=>r.stepLabelSnapshot};
const a=C.mrBuildMonthlyReport(input), b=C.mrBuildMonthlyReport(JSON.parse(JSON.stringify(Object.assign({},input,{stepLabelOf:undefined}))));
console.log(a.text);
assert(a.text.includes('수업 4회 (출석 2 · 지각 1 · 결석 1)')); assert(a.text.includes('지각·결석: 9/15 지각, 9/16 결석'));
assert(a.text.includes('9/8 [Y반] [중2-2] 삼각형의 성질 — 외심 작도 복습, 교재 82쪽 3~7번'));
assert(a.text.includes('[X반] 기타·직접입력 — 영재 문제 풀이'));
assert(!a.text.includes('SECRET') && !a.text.includes('다른 달') && !a.text.includes('과거(리스타트'));
// 숙제: Y반 9/7,9/8 (제출, 대기), X반 9/9 (제출) -> 계획 3일, 제출 2, 대기 1
assert.deepStrictEqual(a.data.homework.totals,{planned:3,submitted:2,pending:1,rejected:0,missing:0});
assert(a.text.includes('숙제가 있었던 3일 중 제출 완료 2일 · 확인 대기 1일'));
assert(a.text.includes('상 1 · 중 0 · 하 1 · 미평가 2'));
assert(a.text.includes('일일테스트 2회 평균 75점')); assert(a.text.includes('KMM 9/20 85점 (1~3단원) PASS')); assert(!a.text.includes('50점'));
assert(a.text.includes('9/15 [Y반] 집중력 저하'));
assert(a.text.includes('[반별 요약]') && a.text.includes('Y반: 수업 2회'));
assert(!a.text.includes('결석이 있었던 부분'));
// 빈 달 → 기록 없음
const e=C.mrBuildMonthlyReport({month:'2026-09',today:'2026-10-01',student,classes:[{id:'cls_y',name:'Y반'}],records:[],plans:[],submissions:[],kmm:[]});
assert.strictEqual((e.text.match(/기록 없음/g)||[]).length,7); assert(!e.text.includes('[반별 요약]'));
// 멱등/수정본 보존
const t0='2026-10-01T00:10:00Z';
let r1=C.mrApplyGenerated(null,a,t0,'나'); assert.strictEqual(r1.action,'create');
let doc=r1.doc; assert.strictEqual(C.mrApplyGenerated(doc,a,t0,'나').action,'skip');
const input2=JSON.parse(JSON.stringify(input)); input2.stepLabelOf=input.stepLabelOf;
input2.records.push({clsId:'cls_y',date:'2026-09-22',rec:rec({stepLabelSnapshot:'[중2-2] 닮음',homeworkCompletionLevel:'중'})});
const a2=C.mrBuildMonthlyReport(input2); assert.notStrictEqual(a2.sig,a.sig);
let r2=C.mrApplyGenerated(doc,a2,'2026-10-02T00:00:00Z','나'); assert.strictEqual(r2.action,'update'); assert.strictEqual(r2.doc.generated.version,2);
doc=Object.assign({},doc,r2.doc,{edited:{text:'원장 수정본',editedAt:'x'},status:'edited'});
const input3=JSON.parse(JSON.stringify(input2)); input3.stepLabelOf=input.stepLabelOf; input3.records.push({clsId:'cls_x',date:'2026-09-23',rec:rec({stepLabelSnapshot:'추가'})});
const a3=C.mrBuildMonthlyReport(input3); let r3=C.mrApplyGenerated(doc,a3,'2026-10-03T00:00:00Z','나');
assert.strictEqual(r3.action,'newer'); assert(!('edited' in r3.doc)); assert.strictEqual(r3.doc.hasNewerDraft,true); assert.strictEqual(r3.doc.generated.version,3);
// 범위/주 계산
assert.strictEqual(C.mrPrevMonthOf('2026-01-01'),'2025-12'); assert.strictEqual(C.mrMonthRange('2026-12').endEx,'2027-01-01');
assert.deepStrictEqual(C.mrWeekStartsOfMonth('2026-09'),['2026-08-31','2026-09-07','2026-09-14','2026-09-21','2026-09-28']);
console.log('MONTHLY OK');
