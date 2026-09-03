import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidPublicHostname } from '../dist/src/security.js';
import { parseUpstreamProxy } from '../dist/src/upstream-config.js';
import { validateConfig } from '../dist/src/config.js';

test('hostname validation blocks control characters and private targets',()=>{
  assert.equal(isValidPublicHostname('example.com'),true);
  assert.equal(isValidPublicHostname('example.com\r\nHost:evil.test'),false);
  assert.equal(isValidPublicHostname('127.0.0.1'),false);
  assert.equal(isValidPublicHostname('10.1.2.3'),false);
  assert.equal(isValidPublicHostname('::ffff:127.0.0.1'),false);
});

test('HTTP CONNECT upstream parser accepts public proxy URLs and credentials',()=>{
  const p=parseUpstreamProxy('https://user:pass@relay.example:8443');
  assert.equal(p.hostname,'relay.example');
  assert.equal(p.port,8443);
  assert.equal(p.secure,true);
  assert.equal(p.username,'user');
  assert.throws(()=>parseUpstreamProxy('http://127.0.0.1:8080'));
});

test('v1-shaped configuration migrates into v2 quality defaults',()=>{
  const c=validateConfig({schemaVersion:1,title:'Old',officialIpCount:2,maxSubscriptionNodes:12});
  assert.equal(c.schemaVersion,2);
  assert.equal(c.title,'Old');
  assert.equal(c.quality.minFluxScore,60);
});

test('quality values and source count are bounded',()=>{
  const sourceUrls=Array.from({length:40},(_,i)=>`https://s${i}.example/list`);
  const c=validateConfig({quality:{minFluxScore:999,maxMisses:999,sourceTimeoutMs:99,sourceAddressLimit:9999},sourceUrls});
  assert.equal(c.quality.minFluxScore,100);
  assert.equal(c.quality.maxMisses,10);
  assert.equal(c.quality.sourceTimeoutMs,1000);
  assert.equal(c.quality.sourceAddressLimit,512);
  assert.equal(c.sourceUrls.length,16);
});
