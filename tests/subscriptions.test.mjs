import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSubscription, normalizeSubscriptionFormat, detectFormatFromUserAgent, SUPPORTED_FORMATS } from '../dist/src/subscriptions.js';
import { DEFAULT_CONFIG } from '../dist/src/constants.js';

const env={ADMIN_TOKEN:'a'.repeat(32),SUB_TOKEN:'b'.repeat(32),CLIENT_UUID:'550e8400-e29b-41d4-a716-446655440000',TROJAN_PASSWORD:'strong-password-123456'};

test('raw subscription is TLS-only and contains both protocols',()=>{
  const raw=generateSubscription('raw','demo.workers.dev',['demo.workers.dev'],DEFAULT_CONFIG,env);
  const decoded=Buffer.from(raw,'base64').toString('utf8');
  assert.match(decoded,/vless:\/\//);assert.match(decoded,/trojan:\/\//);assert.match(decoded,/security=tls/);assert.doesNotMatch(decoded,/security=none/);
});

test('plain URI format is not base64 wrapped',()=>{
  const text=generateSubscription('uri','demo.workers.dev',['1.1.1.1'],DEFAULT_CONFIG,env);
  assert.match(text,/^vless:\/\//);assert.match(text,/\ntrojan:\/\//);
});

test('Clash selector has proxy nodes and no DIRECT default',()=>{
  const y=generateSubscription('clash','demo.workers.dev',['1.1.1.1'],DEFAULT_CONFIG,env);
  assert.match(y,/type: select/);assert.doesNotMatch(y,/DIRECT/);assert.match(y,/server: "1.1.1.1"/);assert.match(y,/udp: false/);assert.match(y,/encryption: ""/);
});

test('sing-box output is valid JSON with final selector',()=>{
  const j=generateSubscription('singbox','demo.workers.dev',['1.1.1.1'],DEFAULT_CONFIG,env);
  const o=JSON.parse(j);assert.equal(o.outbounds[0].type,'selector');assert.equal(o.outbounds.length,3);assert.equal(o.route.final,'fluxa');
});

test('Loon output includes documented VLESS WSS and Trojan WS forms',()=>{
  const text=generateSubscription('loon','demo.workers.dev',['1.1.1.1'],DEFAULT_CONFIG,env);
  assert.match(text,/\[Proxy\]/);assert.match(text,/ = VLESS,1\.1\.1\.1,443,/);assert.match(text,/transport=ws/);assert.match(text,/over-tls=true/);assert.match(text,/ = trojan,1\.1\.1\.1,443,/);assert.match(text,/\[Proxy Group\]/);
});

test('Surge output only emits documented Trojan compatibility',()=>{
  const text=generateSubscription('surge','demo.workers.dev',['1.1.1.1'],DEFAULT_CONFIG,env);
  assert.match(text,/\[Proxy\]/);assert.match(text,/ = trojan, 1\.1\.1\.1, 443,/);assert.match(text,/ws=true/);assert.doesNotMatch(text,/VLESS/);
});

test('Surge emits explanatory output when Trojan is disabled',()=>{
  const cfg=structuredClone(DEFAULT_CONFIG);cfg.protocols.trojan=false;
  const text=generateSubscription('surge','demo.workers.dev',['1.1.1.1'],cfg,env);
  assert.match(text,/requires the Trojan protocol/i);
});

test('format aliases and auto detection are deterministic',()=>{
  assert.equal(normalizeSubscriptionFormat('mihomo'),'clash');
  assert.equal(normalizeSubscriptionFormat('v2rayn'),'raw');
  assert.equal(normalizeSubscriptionFormat('shadowrocket'),'raw');
  assert.equal(normalizeSubscriptionFormat('auto','ClashMeta/1.19'),'clash');
  assert.equal(normalizeSubscriptionFormat('auto','sing-box 1.12'),'singbox');
  assert.equal(detectFormatFromUserAgent('Loon/1000'),'loon');
  assert.equal(detectFormatFromUserAgent('Surge/6.0'),'surge');
  assert.equal(normalizeSubscriptionFormat('unknown'),null);
  assert.deepEqual([...SUPPORTED_FORMATS],['raw','uri','clash','singbox','loon','surge']);
});
