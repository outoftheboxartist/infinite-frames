// Upload TWOFOLD frames to Supabase Storage (bucket ifm-assets) as a guest session.
import { createClient } from '/home/user/infinite-frames/web/node_modules/@supabase/supabase-js/dist/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
const DIR = path.dirname(new URL(import.meta.url).pathname);
const sb = createClient('https://xqfevafhjbdulhcqcmao.supabase.co', 'sb_publishable_olDMWJAdn9VYjJLK9E29eA_BOIANXmO', { auth: { persistSession: false } });
const { data, error } = await sb.auth.signInAnonymously();
if (error) { console.error('sign-in failed', error.message); process.exit(1); }
const uid = data.user.id;
const out = [];
for (let k = 1; k <= 20; k++) {
  const name = 'f' + String(k).padStart(2, '0') + '.webp';
  const p = `${uid}/twofold/${name}`;
  const { error: e } = await sb.storage.from('ifm-assets').upload(p, fs.readFileSync(path.join(DIR, 'out', name)), { contentType: 'image/webp', upsert: true });
  if (e) { console.error(name, e.message); process.exit(1); }
  out.push({ k, path: p, url: sb.storage.from('ifm-assets').getPublicUrl(p).data.publicUrl });
}
fs.writeFileSync(path.join(DIR, 'uploaded.json'), JSON.stringify({ uid, files: out }, null, 1));
console.log('uploaded', out.length, 'frames; first:', out[0].url);
