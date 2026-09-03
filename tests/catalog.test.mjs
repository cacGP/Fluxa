import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSourceReputation, gradeFor, selectSubscriptionAddresses } from '../dist/src/catalog.js';
import { isIpv4InCidrs, sampleIpv4Stable } from '../dist/src/nodes.js';
import { DEFAULT_CONFIG } from '../dist/src/constants.js';

test('source reputation rewards clean success and punishes repeated failures',()=>{
  const good=calculateSourceReputation(1,1,0,true,10,10);
  const bad=calculateSourceReputation(3,1,2,false,0,0);
  assert.equal(good,72);
  assert.ok(bad<45);
  assert.equal(gradeFor(good),'C');
  assert.equal(gradeFor(90),'A');
});

test('Cloudflare IPv4 membership is evaluated against CIDRs',()=>{
  assert.equal(isIpv4InCidrs('104.16.10.20',['104.16.0.0/13']),true);
  assert.equal(isIpv4InCidrs('8.8.8.8',['104.16.0.0/13']),false);
});

test('stable official sampler produces repeatable candidates',()=>{
  const cidrs=['104.16.0.0/24','172.64.0.0/24'];
  assert.deepEqual(sampleIpv4Stable(cidrs,4),sampleIpv4Stable(cidrs,4));
});

test('subscription selection excludes low-score and retired nodes',()=>{
  const now=new Date().toISOString();
  const catalog={schemaVersion:1,generatedAt:now,sourceHealth:[],summary:{total:3,eligible:1,recommended:1,healthy:0,probation:1,quarantined:0,retired:1},nodes:[
    {address:'1.1.1.1',origins:['manual'],sources:[],firstSeenAt:now,lastSeenAt:now,misses:0,cloudflareIpv4:false,fluxScore:95,status:'recommended',reasons:[]},
    {address:'8.8.8.8',origins:['source'],sources:['https://a.example/x'],firstSeenAt:now,lastSeenAt:now,misses:0,cloudflareIpv4:false,fluxScore:55,status:'probation',reasons:[]},
    {address:'9.9.9.9',origins:['source'],sources:['https://a.example/x'],firstSeenAt:now,lastSeenAt:now,misses:3,cloudflareIpv4:false,fluxScore:80,status:'retired',reasons:[]}
  ]};
  assert.deepEqual(selectSubscriptionAddresses('demo.workers.dev',catalog,DEFAULT_CONFIG),['demo.workers.dev','1.1.1.1']);
});

test('request host is always dynamic and legacy persisted Worker hosts are never re-issued',()=>{
  const now=new Date().toISOString();
  const legacy={schemaVersion:1,generatedAt:now,sourceHealth:[],summary:{total:2,eligible:2,recommended:2,healthy:0,probation:0,quarantined:0,retired:0},nodes:[
    {address:'old-custom.example.com',origins:['worker'],sources:[],firstSeenAt:now,lastSeenAt:now,misses:0,cloudflareIpv4:false,fluxScore:100,status:'recommended',reasons:['current Worker hostname']},
    {address:'1.1.1.1',origins:['manual'],sources:[],firstSeenAt:now,lastSeenAt:now,misses:0,cloudflareIpv4:false,fluxScore:95,status:'recommended',reasons:[]}
  ]};
  assert.deepEqual(selectSubscriptionAddresses('new-custom.example.com',legacy,DEFAULT_CONFIG),['new-custom.example.com','1.1.1.1']);
  assert.deepEqual(selectSubscriptionAddresses('new-custom.example.com',null,DEFAULT_CONFIG),['new-custom.example.com']);
});
