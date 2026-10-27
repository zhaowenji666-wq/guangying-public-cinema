// 验证 Workers 版播放链接令牌：自包含 URL + HMAC 签名，防篡改、可过期。
// 与 workers/worker.js 中的 register/resolve 保持一致。
const { webcrypto: crypto } = require('node:crypto');
const assert = require('node:assert');

const enc = new TextEncoder();
const b64url = s => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();

async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg))))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

const SECRET = 'test-secret';
async function register(url, ttl = 6 * 3600 * 1000) {
  if (!/^https?:\/\//i.test(url)) return '';
  const payload = b64url(JSON.stringify({ u: url, e: Date.now() + ttl }));
  return '/online/media/' + payload + '.' + (await hmac(SECRET, payload)).slice(0, 24);
}
async function resolve(token) {
  const dot = String(token).lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  if ((await hmac(SECRET, payload)).slice(0, 24) !== sig) return null;
  let data;
  try { data = JSON.parse(unb64url(payload)); } catch { return null; }
  if (!data.e || data.e < Date.now()) return null;
  return /^https?:\/\//i.test(data.u) ? data.u : null;
}

(async () => {
  const url = 'https://cdn.example.com/2023/movie/index.m3u8';
  const token = await register(url);

  // 能还原出原始地址
  assert.equal(await resolve(token.split('/').pop()), url);
  // 被改过一个字符就必须失效
  assert.equal(await resolve(token.split('/').pop().slice(0, -1) + 'x'), null);
  // 过期令牌失效
  const expired = b64url(JSON.stringify({ u: 'https://cdn.example.com/a.ts', e: Date.now() - 1000 }));
  assert.equal(await resolve(expired + '.' + (await hmac(SECRET, expired)).slice(0, 24)), null);
  // 非 http(s) 地址不签发
  assert.equal(await register('file:///etc/passwd'), '');

  console.log('worker token signing verified');
})().catch(e => { console.error(e); process.exitCode = 1; });
