import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialExecutor, createSingleFlight, withTimeout, mapWithConcurrency } from '../dist/src/async-utils.js';
import { isIpv6, isIpv6InCidrs } from '../dist/src/nodes.js';
import { loadConfigHistory, snapshotConfig, findConfigRevision } from '../dist/src/config-history.js';
import { DEFAULT_CONFIG } from '../dist/src/constants.js';
import { catalogConfigFingerprint, catalogMatchesConfig, isCatalogFresh } from '../dist/src/catalog.js';

class MemoryKv {
  constructor(){ this.map=new Map(); }
  async get(key){ return this.map.get(key) ?? null; }
  async put(key,value){ this.map.set(key,value); }
  async delete(key){ this.map.delete(key); }
}

test('serial executor preserves submission order across async work', async()=>{
  const seen=[];
  const q=createSerialExecutor((e)=>{ throw e; });
  q.enqueue(async()=>{ await new Promise(r=>setTimeout(r,15)); seen.push('first'); });
  q.enqueue(async()=>{ seen.push('second'); });
  q.enqueue(async()=>{ await Promise.resolve(); seen.push('third'); });
  await q.idle();
  assert.deepEqual(seen,['first','second','third']);
});

test('serial executor continues after a rejected task and reports the error', async()=>{
  const seen=[]; const errors=[];
  const q=createSerialExecutor((e)=>errors.push(String(e?.message ?? e)));
  q.enqueue(async()=>{ seen.push(1); throw new Error('boom'); });
  q.enqueue(async()=>{ seen.push(2); });
  await q.idle();
  assert.deepEqual(seen,[1,2]);
  assert.deepEqual(errors,['boom']);
});

test('withTimeout rejects operations that do not settle in time', async()=>{
  await assert.rejects(()=>withTimeout(new Promise(()=>{}),20,'timeout-marker'),/timeout-marker/);
  assert.equal(await withTimeout(Promise.resolve(42),100),42);
});

test('Cloudflare IPv6 membership is evaluated against CIDRs',()=>{
  assert.equal(isIpv6('2606:4700:4700::1111'),true);
  assert.equal(isIpv6InCidrs('2606:4700:4700::1111',['2606:4700::/32']),true);
  assert.equal(isIpv6InCidrs('2001:4860:4860::8888',['2606:4700::/32']),false);
  assert.equal(isIpv6('not:ipv6'),false);
});

test('configuration history is bounded, deduplicated and recoverable', async()=>{
  const kv=new MemoryKv(); const env={FLUXA_KV:kv};
  for(let i=0;i<10;i++){
    await snapshotConfig(env,{...structuredClone(DEFAULT_CONFIG),title:`Fluxa-${i}`},'pre-update');
  }
  const history=await loadConfigHistory(env);
  assert.equal(history.length,8);
  assert.equal(history[0].config.title,'Fluxa-9');
  const before=history.length;
  await snapshotConfig(env,{...structuredClone(DEFAULT_CONFIG),title:'Fluxa-9'},'pre-update');
  assert.equal((await loadConfigHistory(env)).length,before);
  const found=await findConfigRevision(env,history[3].id);
  assert.equal(found?.config.title,history[3].config.title);
  assert.equal(await findConfigRevision(env,'../bad'),null);
});


test('bounded map preserves order and never exceeds requested concurrency', async()=>{
  let active=0,maxActive=0;
  const values=await mapWithConcurrency([1,2,3,4,5,6,7],3,async(n)=>{
    active++; maxActive=Math.max(maxActive,active);
    await new Promise(r=>setTimeout(r,6));
    active--; return n*10;
  });
  assert.deepEqual(values,[10,20,30,40,50,60,70]);
  assert.ok(maxActive<=3);
  assert.ok(maxActive>=2);
});


test('single-flight coalesces concurrent work per key and releases after completion', async()=>{
  const single=createSingleFlight();
  let runs=0;
  const task=()=>single('catalog',async()=>{runs++;await new Promise(r=>setTimeout(r,12));return 7;});
  const [a,b,c]=await Promise.all([task(),task(),task()]);
  assert.deepEqual([a,b,c],[7,7,7]);
  assert.equal(runs,1);
  assert.equal(await task(),7);
  assert.equal(runs,2);
});

test('catalog fingerprint invalidates a catalog generated from older configuration',()=>{
  const cfg=structuredClone(DEFAULT_CONFIG);
  const catalog={schemaVersion:1,generatedAt:new Date().toISOString(),configFingerprint:catalogConfigFingerprint(cfg),sourceHealth:[],nodes:[],summary:{total:0,eligible:0,recommended:0,healthy:0,probation:0,quarantined:0,retired:0}};
  assert.equal(catalogMatchesConfig(catalog,cfg),true);
  assert.equal(isCatalogFresh(catalog,cfg),true);
  const changed={...structuredClone(cfg),title:'Different'};
  assert.equal(catalogMatchesConfig(catalog,changed),false);
  assert.equal(isCatalogFresh(catalog,changed),false);
});
