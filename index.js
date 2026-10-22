import express from 'express';
import { bot, isAdmin, safe } from './src/core.js';
import { migrate } from './src/migrate.js';
import { RENDER_HOST, WEBHOOK_SECRET, PORT } from './src/config.js';

// ترتيب التسجيل مهم: النصوص أخيراً
import './src/handlers/files.js';
import './src/handlers/admin.js';
import './src/handlers/upload.js';
import { syncCommands } from './src/handlers/panel.js';
import './src/handlers/text.js';
import { loadAdmins } from './src/core.js';

bot.catch(async (err, ctx) => {
  console.error('Bot error:', err);
  if (ctx && isAdmin(ctx)) await safe(ctx.reply('❌ خطأ: ' + (err.message || err)));
});

await migrate();
await loadAdmins();
await syncCommands();

if (RENDER_HOST) {
  const app = express();
  app.get('/', (_, res) => res.send('OK'));
  app.use(await bot.createWebhook({ domain: RENDER_HOST, path: '/tg', secret_token: WEBHOOK_SECRET }));
  app.listen(PORT, () => console.log('Webhook server on', PORT));
} else {
  bot.launch();
  console.log('Polling mode (local)');
}
process.once('SIGTERM', () => bot.stop('SIGTERM'));
