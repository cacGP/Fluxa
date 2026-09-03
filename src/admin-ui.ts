export function adminHtml(nonce: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fluxa Admin</title>
<style nonce="${nonce}">
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color-scheme:light dark}body{max-width:1120px;margin:36px auto;padding:0 18px;line-height:1.5}h1{margin-bottom:4px}.muted{opacity:.7}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}.card{border:1px solid #8885;border-radius:12px;padding:14px}.n{font-size:1.55rem;font-weight:700}input,textarea,button{font:inherit}input,textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid #8888;border-radius:9px;margin:6px 0 14px}textarea{min-height:380px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}button{padding:9px 14px;border-radius:9px;border:1px solid #8888;cursor:pointer}.row{display:flex;flex-wrap:wrap;gap:9px}.status{min-height:24px}table{width:100%;border-collapse:collapse;font-size:.92rem;margin-top:12px}th,td{text-align:left;padding:8px;border-bottom:1px solid #8884;vertical-align:top}code{word-break:break-all}.section{margin-top:30px}.good{font-weight:650}.ok{font-weight:650}.warn{font-weight:650}.bad{font-weight:650}.pill{display:inline-block;border:1px solid #8886;border-radius:999px;padding:2px 8px;margin:2px 4px 2px 0}</style></head><body>
<h1>Fluxa 管理后台</h1><p class="muted">v0.8.0 · 管理员令牌仅保存在当前标签页 sessionStorage。配置写入由 Durable Object 串行协调，并使用 ETag 防止旧标签页覆盖新配置；边缘读取仍受 Workers KV 最终一致性影响。</p>
<label>ADMIN_TOKEN</label><input id="token" type="password" autocomplete="off">
<div class="row"><button id="loadCfg">读取配置</button><button id="saveCfg">保存配置</button><button id="loadNodes">节点状态</button><button id="refreshNodes">立即刷新节点目录</button><button id="diagnostics">诊断</button><button id="history">配置历史</button><button id="audit">审计记录</button></div>
<p class="status" id="status"></p>
<div id="summary" class="grid"></div>
<div class="section"><h2>诊断</h2><div id="diag"><p class="muted">点击“诊断”查看只读检查结果。</p></div></div>
<div class="section"><h2>节点质量目录</h2><div id="nodes"></div></div>
<div class="section"><h2>IP 源信誉</h2><div id="sources"></div></div>
<div class="section"><h2>配置历史 / 回滚</h2><div id="historyBox"><p class="muted">保存配置前会自动保留旧配置，最多保留 8 份。</p></div></div>
<div class="section"><h2>审计记录</h2><div id="auditBox"><p class="muted">仅记录配置修改和手动刷新等管理事件，不记录令牌和客户端流量。</p></div></div>
<div class="section"><h2>配置</h2><textarea id="cfg" spellcheck="false"></textarea></div>
<script nonce="${nonce}">
const t=document.querySelector('#token'),c=document.querySelector('#cfg'),s=document.querySelector('#status'),sum=document.querySelector('#summary'),nodes=document.querySelector('#nodes'),sources=document.querySelector('#sources'),diag=document.querySelector('#diag'),historyBox=document.querySelector('#historyBox'),auditBox=document.querySelector('#auditBox');let cfgEtag='';
t.value=sessionStorage.getItem('fluxaAdminToken')||'';
function headers(){sessionStorage.setItem('fluxaAdminToken',t.value);return{authorization:'Bearer '+t.value,'content-type':'application/json'}}
async function req(path,method='GET',body,useMatch=false){s.textContent='处理中…';const h=headers();if(useMatch&&cfgEtag)h['if-match']=cfgEtag;const r=await fetch(path,{method,headers:h,body});const nextEtag=r.headers.get('etag');if(nextEtag&&(path==='/api/config'||path==='/api/config/rollback'))cfgEtag=nextEtag;const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={raw:text}}if(r.status===412||r.status===428)s.textContent='配置已变化或缺少版本条件，请重新读取配置后再操作。';else s.textContent=r.ok?'成功':'失败：'+r.status+' '+text;return r.ok?data:null}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function render(data){const cat=data.catalog||data;if(!cat)return;const q=cat.summary||{};sum.innerHTML=[['总节点',q.total],['可下发',q.eligible],['推荐',q.recommended],['健康',q.healthy],['观察',q.probation],['隔离/退役',(q.quarantined||0)+(q.retired||0)]].map(x=>'<div class="card"><div class="n">'+esc(x[1]??0)+'</div><div class="muted">'+esc(x[0])+'</div></div>').join('');
const list=(cat.nodes||[]).slice(0,120);nodes.innerHTML='<table><thead><tr><th>地址</th><th>FluxScore</th><th>状态</th><th>来源</th><th>缺失</th><th>原因</th></tr></thead><tbody>'+list.map(n=>'<tr><td><code>'+esc(n.address)+'</code></td><td class="good">'+esc(n.fluxScore)+'</td><td>'+esc(n.status)+'</td><td>'+esc((n.origins||[]).join(', '))+'</td><td>'+esc(n.misses)+'</td><td>'+esc((n.reasons||[]).join(' · '))+'</td></tr>').join('')+'</tbody></table>';
sources.innerHTML='<table><thead><tr><th>来源</th><th>信誉</th><th>等级</th><th>成功</th><th>连续失败</th><th>最近接受</th><th>耗时</th></tr></thead><tbody>'+(cat.sourceHealth||[]).map(x=>'<tr><td><code>'+esc(x.url)+'</code></td><td class="good">'+esc(x.reputationScore)+'</td><td>'+esc(x.grade)+'</td><td>'+esc(x.successes)+'/'+esc(x.attempts)+'</td><td>'+esc(x.consecutiveFailures)+'</td><td>'+esc(x.lastAcceptedItems)+'</td><td>'+esc(x.lastDurationMs)+' ms</td></tr>').join('')+'</tbody></table>'}
function renderDiag(d){if(!d)return;diag.innerHTML=(d.checks||[]).map(x=>'<div class="card"><span class="pill">'+esc(x.level)+'</span> <b>'+esc(x.id)+'</b><div>'+esc(x.message)+'</div></div>').join('')}

