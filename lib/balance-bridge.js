// Host ↔ Helper 的余额桥接：DSH 服务只能在 Host 进程里访问，
// 所以由 Host 起一个只监听 127.0.0.1 的一次性 HTTP 口，把余额查询转发给 Helper。
// 只接受带随机 token 且来自回环地址的 POST /balance，子进程通过环境变量拿到地址与 token。
import http from 'node:http';
import { randomBytes } from 'node:crypto';

export function createBalanceBridge(provider, log = console) {
  const token = randomBytes(24).toString('hex');
  const server = http.createServer(async (request, response) => {
    const reply = (status, payload) => {
      try { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(payload)); }
      catch { /* 客户端已断开 */ }
    };
    try {
      if (request.method !== 'POST' || request.url !== '/balance') return reply(404, { ok: false, error: 'not found' });
      if (String(request.headers.authorization || '') !== `Bearer ${token}`) return reply(403, { ok: false, error: 'forbidden' });
      const remote = String(request.socket.remoteAddress || '');
      if (!/^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/.test(remote)) return reply(403, { ok: false, error: 'forbidden' });
      request.resume();
      try {
        const data = await provider();
        return reply(200, { ok: true, data });
      } catch (error) {
        return reply(200, { ok: false, error: String((error && error.message) || error).slice(0, 500) });
      }
    } catch (error) {
      log.warn?.('[鲸鱼桌宠] 余额桥接处理失败：', String((error && error.message) || error));
      return reply(500, { ok: false, error: 'balance bridge failed' });
    }
  });
  const ready = new Promise(resolve => {
    server.once('error', error => {
      log.warn?.('[鲸鱼桌宠] 余额桥接监听失败：', String((error && error.message) || error));
      resolve(null);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return resolve(null);
      resolve({ url: `http://127.0.0.1:${address.port}/balance`, token });
    });
  });
  return {
    ready,
    close() { try { server.close(); } catch { /* 已关闭 */ } }
  };
}
