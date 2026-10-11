export function getConfig(){
  const origin=process.env.APP_ORIGIN || '';
  const secret=process.env.SESSION_SECRET || '';
  const ttl=Number(process.env.SESSION_TTL_SECONDS || '3600');
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('ENV Turso belum lengkap: TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN diperlukan.');
  if (secret.length<32) throw new Error('SESSION_SECRET harus minimal 32 karakter acak.');
  if(!Number.isInteger(ttl)||ttl<300||ttl>604800)throw new Error('SESSION_TTL_SECONDS harus di antara 300 sampai 604800 detik.');
  return {origin,secret,ttl,bulk:process.env.ENABLE_BULK_DELETE==='true',allowedHosts:(process.env.PANEL_ALLOWED_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),trustProxy:process.env.TRUST_PROXY==='true',insecureDev:process.env.ALLOW_INSECURE_DEV==='true'};
}
export class ApiError extends Error {constructor(public status:number, message:string){super(message);}}
