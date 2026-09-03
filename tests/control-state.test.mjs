import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ControlRevisionConflict,
  appendControlAudit,
  configRevisionEtag,
  createControlState,
  parseConfigRevisionEtag,
  rollbackControlConfig,
  updateControlConfig
} from '../dist/src/control-state.js';
import { DEFAULT_CONFIG } from '../dist/src/constants.js';

test('control state increments revisions and snapshots the previous config',()=>{
  const initial=createControlState(DEFAULT_CONFIG);
  const next=updateControlConfig(initial,{...DEFAULT_CONFIG,title:'Fluxa Next'},1);
  assert.equal(next.revision,2);
  assert.equal(next.config.title,'Fluxa Next');
  assert.equal(next.history.length,1);
  assert.equal(next.history[0].config.title,DEFAULT_CONFIG.title);
  assert.equal(next.audit[0].action,'config.update');
});

test('stale config revisions fail closed instead of overwriting newer state',()=>{
  const initial=createControlState(DEFAULT_CONFIG);
  const next=updateControlConfig(initial,{...DEFAULT_CONFIG,title:'A'},1);
  assert.throws(()=>updateControlConfig(next,{...DEFAULT_CONFIG,title:'B'},1),(error)=>error instanceof ControlRevisionConflict&&error.currentRevision===2);
});

test('rollback restores a validated snapshot while preserving the current config in history',()=>{
  const initial=createControlState(DEFAULT_CONFIG);
  const updated=updateControlConfig(initial,{...DEFAULT_CONFIG,title:'Changed'},1);
  const targetId=updated.history[0].id;
  const result=rollbackControlConfig(updated,targetId,2);
  assert.equal(result.state.revision,3);
  assert.equal(result.state.config.title,DEFAULT_CONFIG.title);
  assert.equal(result.state.history[0].config.title,'Changed');
  assert.equal(result.state.audit[0].action,'config.rollback');
});

test('control audit is bounded/sanitized and config ETags round trip',()=>{
  let state=createControlState(DEFAULT_CONFIG);
  for(let i=0;i<70;i++) state=appendControlAudit(state,'catalog.refresh',`item ${i}\nsecret-ish`);
  assert.equal(state.audit.length,50);
  assert.ok(!state.audit[0].detail.includes('\n'));
  assert.equal(parseConfigRevisionEtag(configRevisionEtag(42)),42);
  assert.equal(parseConfigRevisionEtag('W/"fluxa-config-42"'),42);
  assert.equal(parseConfigRevisionEtag('"wrong-42"'),null);
});
