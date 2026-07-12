// Reproduit /api/cron/sync-gsc-properties en local
// (le endpoint Vercel renvoie 303 - middleware bug)
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID = process.env.SEO_MONITOR_USER_ID;
const KEY_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

if (!SB_URL || !SB_KEY || !USER_ID || !KEY_B64) {
  console.error('Missing env vars');
  console.error({ SB_URL: !!SB_URL, SB_KEY: !!SB_KEY, USER_ID: !!USER_ID, KEY_B64: !!KEY_B64 });
  process.exit(1);
}

const sa = JSON.parse(Buffer.from(KEY_B64, 'base64').toString('utf-8'));
console.log(`Service account: ${sa.client_email}`);

// 1. Get GSC access token via JWT
const now = Math.floor(Date.now() / 1000);
const header = { alg: 'RS256', typ: 'JWT' };
const payload = {
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/webmasters.readonly',
  aud: 'https://oauth2.googleapis.com/token',
  exp: now + 3600,
  iat: now,
};
const b64u = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unsigned = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
const signer = crypto.createSign('RSA-SHA256');
signer.update(unsigned);
const signature = signer.sign(sa.private_key, 'base64url');
const jwt = `${unsigned}.${signature}`;

const tokRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  }),
});
if (!tokRes.ok) {
  console.error('Token exchange failed:', tokRes.status, await tokRes.text());
  process.exit(1);
}
const { access_token } = await tokRes.json();
console.log('✓ Got access token');

// 2. List GSC properties
const sitesRes = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
  headers: { Authorization: `Bearer ${access_token}` },
});
const sitesData = await sitesRes.json();
const gscSites = sitesData.siteEntry || [];
console.log(`\n=== GSC properties accessibles (${gscSites.length}) ===`);
for (const s of gscSites) {
  console.log(`  ${s.permissionLevel.padEnd(20)} ${s.siteUrl}`);
}

if (gscSites.length === 0) {
  console.log('Aucune propriete - service account pas ajoute / pas propage.');
  process.exit(0);
}

// 3. Upsert into gsc_properties
const sb = createClient(SB_URL, SB_KEY);
const toUpsert = gscSites.map(s => ({
  user_id: USER_ID,
  site_url: s.siteUrl,
  permission_level: s.permissionLevel,
  is_active: true,
}));
const { error: upErr } = await sb.from('gsc_properties').upsert(toUpsert, { onConflict: 'user_id,site_url' });
if (upErr) { console.error('Upsert error:', upErr); process.exit(1); }
console.log(`\n✓ Upserted ${toUpsert.length} properties`);

// 4. Re-fetch and link to sites by domain
const { data: properties } = await sb.from('gsc_properties').select('id, site_url, site_id').eq('user_id', USER_ID);
const { data: userSites } = await sb.from('sites').select('id, domain').eq('user_id', USER_ID);

const sitesByDomain = new Map(userSites.map(s => [s.domain, s.id]));
let linked = 0, created = 0;
const linkedDomains = [];

for (const prop of properties) {
  if (prop.site_id) continue;
  let propDomain = prop.site_url;
  if (propDomain.startsWith('sc-domain:')) {
    propDomain = propDomain.replace('sc-domain:', '');
  } else {
    try { propDomain = new URL(propDomain).hostname; } catch { continue; }
  }
  const clean = propDomain.replace(/^www\./, '');
  let matchId = sitesByDomain.get(clean) || sitesByDomain.get(`www.${clean}`);
  if (matchId) {
    await sb.from('gsc_properties').update({ site_id: matchId, is_active: true }).eq('id', prop.id);
    linked++;
    linkedDomains.push(clean);
  } else {
    const { data: newSite } = await sb.from('sites').insert({
      user_id: USER_ID, domain: clean, niche: 'nutra', site_type: 'nutra', is_active: true,
    }).select('id').single();
    if (newSite) {
      await sb.from('gsc_properties').update({ site_id: newSite.id, is_active: true }).eq('id', prop.id);
      linked++;
      created++;
      linkedDomains.push(clean);
    }
  }
}

console.log(`\n=== RESULT ===`);
console.log(`  synced:  ${gscSites.length} properties`);
console.log(`  linked:  ${linked} to existing sites`);
console.log(`  created: ${created} new sites`);
console.log(`  domains:`);
linkedDomains.forEach(d => console.log(`    - ${d}`));
