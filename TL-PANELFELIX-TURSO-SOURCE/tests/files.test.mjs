import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const root=process.cwd();
const read=p=>readFileSync(join(root,p),'utf8');
test('sumber utama proyek tersedia',()=>{for(const path of ['app/page.tsx','app/layout.tsx','app/globals.css','app/api/[[...path]]/route.ts','lib/db.ts','lib/session.ts','lib/ptero.ts','.env.example'])assert.ok(existsSync(join(root,path)),path)});
test('env contoh hanya sembilan variabel dan tidak ada payment atau redis',()=>{const source=read('.env.example');const names=source.split('\n').filter(x=>/^[A-Z][A-Z_]+=/.test(x)).map(x=>x.split('=')[0]);assert.deepEqual(names,['APP_ORIGIN','SESSION_SECRET','SESSION_TTL_SECONDS','ENABLE_BULK_DELETE','PANEL_ALLOWED_HOSTS','TRUST_PROXY','ALLOW_INSECURE_DEV','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN']);assert.doesNotMatch(source,/REDIS|AUSTIN|BLOB/)});
test('operasi delete perlu konfirmasi dan admin dilindungi',()=>{const src=read('app/api/[[...path]]/route.ts');assert.match(src,/d.confirm!=='HAPUS'/);assert.match(src,/item.root_admin/);assert.match(src,/snap.servers.some\(s=>s.user===id\)/);assert.match(src,/state!=='offline'/)});
