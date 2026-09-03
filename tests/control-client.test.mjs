import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ControlConflictError,
  getAuthoritativeConfig,
  PreconditionRequiredError,
  updateConfigViaCoordinator
} from '../dist/src/control-client.js';
import { DEFAULT_CONFIG } from '../dist/src/constants.js';

function envWith(handler,seen={}){
  return {env:{FLUXA_COORDINATOR:{idFromName(name){seen.name=name;return{name}},get(){return{fetch:handler}}}},seen};
}

test('authoritative config client uses the stable global coordinator object',async()=>{
  const {env,seen}=envWith(async(input)=>{seen.url=String(input);return new Response(JSON.stringify({ok:true,config:DEFAULT_CONFIG,revision:7}),{headers:{'content-type':'application/json'}})});
  const result=await getAuthoritativeConfig(env);
  assert.equal(seen.name,'catalog');
  assert.equal(seen.url,'https://fluxa.internal/config/get');
  assert.equal(result.revision,7);
  assert.equal(result.etag,'"fluxa-config-7"');
});

test('config updates require If-Match and send the expected revision to the coordinator',async()=>{
  await assert.rejects(()=>updateConfigViaCoordinator({},DEFAULT_CONFIG,null),(e)=>e instanceof PreconditionRequiredError);
  const seen={};
  const {env}=envWith(async(_input,init)=>{seen.body=JSON.parse(String(init.body));return new Response(JSON.stringify({ok:true,config:{...DEFAULT_CONFIG,title:'Updated'},revision:8}),{headers:{'content-type':'application/json'}})},seen);
  const result=await updateConfigViaCoordinator(env,{...DEFAULT_CONFIG,title:'Updated'},'"fluxa-config-7"');
  assert.equal(seen.body.expectedRevision,7);
  assert.equal(result.revision,8);
  assert.equal(result.config.title,'Updated');
});

test('coordinator revision conflicts remain distinguishable from generic errors',async()=>{
  const {env}=envWith(async()=>new Response(JSON.stringify({ok:false,error:'configuration changed',currentRevision:9}),{status:412,headers:{'content-type':'application/json'}}));
  await assert.rejects(()=>updateConfigViaCoordinator(env,DEFAULT_CONFIG,'"fluxa-config-8"'),(e)=>e instanceof ControlConflictError&&e.currentRevision===9);
});
