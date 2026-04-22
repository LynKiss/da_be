/**
 * Start a localtunnel and update BACKEND_URL in .env automatically.
 * Usage: node scripts/tunnel.mjs
 */
import localtunnel from 'localtunnel';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '..', '.env');
const PORT = 8000;

function updateEnv(url) {
  let env = readFileSync(ENV_PATH, 'utf-8');
  if (/^BACKEND_URL=.*/m.test(env)) {
    env = env.replace(/^BACKEND_URL=.*/m, `BACKEND_URL=${url}`);
  } else {
    env += `\nBACKEND_URL=${url}\n`;
  }
  writeFileSync(ENV_PATH, env, 'utf-8');
}

async function main() {
  console.log(`\n🚇 Khởi động tunnel cho port ${PORT}...\n`);

  const tunnel = await localtunnel({ port: PORT });

  const url = tunnel.url;
  console.log(`✅ Tunnel URL: \x1b[36m${url}\x1b[0m`);
  console.log(`📝 Đã cập nhật BACKEND_URL trong .env`);
  console.log(`\n📌 MoMo IPN endpoint: \x1b[33m${url}/api/v1/payments/momo/ipn\x1b[0m`);
  console.log('\n⚠️  Giữ cửa sổ này mở trong khi test. Nhấn Ctrl+C để dừng.\n');
  console.log(`💡 Lần đầu MoMo gọi về có thể cần bypass trang xác nhận của localtunnel.`);
  console.log(`   Truy cập ${url} trên browser → nhấn "Click to Continue" một lần.\n`);

  updateEnv(url);

  tunnel.on('close', () => {
    console.log('\n🛑 Tunnel đã đóng.');
    process.exit(0);
  });

  tunnel.on('error', (err) => {
    console.error('Tunnel error:', err.message);
  });

  process.on('SIGINT', () => {
    console.log('\n🛑 Đóng tunnel...');
    tunnel.close();
  });
}

main().catch((err) => {
  console.error('Không khởi động được tunnel:', err.message);
  process.exit(1);
});
