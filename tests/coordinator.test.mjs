import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshViaCoordinator } from '../dist/src/coordinator-client.js';
import { DEFAULT_CONFIG } from '../dist/src/constants.js';

function sampleCatalog(){
  return {schemaVersion:1,generatedAt:new Date().toISOString(),configFingerprint:'abc',sourceHealth:[],nodes:[],summary:{total:0,eligible:0,recommended:0,healthy:0,probation:0,quarantined:0,retired:0}};
}

test('coordinator client routes catalog refresh to the stable global object name',async()=>{
  const seen={name:null,url:null,body:null};
  const catalog=sampleCatalog();
  const env={FLUXA_COORDINATOR:{
    idFromName(name){seen.name=name;return {name}},
    get(){return {async fetch(input,init){seen.url=String(input);seen.body=JSON.parse(String(init.body));return new Response(JSON.stringify({ok:true,catalog}),{headers:{'content-type':'application/json'}})}}}
  }};
  const result=await refreshViaCoordinator(env,DEFAULT_CONFIG);
  assert.equal(seen.name,'catalog');
  assert.equal(seen.url,'https://fluxa.internal/refresh');
  assert.deepEqual(seen.body.config,DEFAULT_CONFIG);
  assert.deepEqual(result,catalog);
});

test('coordinator client fails closed on missing binding and coordinator errors',async()=>{
  await assert.rejects(()=>refreshViaCoordinator({},DEFAULT_CONFIG),/not configured/);
  const env={FLUXA_COORDINATOR:{idFromName(){return{}},get(){return{async fetch(){return new Response(JSON.stringify({ok:false,error:'busy'}),{status:503})}}}}};
  await assert.rejects(()=>refreshViaCoordinator(env,DEFAULT_CONFIG),/busy/);
});
