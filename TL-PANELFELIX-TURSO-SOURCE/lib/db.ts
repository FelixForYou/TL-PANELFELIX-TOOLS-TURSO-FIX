import {createClient} from '@libsql/client/web';
import type {Client} from '@libsql/client';
let client:Client|undefined;
let ready:Promise<void>|undefined;
export function db():Client{
  if(!client){
    const url=process.env.TURSO_DATABASE_URL;
    const authToken=process.env.TURSO_AUTH_TOKEN;
    if(!url||!authToken) throw new Error('Turso belum dikonfigurasi di Vercel.');
    if(!/^libsql:\/\//.test(url)) throw new Error('TURSO_DATABASE_URL harus berawalan libsql://');
    client=createClient({url,authToken});
  }
  return client;
}
export async function ensureDb(){
  if(!ready)ready=(async()=>{
    const d=db();
    await d.execute(`CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      panel_url TEXT NOT NULL,
      encrypted_ptla TEXT NOT NULL,
      encrypted_ptlc TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    await d.execute('CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at)');
    await d.execute(`CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      session_hash TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    await d.execute('CREATE INDEX IF NOT EXISTS idx_activity_session_time ON activity(session_hash,created_at DESC)');
  })().catch(e=>{ready=undefined;throw e});
  return ready;
}
