import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {ApiError,getConfig} from './config';
import {db,ensureDb} from './db';

const COOKIE='tl_panel_session';
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
function key(){return createHash('sha256').update(getConfig().secret,'utf8').digest();}
function encrypt(raw:string){const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',key(),iv);const enc=Buffer.concat([c.update(raw,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),enc]).toString('base64url')}
function decrypt(raw:string){const b=Buffer.from(raw,'base64url');if(b.length<29)throw new ApiError(401,'Data sesi tidak valid.');const d=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8')}
export type Session={idHash:string,url:string,ptla:string,ptlc:string|null};
export async function startSession(res:NextResponse,url:string,ptla:string){
  const cfg=getConfig();await ensureDb();await db().execute({sql:'DELETE FROM sessions WHERE expires_at<?',args:[Date.now()]});const token=randomBytes(32).toString('base64url'),hash=sha(token),now=Date.now();
  await db().execute({sql:'INSERT INTO sessions(id_hash,panel_url,encrypted_ptla,encrypted_ptlc,created_at,expires_at) VALUES(?,?,?,?,?,?)',args:[hash,url,encrypt(ptla),null,now,now+cfg.ttl*1000]});
  cookie(res,token,cfg.ttl);return hash;
}
function cookie(res:NextResponse,token:string,ttl:number){res.cookies.set(COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:ttl})}
export async function currentSession(req:NextRequest,res?:NextResponse):Promise<Session>{
  const value=req.cookies.get(COOKIE)?.value;
  if(!value||value.length>150)throw new ApiError(401,'Sesi berakhir. Hubungkan panel kembali.');
  await ensureDb();const idHash=sha(value);
  const r=await db().execute({sql:'SELECT panel_url,encrypted_ptla,encrypted_ptlc,expires_at FROM sessions WHERE id_hash=?',args:[idHash]});
  const row=r.rows[0];if(!row || Number(row.expires_at)<=Date.now())throw new ApiError(401,'Sesi berakhir. Hubungkan panel kembali.');
  const cfg=getConfig();if(res){const expiry=Date.now()+cfg.ttl*1000;await db().execute({sql:'UPDATE sessions SET expires_at=? WHERE id_hash=?',args:[expiry,idHash]});cookie(res,value,cfg.ttl)}
  try{return {idHash,url:String(row.panel_url),ptla:decrypt(String(row.encrypted_ptla)),ptlc:row.encrypted_ptlc?decrypt(String(row.encrypted_ptlc)):null}}catch{throw new ApiError(401,'Sesi tidak valid. Silakan hubungkan kembali.');}
}
export async function savePtlc(session:Session,ptlc:string|null){await db().execute({sql:'UPDATE sessions SET encrypted_ptlc=? WHERE id_hash=?',args:[ptlc?encrypt(ptlc):null,session.idHash]})}
export async function closeSession(session:Session){await db().execute({sql:'DELETE FROM sessions WHERE id_hash=?',args:[session.idHash]})}
export function clearSession(res:NextResponse){res.cookies.set(COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:0})}
export async function audit(session:Session,action:string,target:string,result:string){try{await db().execute({sql:'INSERT INTO activity(id,session_hash,action,target,result,created_at) VALUES(?,?,?,?,?,?)',args:[randomUUID(),session.idHash,action,target,result,Date.now()]})}catch(e){console.error('Gagal mencatat aktivitas:',e)}}
export async function history(session:Session){const r=await db().execute({sql:'SELECT action,target,result,created_at FROM activity WHERE session_hash=? ORDER BY created_at DESC LIMIT 100',args:[session.idHash]});return r.rows.map(v=>({...v}))}
