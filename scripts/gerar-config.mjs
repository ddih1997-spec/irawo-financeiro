// Gera config.enc.json: endereço + chave do script cifrados com a "senha da casa" (AES-GCM + PBKDF2).
// Uso:  URL=... TOKEN=... SENHA=... node scripts/gerar-config.mjs
import { pbkdf2Sync, randomBytes, createCipheriv } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const { URL: u, TOKEN: t, SENHA: senha } = process.env;
if (!u || !t || !senha) { console.error('Informe URL, TOKEN e SENHA.'); process.exit(1); }
if (senha.length < 8) { console.error('Use uma senha com pelo menos 8 caracteres.'); process.exit(1); }
const iter = 300000, salt = randomBytes(16), iv = randomBytes(12);
const key = pbkdf2Sync(senha, salt, iter, 32, 'sha256');
const c = createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([c.update(JSON.stringify({ u, t }), 'utf8'), c.final(), c.getAuthTag()]); // WebCrypto espera o tag no fim
writeFileSync(new URL('../config.enc.json', import.meta.url), JSON.stringify({ v: 1, iter, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') }));
console.log('config.enc.json gerado.');
