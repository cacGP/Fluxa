import test from 'node:test';
import assert from 'node:assert/strict';
import { appendAuditEvent, loadAuditLog } from '../dist/src/audit.js';
import { buildDiagnostics } from '../dist/src/diagnostics.js';
import { subscriptionResponse } from '../dist/src/subscription-response.js';
import { DEFAULT_CONFIG } from '../dist/src/constants.js';

function memoryKv(){
  const data=new Map();
  return { async get(k){return data.get(k)??null}, async put(k,v){data.set(k,String(v))}, _data:data };
}
const baseEnv={ADMIN_TOKEN:'a'.repeat(32),SUB_TOKEN:'b'.repeat(32),CLIENT_UUID:'550e8400-e29b-41d4-a716-446655440000',TROJAN_PASSWORD:'strong-password-123456'};

test('audit log is bounded, newest first, and strips control characters',async()=>{
  const env={...baseEnv,FLUXA_KV:memoryKv()};
  await appendAuditEvent(env,'config.update','first\nsecret-free note');
  await appendAuditEvent(env,'catalog.refresh','second');
  const events=await loadAuditLog(env);
  assert.equal(events.length,2);assert.equal(events[0].action,'catalog.refresh');assert.doesNotMatch(events[1].detail,/\n/);
});

test('diagnostics reports healthy core invariants without exposing secret values',()=>{
  const d=buildDiagnostics(baseEnv,DEFAULT_CONFIG,null);
  assert.equal(d.version,'0.8.0');
  assert.ok(d.checks.some(x=>x.id==='secrets'&&x.ok));
  const text=JSON.stringify(d);assert.doesNotMatch(text,/strong-password-123456/);assert.doesNotMatch(text,/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
});

test('subscription response emits ETag and supports conditional GET and HEAD',async()=>{
  const req=new Request('https://demo/sub/token');
  const first=await subscriptionResponse(req,'clash','hello');
  assert.equal(first.status,200);assert.equal(first.headers.get('x-fluxa-version'),'0.8.0');
  const etag=first.headers.get('etag');assert.ok(etag);
  const second=await subscriptionResponse(new Request('https://demo/sub/token',{headers:{'if-none-match':etag}}),'clash','hello');
  assert.equal(second.status,304);
  const head=await subscriptionResponse(new Request('https://demo/sub/token',{method:'HEAD'}),'clash','hello');
  assert.equal(head.status,200);assert.equal(await head.text(),'');
});
