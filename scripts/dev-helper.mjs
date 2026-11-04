import { startHelper } from '../lib/helper-process.js';
const stop = startHelper();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await stop(); process.exit(0); });
