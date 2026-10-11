import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {ApiError,getConfig} from './config';

function isPublicIPv4(ip:string){
  const parts=ip.split('.').map(Number);if(parts.length!==4||parts.some(v=>v<0||v>255||!Number.isInteger(v)))return false;
  const [a,b,c]=parts;
  if(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127)return false;
  if(a===192&&(b===0||b===0&&c===0||b===0&&c===2)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)return false;
  if(a===192&&b===88&&c===99)return false;
  return true;
}
function isPublicIP(ip:string){
  if(isIP(ip)===4)return isPublicIPv4(ip);
  if(isIP(ip)!==6)return false;
  const h=ip.toLowerCase();if(h==='::'||h==='::1'||h.startsWith('fc')||h.startsWith('fd')||h.startsWith('fe8')||h.startsWith('fe9')||h.startsWith('fea')||h.startsWith('feb')||h.startsWith('ff'))return false;
  if(h.startsWith('::ffff:'))return isPublicIPv4(h.slice(7));
  if(h.startsWith('2001:db8:'))return false;
  return true;
}
export function normalizePanelUrl(value:string){
  let u:URL;try{u=new URL(value.trim());}catch{throw new ApiError(400,'Domain panel tidak valid. Gunakan https://panel.domain.com.');}
  const cfg=getConfig();
  if(u.protocol!=='https:' && !(cfg.insecureDev&&process.env.NODE_ENV!=='production'&&u.protocol==='http:'))throw new ApiError(400,'URL panel harus HTTPS.');
  if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.port)throw new ApiError(400,'Masukkan domain panel tanpa path, port, atau parameter.');
  const host=u.hostname.toLowerCase().replace(/\.$/,'');
  if(host==='localhost'||isIP(host)!==0||!host.includes('.')||/\.(local|internal|localhost|test|invalid|example)$/i.test(host))throw new ApiError(400,'Gunakan domain panel publik, bukan localhost atau IP pribadi.');
  if(!/^[a-z0-9.-]+$/.test(host))throw new ApiError(400,'Nama domain tidak valid.');
  if(cfg.allowedHosts.length&&!cfg.allowedHosts.includes(host))throw new ApiError(403,'Domain panel tidak tercantum di PANEL_ALLOWED_HOSTS.');
  return `${u.protocol}//${host}`;
}
export async function assertPublicDomain(url:string){
  const u=new URL(url);const host=u.hostname;
  let addresses;try{addresses=await lookup(host,{all:true});}catch{throw new ApiError(502,'Domain panel tidak dapat di-resolve. Periksa DNS-nya.');}
  if(addresses.length===0||addresses.some(a=>!isPublicIP(a.address)))throw new ApiError(403,'Domain panel mengarah ke jaringan privat/tidak aman.');
}
async function request<T>(url:string,key:string,path:string,client=false,method:'GET'|'DELETE'='GET'):Promise<T>{
  await assertPublicDomain(url);
  const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),14000);
  try{
    const resp=await fetch(`${url}/api/${client?'client':'application'}${path}`,{method,headers:{Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'},cache:'no-store',redirect:'error',signal:ctl.signal});
    if(resp.status===401||resp.status===403)throw new ApiError(403,`${client?'PTLC':'PTLA'} ditolak. Periksa izin API key.`);
    if(resp.status===404)throw new ApiError(404,'Data tidak ditemukan pada panel.');
    if(resp.status===429)throw new ApiError(429,'Pterodactyl membatasi request. Coba lagi sesaat.');
    if(!resp.ok){const body=(await resp.text()).slice(0,250);throw new ApiError(502,`Panel mengembalikan HTTP ${resp.status}${body.includes('Too Many Requests')?': terlalu banyak request':''}.`)}
    if(method==='DELETE')return null as T;
    return await resp.json() as T;
  }catch(e){if(e instanceof ApiError)throw e;throw new ApiError(502,'Panel tidak dapat dihubungi. Periksa domain, SSL, koneksi, dan izin API.');}
  finally{clearTimeout(timer)}
}
export type PteroUser={id:number,username:string,email:string,root_admin:boolean,first_name?:string,last_name?:string};
export type PteroServer={id:number,identifier:string,name:string,user:number,node:number,suspended:boolean,limits?:{memory:number,cpu:number,disk:number},container?:{startup_command:string}};
type Collection<T>={data:{attributes:T}[],meta:{pagination:{current_page:number,total_pages:number,total:number}}};
export async function pageAll<T>(url:string,key:string,resource:'servers'|'users'):Promise<{items:T[],total:number}>{
  const first=await request<Collection<T>>(url,key,`/${resource}?page=1&per_page=100`);
  if(!first?.meta?.pagination||!Array.isArray(first.data))throw new ApiError(502,'Respons Pterodactyl tidak sesuai format API.');
  const meta=first.meta.pagination;
  const totalPages=Number(meta.total_pages);const total=Number(meta.total);
  if(!Number.isSafeInteger(totalPages)||totalPages<1||!Number.isSafeInteger(total)||total<0)throw new ApiError(502,'Pagination Pterodactyl tidak valid.');
  const lists:T[][]=[first.data.map(x=>x.attributes)];
  for(let base=2;base<=totalPages;base+=5){
    const pages=Array.from({length:Math.min(5,totalPages-base+1)},(_,i)=>base+i);
    const results=await Promise.all(pages.map(async n=>{
      const r=await request<Collection<T>>(url,key,`/${resource}?page=${n}&per_page=100`);
      if(!Array.isArray(r.data))throw new ApiError(502,'Daftar Pterodactyl tidak lengkap.');
      return r.data.map(x=>x.attributes);
    }));lists.push(...results);
  }
  const items=lists.flat();
  if(items.length!==total)throw new ApiError(409,'Data panel berubah saat pengambilan. Muat ulang untuk angka terbaru.');
  return {items,total};
}
export async function getSnapshot(url:string,ptla:string){
  const [servers,users]=await Promise.all([pageAll<PteroServer>(url,ptla,'servers'),pageAll<PteroUser>(url,ptla,'users')]);
  return {servers:servers.items,users:users.items,totalServers:servers.total,totalUsers:users.total,totalAdmins:users.items.filter(u=>u.root_admin).length,suspended:servers.items.filter(s=>s.suspended).length,checkedAt:new Date().toISOString()};
}
export async function validatePtla(url:string,ptla:string){await request(url,ptla,'/users?page=1&per_page=1')}
export async function validatePtlc(url:string,ptlc:string){await request(url,ptlc,'/account',true)}
export async function deleteServer(url:string,ptla:string,id:number){return request(url,ptla,`/servers/${id}`,false,'DELETE')}
export async function deleteUser(url:string,ptla:string,id:number){return request(url,ptla,`/users/${id}`,false,'DELETE')}
export type ServerState='running'|'offline'|'starting'|'stopping'|'unknown';
export async function serverStatus(url:string,ptlc:string,identifier:string):Promise<ServerState>{
  try{
    const r=await request<{attributes?:{current_state?:string}}>(url,ptlc,`/servers/${encodeURIComponent(identifier)}/resources`,true);
    const state=r.attributes?.current_state;
    return state==='running'||state==='offline'||state==='starting'||state==='stopping'?state:'unknown';
  }catch{return 'unknown'}
}
export async function statuses(url:string,ptlc:string,servers:PteroServer[]){
  const result:Record<number,ServerState>={};
  // Max 5 simultaneous status requests to respect provider limits.
  for(let i=0;i<servers.length;i+=5){await Promise.all(servers.slice(i,i+5).map(async s=>{result[s.id]=await serverStatus(url,ptlc,s.identifier)}))}
  return result;
}
