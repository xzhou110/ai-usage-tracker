import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../server/http.ts';
import type { Connectors, ProviderId, ConnectorResult, QuotaWindow } from '../shared/schema.ts';

// Synthetic UI verification only. This server never imports real provider connectors.
const project = resolve(import.meta.dirname, '..');
await mkdir(resolve(project, 'out'), { recursive: true });
const root = await mkdtemp(resolve(project, 'out', 'qa-instance-'));
const now = Date.now();
function window(key: string, label: string, used: number | null, resetOffset: number | null, durationMinutes: number | null): QuotaWindow {
  const resetAt = resetOffset === null ? null : new Date(now + resetOffset).toISOString();
  return { key, label, kind:'quota', scope:'personal', usedPercent:used, used:null, limit:null, unit:'percent', resetAt, durationMinutes, cycleId:resetAt, detail:null };
}
const fixtures: Record<ProviderId, QuotaWindow[]> = {
  claude: [window('five_hour','Five-Hour Limit',35,7200000,300),window('seven_day','Weekly Limit',70,259200000,10080)],
  codex: [window('primary','Five-Hour Limit',45,3600000,300),window('secondary','Weekly Limit',92,345600000,10080)],
  cursor: [window('plan','Included Usage',100,-60000,null),{...window('on-demand','On-Demand Spending',null,null,null),kind:'spend',used:3.5,limit:null,unit:'USD'}],
};
const sources = {claude:'claude-statusline',codex:'codex-app-server',cursor:'cursor-browser'} as const;
function fake(id:ProviderId) {
  const result = async ():Promise<ConnectorResult> => ({ observation:{id:randomUUID(),provider:id,source:sources[id],windows:fixtures[id],observedAt:new Date(now).toISOString(),receivedAt:new Date().toISOString()},message:'Synthetic QA fixture. These are not account readings.',verified:false });
  return {connect:result,refresh:result,disconnect:async()=>{},close:async()=>{}};
}
const connectors:Connectors={claude:fake('claude'),codex:fake('codex'),cursor:fake('cursor')};
const instance=await startServer({root,port:8176,distDir:resolve(project,'dist'),connectors,watch:true,poll:false,throttleMs:0});
for(const provider of ['claude','codex','cursor']) await fetch(`${instance.url}/api/providers/${provider}/connect`,{method:'POST',headers:{'Content-Type':'application/json','X-AI-Usage-Tracker':'1'},body:'{}'});
console.log('Synthetic QA instance ready on http://127.0.0.1:8176');
process.once('SIGINT',()=>void instance.close().then(()=>process.exit(0)));
process.once('SIGTERM',()=>void instance.close().then(()=>process.exit(0)));
