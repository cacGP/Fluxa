import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVlessRequest } from '../dist/src/protocols/vless.js';
import { parseTrojanRequest, trojanPasswordHash } from '../dist/src/protocols/trojan.js';

const uuid='550e8400-e29b-41d4-a716-446655440000';
function uuidBytes(u){return Uint8Array.from(u.replaceAll('-','').match(/../g).map(x=>parseInt(x,16)))}

test('VLESS parses a domain TCP request',()=>{
  const domain=new TextEncoder().encode('example.com');
  const b=new Uint8Array(1+16+1+1+2+1+1+domain.length+3);let i=0;
  b[i++]=0;b.set(uuidBytes(uuid),i);i+=16;b[i++]=0;b[i++]=1;b[i++]=1;b[i++]=187;b[i++]=2;b[i++]=domain.length;b.set(domain,i);i+=domain.length;b.set([1,2,3],i);
  const r=parseVlessRequest(b,uuid);assert.equal(r.ok,true);if(r.ok){assert.equal(r.value.host,'example.com');assert.equal(r.value.port,443);assert.deepEqual([...r.value.payload],[1,2,3]);}
});

test('Trojan parses a domain CONNECT request',()=>{
  const password='correct horse battery staple'; const hash=new TextEncoder().encode(trojanPasswordHash(password)); const domain=new TextEncoder().encode('example.com');
  const b=new Uint8Array(56+2+1+1+1+domain.length+2+2+2);let i=0;b.set(hash,i);i+=56;b.set([13,10],i);i+=2;b[i++]=1;b[i++]=3;b[i++]=domain.length;b.set(domain,i);i+=domain.length;b.set([1,187,13,10,9,8],i);
  const r=parseTrojanRequest(b,password);assert.equal(r.ok,true);if(r.ok){assert.equal(r.value.host,'example.com');assert.equal(r.value.port,443);assert.deepEqual([...r.value.payload],[9,8]);}
});


test('VLESS rejects an incorrect UUID without accepting a near match',()=>{
  const domain=new TextEncoder().encode('example.com');
  const b=new Uint8Array(1+16+1+1+2+1+1+domain.length);let i=0;
  b[i++]=0;b.set(uuidBytes(uuid),i);i+=16;b[i++]=0;b[i++]=1;b[i++]=1;b[i++]=187;b[i++]=2;b[i++]=domain.length;b.set(domain,i);
  const r=parseVlessRequest(b,'550e8400-e29b-41d4-a716-446655440001');
  assert.equal(r.ok,false);
  if(!r.ok) assert.match(r.error??'',/invalid client UUID/);
});

test('Trojan rejects an incorrect password hash',()=>{
  const password='correct horse battery staple'; const hash=new TextEncoder().encode(trojanPasswordHash(password)); const domain=new TextEncoder().encode('example.com');
  const b=new Uint8Array(56+2+1+1+1+domain.length+2+2);let i=0;b.set(hash,i);i+=56;b.set([13,10],i);i+=2;b[i++]=1;b[i++]=3;b[i++]=domain.length;b.set(domain,i);i+=domain.length;b.set([1,187,13,10],i);
  const r=parseTrojanRequest(b,'correct horse battery staplf');
  assert.equal(r.ok,false);
  if(!r.ok) assert.match(r.error??'',/invalid Trojan password/);
});
