import { startHelper } from './lib/helper-process.js';
import { createBalanceProvider } from './lib/balance-host.js';

export const name = 'dsh-real-whale-pet';
export const inject = [];
export function apply(ctx, config = {}) {
  ctx.effect(() => {
    try { return startHelper(config, console, { balance: createBalanceProvider(ctx, console) }); }
    catch (error) { console.error('[鲸鱼桌宠] 启动失败：', error.message); }
  });
}
