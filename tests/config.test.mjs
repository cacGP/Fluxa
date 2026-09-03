import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../dist/src/config.js';
import { randomIpFromCidr, parseSourceText } from '../dist/src/nodes.js';

test('config clamps dangerous/unbounded values',()=>{
 const c=validateConfig({officialIpCount:999,maxSubscriptionNodes:999,allowedTargetPorts:[443,443,70000],sourceUrls:['http://bad.test','https://ok.example/list']});
 assert.equal(c.officialIpCount,64);assert.equal(c.maxSubscriptionNodes,128);assert.deepEqual(c.allowedTargetPorts,[443]);assert.deepEqual(c.sourceUrls,['https://ok.example/list']);
});

test('CIDR sampler stays in /24',()=>{
 const ip=randomIpFromCidr('203.0.113.0/24');assert.match(ip,/^203\.0\.113\.\d+$/);
});


test('source parser rejects private addresses and accepts public candidates',()=>{
 const a=parseSourceText('1.1.1.1:443\n10.0.0.1\nexample.com#ok\nlocalhost');
 assert.deepEqual(a,['1.1.1.1','example.com']);
});