function renderHistory(d){const list=d?.revisions||[];historyBox.innerHTML=list.length?'<table><thead><tr><th>时间</th><th>原因</th><th>版本ID</th><th>操作</th></tr></thead><tbody>'+list.map(x=>'<tr><td>'+esc(x.at)+'</td><td>'+esc(x.reason)+'</td><td><code>'+esc(x.id)+'</code></td><td><button data-rollback="'+esc(x.id)+'">回滚</button></td></tr>').join('')+'</tbody></table>':'<p class="muted">暂无历史配置。第一次保存新配置后会出现快照。</p>';historyBox.querySelectorAll('[data-rollback]').forEach(b=>b.onclick=async()=>{if(!confirm('确认回滚到这个配置版本？当前配置会先自动备份。'))return;const d=await req('/api/config/rollback','POST',JSON.stringify({id:b.dataset.rollback}),true);if(d?.restored){c.value=JSON.stringify(d.restored,null,2);await loadHistory()}})}
async function loadHistory(){renderHistory(await req('/api/config/history'))}
function renderAudit(d){const list=d?.events||[];auditBox.innerHTML=list.length?'<table><thead><tr><th>时间</th><th>动作</th><th>说明</th></tr></thead><tbody>'+list.map(x=>'<tr><td>'+esc(x.at)+'</td><td><code>'+esc(x.action)+'</code></td><td>'+esc(x.detail||'')+'</td></tr>').join('')+'</tbody></table>':'<p class="muted">暂无审计记录。</p>'}
document.querySelector('#loadCfg').onclick=async()=>{const d=await req('/api/config');if(d)c.value=JSON.stringify(d,null,2)};
document.querySelector('#saveCfg').onclick=async()=>{let body;try{body=JSON.stringify(JSON.parse(c.value))}catch{s.textContent='配置不是合法 JSON';return}const d=await req('/api/config','PUT',body,true);if(d)c.value=JSON.stringify(d,null,2)};
document.querySelector('#loadNodes').onclick=async()=>{const d=await req('/api/nodes');if(d)render(d)};
document.querySelector('#refreshNodes').onclick=async()=>{const d=await req('/api/nodes/refresh','POST');if(d)render(d)};
document.querySelector('#diagnostics').onclick=async()=>renderDiag(await req('/api/diagnostics'));
document.querySelector('#history').onclick=loadHistory;
document.querySelector('#audit').onclick=async()=>renderAudit(await req('/api/audit'));
</script></body></html>`;
}
