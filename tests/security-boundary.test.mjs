import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicTarget } from '../dist/src/dns-security.js';
import { readJsonLimited, safeDecodePathComponent, randomCspNonce } from '../dist/src/http-utils.js';
import { validateConfig } from '../dist/src/config.js';
import { adminHtml } from '../dist/src/admin-ui.js';
import { isValidPublicHostname } from '../dist/src/security.js';

const resolver = (records) => async (_host,type) => records[type] ?? [];

test('upstream target resolution pins a public IP and rejects DNS rebinding to private space', async()=>{
  const publicTarget=await resolvePublicTarget('example.com',resolver({A:['1.1.1.1'],AAAA:['2606:4700:4700::1111']}));
  assert.equal(publicTarget.selectedAddress,'1.1.1.1');
  assert.deepEqual(publicTarget.addresses,['1.1.1.1','2606:4700:4700::1111']);
  await assert.rejects(()=>resolvePublicTarget('rebind.example',resolver({A:['10.0.0.7'],AAAA:[]})),/non-public/);
  await assert.rejects(()=>resolvePublicTarget('mixed.example',resolver({A:['1.1.1.1','127.0.0.1'],AAAA:[]})),/non-public/);
});

test('literal private targets are rejected before DNS resolution', async()=>{
  let called=false;
  await assert.rejects(()=>resolvePublicTarget('127.0.0.1',async()=>{called=true;return[];}),/valid public/);
  assert.equal(called,false);
});

test('proxy paths cannot collide with management/subscription routes or each other',()=>{
  const c=validateConfig({paths:{vless:'/api/config',trojan:'/api/config'}});
  assert.equal(c.paths.vless,'/ws/vless');
  assert.equal(c.paths.trojan,'/ws/trojan');
  const d=validateConfig({paths:{vless:'/custom',trojan:'/custom'}});
  assert.equal(d.paths.vless,'/custom');
  assert.notEqual(d.paths.trojan,d.paths.vless);
});

test('bounded JSON reader rejects oversized or non-JSON admin payloads',async()=>{
  const ok=new Request('https://example.test/api/config',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Fluxa'})});
  assert.deepEqual(await readJsonLimited(ok,1024),{title:'Fluxa'});
  const large=new Request('https://example.test/api/config',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({x:'a'.repeat(200)})});
  await assert.rejects(()=>readJsonLimited(large,64),/too large/);
  const wrongType=new Request('https://example.test/api/config',{method:'PUT',headers:{'content-type':'text/plain'},body:'{}'});
  await assert.rejects(()=>readJsonLimited(wrongType,1024),/content-type/);
});

test('malformed URL escapes fail closed instead of throwing',()=>{
  assert.equal(safeDecodePathComponent('good%20token'),'good token');
  assert.equal(safeDecodePathComponent('%E0%A4%A'),null);
  assert.equal(safeDecodePathComponent('%'),null);
});

test('admin HTML uses a per-response CSP nonce rather than an unrestricted script tag',()=>{
  const nonce=randomCspNonce();
  assert.match(nonce,/^[A-Za-z0-9_-]{20,}$/);
  const html=adminHtml(nonce);
  assert.ok(html.includes(`<script nonce="${nonce}">`));
  assert.ok(html.includes(`<style nonce="${nonce}">`));
  assert.equal(html.includes('<script>'),false);
});


test('public-target classifier blocks expanded IPv6 loopback/private forms without overblocking public IPv4',()=>{
  assert.equal(isValidPublicHostname('0:0:0:0:0:0:0:1'),false);
  assert.equal(isValidPublicHostname('0000:0000:0000:0000:0000:ffff:7f00:0001'),false);
  assert.equal(isValidPublicHostname('fc00::1'),false);
  assert.equal(isValidPublicHostname('2001:db8::1'),false);
  assert.equal(isValidPublicHostname('2606:4700:4700::1111'),true);
  assert.equal(isValidPublicHostname('192.0.2.1'),false);
  assert.equal(isValidPublicHostname('192.0.1.1'),true);
});

test('admin config writes carry optimistic If-Match protection',()=>{
  const html=adminHtml('nonce12345678901234567890');
  assert.ok(html.includes("h['if-match']=cfgEtag"));
  assert.ok(html.includes("req('/api/config','PUT',body,true)"));
  assert.ok(html.includes("req('/api/config/rollback','POST'"));
  assert.ok(html.includes('r.status===412||r.status===428'));
});
