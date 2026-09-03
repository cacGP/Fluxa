const base = (process.env.FLUXA_URL ?? '').replace(/\/+$/,'');
const admin = process.env.FLUXA_ADMIN_TOKEN ?? '';
const sub = process.env.FLUXA_SUB_TOKEN ?? '';

if (!/^https:\/\/[^/]+$/i.test(base) || admin.length < 24 || sub.length < 24) {
  console.error('Set FLUXA_URL=https://your-worker.example, FLUXA_ADMIN_TOKEN, and FLUXA_SUB_TOKEN in the environment.');
  process.exit(2);
}

const checks=[];
async function check(name, fn){
  try { await fn(); checks.push([name,'PASS']); }
  catch (e) { checks.push([name,'FAIL', e instanceof Error ? e.message : String(e)]); }
}
function expect(condition, message){ if(!condition) throw new Error(message); }
async function json(path, init={}){
  const r=await fetch(base+path,{...init,redirect:'manual'});
  const text=await r.text(); let body;
  try { body=JSON.parse(text); } catch { body=null; }
  return {r,text,body};
}

await check('health/version', async()=>{
  const {r,body}=await json('/health');
  expect(r.status===200,'health returned '+r.status);
  expect(body?.ok===true,'health body not ok');
  expect(body?.version==='0.8.0','unexpected version '+String(body?.version));
});

await check('public capabilities', async()=>{
  const {r,body}=await json('/api/capabilities');
  expect(r.status===200,'capabilities returned '+r.status);
  expect(body?.reliability?.serializedWebSocketIngress===true,'serialized ingress capability missing');
  expect(body?.reliability?.cloudflareIpv6Detection===true,'IPv6 detection capability missing');
  expect(body?.reliability?.controlPlaneConsistency===true,'control-plane consistency capability missing');
  expect(body?.reliability?.optimisticConfigWrites===true,'optimistic config writes capability missing');
  expect(body?.reliability?.staleCatalogCommitGuard===true,'stale catalog commit guard capability missing');
});

await check('admin authorization boundary', async()=>{
  const unauth=await fetch(base+'/api/config',{redirect:'manual'});
  expect(unauth.status===401,'unauthorized config returned '+unauth.status);
  const {r,body}=await json('/api/diagnostics',{headers:{authorization:'Bearer '+admin}});
  expect(r.status===200,'diagnostics returned '+r.status);
  expect(body?.ok===true,'diagnostics body not ok');
});

await check('authoritative config revision ETag', async()=>{
  const {r}=await json('/api/config',{headers:{authorization:'Bearer '+admin}});
  expect(r.status===200,'config returned '+r.status);
  const etag=r.headers.get('etag')??'';
  expect(/^"fluxa-config-\d+"$/.test(etag),'config ETag missing or invalid: '+etag);
  const revision=r.headers.get('x-fluxa-config-revision')??'';
  expect(/^\d+$/.test(revision),'config revision header missing');
});

for (const format of ['raw','uri','clash','singbox','loon','surge']) {
  await check('subscription HEAD '+format, async()=>{
    const r=await fetch(`${base}/sub/${encodeURIComponent(sub)}?format=${format}`,{method:'HEAD',redirect:'manual'});
    expect(r.status===200,`${format} returned ${r.status}`);
    expect(r.headers.get('x-fluxa-version')==='0.8.0',`${format} version header missing`);
    expect(!!r.headers.get('etag'),`${format} ETag missing`);
  });
}

await check('wrong subscription token is hidden', async()=>{
  const r=await fetch(`${base}/sub/invalid-smoke-token-000000000000?format=raw`,{method:'HEAD',redirect:'manual'});
  expect(r.status===404,'wrong subscription token returned '+r.status);
});

const failed=checks.filter((x)=>x[1]==='FAIL');
for(const [name,status,detail] of checks) console.log(`${status.padEnd(4)}  ${name}${detail?' — '+detail:''}`);
console.log(`\n${checks.length-failed.length}/${checks.length} smoke checks passed.`);
if(failed.length) process.exit(1);
