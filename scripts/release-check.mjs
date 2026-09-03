import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const forbidden = [
  /ADMIN_TOKEN\s*[=:]\s*["'][^"']{24,}["']/i,
  /SUB_TOKEN\s*[=:]\s*["'][^"']{24,}["']/i,
  /TROJAN_PASSWORD\s*[=:]\s*["'][^"']{16,}["']/i
];
const ignored = new Set(['.git','dist','node_modules','tests']);
const hits=[];
async function walk(dir){
  for(const ent of await readdir(dir,{withFileTypes:true})){
    if(ignored.has(ent.name)) continue;
    const path=join(dir,ent.name);
    if(ent.isDirectory()) await walk(path);
    else if(/\.(ts|js|mjs|json|jsonc|md|yml|yaml|example)$/.test(ent.name)){
      const text=await readFile(path,'utf8');
      for(const re of forbidden) if(re.test(text)) hits.push(relative(root,path));
    }
  }
}
await walk(root);
if(hits.length){console.error('Potential hard-coded secret material:', [...new Set(hits)].join(', '));process.exit(1)}

const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const { VERSION }=await import(new URL('../dist/src/constants.js', import.meta.url));
if(pkg.version!==VERSION){console.error(`Version mismatch: package.json=${pkg.version}, runtime=${VERSION}`);process.exit(1)}
if(pkg.engines?.node!=='>=22'){console.error('Fluxa release policy requires engines.node to be >=22');process.exit(1)}
for(const name of ['typescript','wrangler']){
  const value=String(pkg.devDependencies?.[name]??'');
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)){
    console.error(`${name} must be pinned to an exact version; got ${value||'(missing)'}`);process.exit(1);
  }
}


const coordinator=await readFile(join(root,'src/coordinator.ts'),'utf8');
for(const required of ['CONTROL_STATE_KEY','/config/update','/config/rollback','/audit/append','assertActiveConfig','persistConfigState']){
  if(!coordinator.includes(required)){console.error(`src/coordinator.ts missing v0.8 control-plane requirement: ${required}`);process.exit(1);}
}
const indexSource=await readFile(join(root,'src/index.ts'),'utf8');
for(const required of ['optimisticConfigWrites','staleCatalogCommitGuard','request.headers.get("if-match")','getAuthoritativeConfig']){
  if(!indexSource.includes(required)){console.error(`src/index.ts missing v0.8 consistency wiring: ${required}`);process.exit(1);}
}
for(const workflowPath of ['.github/workflows/ci.yml','.github/workflows/release-gate.yml']){
  const workflow=await readFile(join(root,workflowPath),'utf8');
  if(!workflow.includes('wrangler deploy --dry-run')){console.error(`${workflowPath} must run Wrangler deploy --dry-run`);process.exit(1);}
}

const wrangler=await readFile(join(root,'wrangler.jsonc'),'utf8');
for(const required of ['"FLUXA_COORDINATOR"','"FluxaCoordinator"','"durable_objects"','"exports"','"storage": "sqlite"']){
  if(!wrangler.includes(required)){console.error(`wrangler.jsonc missing required global coordination declaration: ${required}`);process.exit(1);}
}

console.log(`Release check: Fluxa ${VERSION}; secrets clean; toolchain pinned; v0.8 control-plane consistency wired; Durable Object declared; Wrangler dry-run wired in CI.`);
