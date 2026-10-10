// Read-only DNS/HTTPS and authoritative SIDN RDAP lookup. Never registers a domain.
import fs from 'node:fs/promises';
import dns from 'node:dns/promises';
const sites=JSON.parse(await fs.readFile('src/config/sites.json','utf8'));
const reportPath='artifacts/production-domain-availability-2026-10-10.json';
const retryUnknown=process.argv.includes('--retry-unknown');
const previous=retryUnknown ? JSON.parse(await fs.readFile(reportPath,'utf8')) : null;
const rdapDomain=process.argv.find(arg=>arg.startsWith('--rdap-domain='))?.slice('--rdap-domain='.length);
const configuredEmergencyDomains=['elektra','lekkage','gas'].map(id=>new URL(sites[id].domain).hostname.replace(/^www\./,''));
if(rdapDomain && (!retryUnknown || !configuredEmergencyDomains.includes(rdapDomain))) throw new Error('Scoped retries require --retry-unknown and a configured emergency domain.');
const results=[];
for(const id of ['lbi','elektra','lekkage','gas']) {
  const origin=sites[id].domain;
  const hostname=new URL(origin).hostname;
  const domain=hostname.replace(/^www\./,'');
  if(!/^[a-z0-9-]+\.nl$/.test(domain)) throw new Error('Only the configured .nl domain names are in scope.');
  const item={site:id,domain,origin,dns:{},https:{},registration:{status:'not-checked'}};
  for(const name of [domain,hostname]) {
    const answers=await Promise.allSettled([dns.resolve4(name),dns.resolve6(name)]);
    item.dns[name]={A:answers[0].status==='fulfilled' ? answers[0].value : [],AAAA:answers[1].status==='fulfilled' ? answers[1].value : [],errors:answers.filter(x=>x.status==='rejected').map(x=>x.reason.code || x.reason.message)};
  }
  try {
    const response=await fetch(origin,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(12000)});
    item.https={status:response.status,finalUrl:response.url};
  } catch(error) {item.https={error:error.cause?.code || error.code || error.message};}
  if(id!=='lbi') {
    const url='https://rdap.sidn.nl/domain/'+domain;
    const prior=previous?.sites.find(site=>site.domain===domain)?.registration;
    if(prior?.httpStatus===404 && prior.domainStatus?.includes('free')) {
      item.registration={...prior,checkedAt:prior.checkedAt || previous.checkedAt,status:'available'};
      results.push(item);
      continue;
    }
    if(rdapDomain && rdapDomain!==domain) {
      item.registration=prior ? {...prior,checkedAt:prior.checkedAt || previous.checkedAt} : {status:'not-checked'};
      results.push(item);
      continue;
    }
    try {
      const response=await fetch(url,{headers:{Accept:'application/rdap+json, application/json'},signal:AbortSignal.timeout(15000)});
      const data=await response.json();
      item.registration={source:url,checkedAt:new Date().toISOString(),httpStatus:response.status,retryAfter:response.headers.get('retry-after'),status:response.status===404 && (data.errorCode===404 || data.status?.includes('free')) ? 'available' : response.ok && data.ldhName?.toLowerCase()===domain ? 'registered-or-withheld' : 'unknown',errorCode:data.errorCode,title:data.title,description:data.description,domainStatus:data.status,ldhName:data.ldhName};
    } catch(error) {item.registration={source:url,status:'unknown',error:error.cause?.code || error.code || error.message};}
    // Use --rdap-domain for one scoped retry after a SIDN rate-limit response.
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  results.push(item);
}
const report={checkedAt:new Date().toISOString(),timezone:'Europe/Berlin',scope:'Configured LBI domains: read-only DNS/HTTPS; emergency domains: SIDN registration availability',interpretation:'SIDN RDAP manual v1.3 maps domain HTTP 404 to free. Availability is a timestamped lookup, not a reservation. No holder/contact fields requested or retained.',sites:results};
await fs.mkdir('artifacts',{recursive:true});
await fs.writeFile(reportPath,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
