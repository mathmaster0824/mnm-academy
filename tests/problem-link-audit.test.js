'use strict';
const assert = require('node:assert/strict');
const {classifyLink,summarize} = require('../tools/problem-link-audit');

const targets = {
  problems: {p1:{exists:true},p2:{exists:false},p3:{error:'permission-denied'}},
  problemDrafts: {d1:{exists:true},d2:{exists:false}}
};
assert.equal(classifyLink({problemId:'p1'},targets),'linked');
assert.equal(classifyLink({problemId:'p2',problemDraftId:'d1'},targets),'broken-canonical');
assert.equal(classifyLink({problemId:'p3'},targets),'unknown-read-error');
assert.equal(classifyLink({problemId:'unknown'},targets),'unknown-read-error');
assert.equal(classifyLink({problemDraftId:'d1'},targets),'candidate');
assert.equal(classifyLink({problemDraftId:'d2'},targets),'broken-draft');
assert.equal(classifyLink({},targets),'unverified');
assert.deepEqual(summarize([{problemId:'p1'},{problemDraftId:'d1'},{}],targets),{
 total:3,linked:1,candidate:1,'broken-canonical':0,'broken-draft':0,unverified:1,'unknown-read-error':0
});
console.log('problem-link-audit: 8 assertions passed');
