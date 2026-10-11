import {NextRequest,NextResponse} from 'next/server';
import {ApiError,getConfig} from '@/lib/config';
import {assertPublicDomain,deleteServer,deleteUser,getSnapshot,normalizePanelUrl,serverStatus,statuses,validatePtla,validatePtlc,PteroServer,PteroUser} from '@/lib/ptero';
import {audit,clearSession,closeSession,currentSession,history,savePtlc,startSession,Session} from '@/lib/session';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const json=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{'Cache-Control':'no-store'}});
async function body(req:NextRequest){let v:unknown;try{v=await req.json()}catch{throw new ApiError(400,'JSON request tidak valid.')}if(!v||typeof v!=='object'||Array.isArray(v))throw new ApiError(400,'Format data tidak valid.');return v as Record<string,unknown>}
function limitString(v:unknown,max:number){return typeof v==='string'&&v.trim().length<=max?v.trim():''}
function idsFrom(v:unknown):number[]{if(!Array.isArray(v)||v.length>10||v.length<1)throw new ApiError(400,'Pilih 1–10 item untuk setiap batch.');const a=v.map(Number);if(a.some(n=>!Number.isSafeInteger(n)||n<=0)||new Set(a).size!==a.length)throw new ApiError(400,'ID item tidak valid.');return a}
function csrf(req:NextRequest){const h=req.headers.get('origin');if(!h||h!==req.nextUrl.origin)throw new ApiError(403,'Request ditolak: origin berbeda.');}
async function guarded<T>(fn:()=>Promise<T>):Promise<T|NextResponse>{try{return await fn()}catch(e){if(e instanceof ApiError)return json({error:e.message},e.status);console.error('API operation error:',e instanceof Error?e.message:'unknown');return json({error:'Terjadi masalah pada server atau database. Periksa ENV dan koneksi Turso.'},500)}}
async function route(req:NextRequest, method:'GET'|'POST',params:Promise<{path?:string[]}>) {return guarded(async()=>{
  const path=(await params).path?.join('/')||'';
  if(method==='POST')csrf(req);
  if(method==='POST'&&path==='connect'){
    const data=await body(req),url=normalizePanelUrl(limitString(data.url,250)),key=limitString(data.key,250);
    if(!/^ptla_[a-zA-Z0-9_-]{8,}$/.test(key))throw new ApiError(400,'Masukkan API Key Application Pterodactyl yang valid (ptla_...).');
    await assertPublicDomain(url);await validatePtla(url,key);
    const res=json({ok:true,url});await startSession(res,url,key);return res;
  }
  const res=json({ok:true});const session=await currentSession(req,res);
  if(method==='GET'&&path==='session')return response(res,{connected:true,url:session.url,ptlc:!!session.ptlc,bulk:getConfig().bulk});
  if(method==='GET'&&path==='dashboard'){
    const snapshot=await getSnapshot(session.url,session.ptla);
    return response(res,{...snapshot,ptlc:!!session.ptlc,bulk:getConfig().bulk});
  }
  if(method==='GET'&&path==='activity')return response(res,{activities:await history(session)});
  if(method==='GET'&&path==='statuses'){
    if(!session.ptlc)throw new ApiError(422,'Status online/offline membutuhkan API Key Client (PTLC) di Pengaturan.');
    const snap=await getSnapshot(session.url,session.ptla);
    return response(res,{statuses:await statuses(session.url,session.ptlc,snap.servers),checkedAt:new Date().toISOString()});
  }
  if(method==='POST'&&path==='ptlc'){
    const d=await body(req),key=limitString(d.key,300);
    if(key&&!/^ptlc_[a-zA-Z0-9_-]{8,}$/.test(key))throw new ApiError(400,'Masukkan PTLC key yang valid.');
    if(key)await validatePtlc(session.url,key);
    await savePtlc(session,key||null);await audit(session,'settings','client_api',key?'PTLC ditambahkan':'PTLC dihapus');return response(res,{ok:true,ptlc:!!key});
  }
  if(method==='POST'&&path==='disconnect'){
    await audit(session,'disconnect','session','success');await closeSession(session);clearSession(res);return response(res,{ok:true});
  }
  if(method==='POST'&&path==='preview'){
    if(!getConfig().bulk)throw new ApiError(403,'Hapus massal tidak aktif di ENV.');
    const d=await body(req);const mode=d.mode;
    const snap=await getSnapshot(session.url,session.ptla);
    if(mode==='orphan-users'){
      const owners=new Set(snap.servers.map(s=>s.user));
      return response(res,{mode,items:snap.users.filter(u=>!u.root_admin&&!owners.has(u.id)).map(u=>({id:u.id,name:u.username})),skippedAdmins:snap.totalAdmins});
    }
    if(mode==='offline-servers'){
      if(!session.ptlc)throw new ApiError(422,'Atur PTLC agar status offline bisa dibuktikan sebelum penghapusan.');
      const list=await statuses(session.url,session.ptlc,snap.servers);
      return response(res,{mode,items:snap.servers.filter(s=>list[s.id]==='offline').map(s=>({id:s.id,name:s.name})),unknown:Object.values(list).filter(v=>v==='unknown').length});
    }
    throw new ApiError(400,'Mode preview tidak dikenal.');
  }
  if(method==='POST'&&path==='delete'){
    const d=await body(req),kind=d.kind,mode=d.mode;
    if(d.confirm!=='HAPUS')throw new ApiError(400,'Ketik HAPUS untuk konfirmasi.');
    const ids=idsFrom(d.ids);
    if(ids.length>1&&!getConfig().bulk)throw new ApiError(403,'Hapus massal dinonaktifkan.');
    if(kind!=='server'&&kind!=='user')throw new ApiError(400,'Jenis data tidak valid.');
    if(mode!=='selected'&&mode!=='offline'&&mode!=='orphan')throw new ApiError(400,'Mode penghapusan tidak valid.');
    if(mode==='offline'&&kind!=='server'||mode==='orphan'&&kind!=='user')throw new ApiError(400,'Jenis penghapusan tidak sesuai.');
    if(mode!=='selected'&&!getConfig().bulk)throw new ApiError(403,'Hapus massal dinonaktifkan.');
    const result:{id:number,ok:boolean,reason?:string}[]=[];
    for(const id of ids){
      try{
        const snap=await getSnapshot(session.url,session.ptla);
        if(kind==='server'){
          const item=snap.servers.find(s=>s.id===id);if(!item){result.push({id,ok:false,reason:'Server sudah tidak ada'});continue}
          if(mode==='offline'){
            if(!session.ptlc)throw new ApiError(422,'PTLC tidak tersedia');
            const state=await serverStatus(session.url,session.ptlc,item.identifier);
            if(state!=='offline'){result.push({id,ok:false,reason:`Status ${state}; tidak dihapus`});continue}
          }
          await deleteServer(session.url,session.ptla,id);
        }else{
          const item=snap.users.find(u=>u.id===id);if(!item){result.push({id,ok:false,reason:'User sudah tidak ada'});continue}
          if(item.root_admin){result.push({id,ok:false,reason:'Akun admin dilindungi'});continue}
          if(snap.servers.some(s=>s.user===id)){result.push({id,ok:false,reason:'User masih punya server'});continue}
          await deleteUser(session.url,session.ptla,id);
        }
        result.push({id,ok:true});await audit(session,`delete_${kind}`,String(id),'success');
      }catch(e){const reason=e instanceof Error?e.message:'Gagal menghapus';result.push({id,ok:false,reason});await audit(session,`delete_${kind}`,String(id),`failed: ${reason.slice(0,100)}`)}
    }
    return response(res,{results:result,deleted:result.filter(x=>x.ok).length,failed:result.filter(x=>!x.ok).length});
  }
  throw new ApiError(404,'Endpoint tidak ditemukan.');
})}
function response(base:NextResponse,data:unknown){const res=json(data);base.cookies.getAll().forEach(cookie=>res.cookies.set(cookie));return res;}
export async function GET(req:NextRequest,context:{params:Promise<{path?:string[]}>}){return route(req,'GET',context.params)}
export async function POST(req:NextRequest,context:{params:Promise<{path?:string[]}>}){return route(req,'POST',context.params)}
