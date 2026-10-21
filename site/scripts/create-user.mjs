// Creates an admin user (or resets one's password) straight in D1, for the first login. The password is generated here,
// printed ONCE to this terminal and never written to a file; only its PBKDF2 hash goes to the database. Later users and
// password resets are done in the admin itself (משתמשים).
//
//   node scripts/create-user.mjs --local  --username yossi --name "יוסי" --role admin
//   node scripts/create-user.mjs --remote --username ofer  --name "עפר מרבך" --role editor
//   add --reset to give an existing user a new password
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const target = argv.includes('--remote') ? '--remote' : argv.includes('--local') ? '--local' : null;
const username = String(opt('username') || '').trim().toLowerCase();
const name = String(opt('name') || '').trim();
const role = opt('role') === 'editor' ? 'editor' : 'admin';
const reset = argv.includes('--reset');
if (!target || !/^[a-z0-9._-]{3,32}$/.test(username)) {
  console.error('usage: node scripts/create-user.mjs --local|--remote --username <name> [--name "שם"] [--role admin|editor] [--reset]');
  process.exit(1);
}
const ITER = 100_000; // the Workers maximum; the same as the admin uses (PBKDF2_ITERATIONS)

const A = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const buf = crypto.getRandomValues(new Uint32Array(16));
const password = [...buf].map((x) => A[x % A.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
const hex = (b) => Buffer.from(b).toString('hex');
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const sql = reset
  ? `UPDATE users SET pw_hash = ${q(hex(bits))}, pw_salt = ${q(hex(salt))}, pw_iter = ${ITER}, disabled = 0 WHERE username = ${q(username)}; DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ${q(username)}); DELETE FROM rate_limits WHERE key = ${q(`login-user:${username}`)}; SELECT changes() AS n;`
  : `INSERT INTO users (username, display_name, role, pw_hash, pw_salt, pw_iter, created_at) VALUES (${q(username)}, ${q(name)}, ${q(role)}, ${q(hex(bits))}, ${q(hex(salt))}, ${ITER}, ${Date.now()});`;
const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'marbach', target, '--json', '--command', sql], { cwd: ROOT, encoding: 'utf8' });
if (r.status !== 0) {
  const msg = `${r.stdout}${r.stderr}`;
  console.error(/UNIQUE/.test(msg) ? `The user "${username}" already exists. Add --reset to give it a new password.` : msg.slice(-2000));
  process.exit(1);
}
if (reset && !/"n":\s*[1-9]/.test(r.stdout)) { console.error(`No user "${username}".`); process.exit(1); }
console.log(`\n  ${reset ? 'New password for' : 'User created:'} ${username}${reset ? '' : ` (${role})`}\n  Password (shown once, not stored anywhere):  ${password}\n`);
