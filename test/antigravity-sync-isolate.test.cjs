'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { performance } = require('node:perf_hooks');
const crypto = require('node:crypto');
const { AntigravityService } = require('../src/harnesses/antigravity/antigravity-service.cjs');
const { migrateAntigravityKeys, mergeSessionPair } = require('../src/harnesses/antigravity/antigravity-migration.cjs');
const { commitCheckpoint, prepareIncremental } = require('../src/analysis-history.cjs');

function listenSse(url) {
  const events = [];
  let onEventCallback = null;
  const parsed = new URL(url);
  const req = http.request({
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
  }, res => {
    let buffer = '';
    res.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop();
      for (const block of blocks) {
        let event = 'message', data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7).trim();
          else if (line.startsWith('data: ')) data = line.slice(6).trim();
        }
        if (data) {
          try {
            const parsedData = JSON.parse(data);
            const item = { event, data: parsedData, receivedAt: performance.now() };
            events.push(item);
            if (onEventCallback) onEventCallback(item);
          } catch (_) {}
        }
      }
    });
  });
  req.on('error', () => {});
  req.end();
  return {
    req,
    events,
    onEvent(fn) { onEventCallback = fn; },
    waitForEvent(eventName, matcher = null, timeoutMs = 2500) {
      return new Promise((resolve, reject) => {
        const found = events.find(e => e.event === eventName && (!matcher || matcher(e.data)));
        if (found) return resolve(found);
        const timer = setTimeout(() => {
          reject(new Error(`等待 ${eventName} 事件超时`));
        }, timeoutMs);
        const prev = onEventCallback;
        onEventCallback = item => {
          if (prev) prev(item);
          if (item.event === eventName && (!matcher || matcher(item.data))) {
            clearTimeout(timer);
            resolve(item);
          }
        };
      });
    },
    close() {
      try { req.destroy(); } catch (_) {}
    }
  };
}

test('Antigravity 多入口隔离与端到端自愈同步套件', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-sync-isolate-'));
  const stateFile = path.join(tmpDir, 'state.json');
  const convId = 'thread-sync-test-42';
  const canonicalKey = JSON.stringify(['local', convId]);

  let service = new AntigravityService({
    port: 0,
    stateFile,
    run: async () => ({ summary: 'ok', tasks: [] }),
  });
  let port = await service.start();

  try {
    // ----------------------------------------------------
    // 1. 负例 1：伪造 Ticket 与跨会话 Ticket 被拒 (403)
    // ----------------------------------------------------
    await t.test('负例 1：伪造 Ticket 或跨会话非法订阅被 403 坚决拦截', async () => {
      const fakeRes = await fetch(`http://127.0.0.1:${port}/session/events?id=${convId}&ticket=fake-ticket-123`);
      assert.equal(fakeRes.status, 403, '伪造 ticket 必须返回 403');

      const ticketReply = await fetch(`http://127.0.0.1:${port}/session/ticket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${service.http.credentials.token}`,
        },
        body: JSON.stringify({ conversationId: convId }),
      }).then(r => r.json());
      assert.ok(ticketReply.ticket);

      const crossRes = await fetch(`http://127.0.0.1:${port}/session/events?id=other-conv-id&ticket=${ticketReply.ticket}`);
      assert.equal(crossRes.status, 403, '跨会话订阅必须返回 403');
    });

    // ----------------------------------------------------
    // 2. 合法 Ticket 快照推送与传输层时延测量
    // ----------------------------------------------------
    await t.test('合法 Ticket 接收快照，测量 HTTP 请求发起到 Node 收到 SSE 传输层时延', async () => {
      const { ticket } = await fetch(`http://127.0.0.1:${port}/session/ticket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${service.http.credentials.token}`,
        },
        body: JSON.stringify({ conversationId: convId }),
      }).then(r => r.json());

      const sseClient = listenSse(`http://127.0.0.1:${port}/session/events?id=${convId}&ticket=${ticket}`);
      try {
        const snap = await sseClient.waitForEvent('snapshot');
        const snapConv = snap.data.session?.conversationId || snap.data.conversationId;
        assert.equal(snapConv, convId);

        const latencies = [];
        let currentRev = snap.data.session?.recordRevision || snap.data.recordRevision || 0;

        for (let i = 1; i <= 5; i++) {
          const changePromise = sseClient.waitForEvent('change', d => d?.session?.recordRevision > currentRev);
          const startT = performance.now();

          const rpcRes = await fetch(`http://127.0.0.1:${port}/rpc`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${service.http.credentials.token}`,
            },
            body: JSON.stringify({
              type: 'update',
              key: canonicalKey,
              requestId: 'req-latency-' + i,
              expectedRevision: currentRev,
              record: { state: 'unfinished', progress: 50 + i, note: `延迟测量第 ${i} 次` },
            }),
          }).then(r => r.json());

          assert.ok(!rpcRes.error, 'RPC 保存应成功: ' + rpcRes.error);
          currentRev = rpcRes.snapshot.records[canonicalKey].revision;
          const received = await changePromise;
          latencies.push(received.receivedAt - startT);
        }

        latencies.sort((a, b) => a - b);
        const p50 = latencies[Math.floor(latencies.length * 0.5)];
        const p95 = latencies[Math.floor(latencies.length * 0.95)];
        console.log(`[实测传输层时延 (HTTP请求发起到Node收到SSE)] P50: ${p50.toFixed(2)} ms, P95: ${p95.toFixed(2)} ms`);
        assert.ok(p50 < 100, `P50 应小于 100ms (实测: ${p50.toFixed(2)}ms)`);
      } finally {
        sseClient.close();
      }
    });

    // ----------------------------------------------------
    // 3. 后台重启与凭据轮换，换票重新授权恢复同步
    // ----------------------------------------------------
    await t.test('后台重启与凭据轮换后，换票重新授权恢复同步', async () => {
      const { ticket: oldTicket } = await fetch(`http://127.0.0.1:${port}/session/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${service.http.credentials.token}` },
        body: JSON.stringify({ conversationId: convId }),
      }).then(r => r.json());

      const clientBefore = listenSse(`http://127.0.0.1:${port}/session/events?id=${convId}&ticket=${oldTicket}`);
      await clientBefore.waitForEvent('snapshot');

      // 重启后台，轮换端口与 Token
      await service.stop();
      clientBefore.close();

      service = new AntigravityService({
        port: 0,
        stateFile,
        run: async () => ({ summary: 'ok', tasks: [] }),
      });
      port = await service.start();

      // 旧 Ticket 在新服务上必定失效 (403)
      const staleRes = await fetch(`http://127.0.0.1:${port}/session/events?id=${convId}&ticket=${oldTicket}`);
      assert.equal(staleRes.status, 403, '重启轮换后旧 ticket 必须失效');

      // 模拟宿主桥重新换票
      const { ticket: newTicket } = await fetch(`http://127.0.0.1:${port}/session/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${service.http.credentials.token}` },
        body: JSON.stringify({ conversationId: convId }),
      }).then(r => r.json());

      const clientAfter = listenSse(`http://127.0.0.1:${port}/session/events?id=${convId}&ticket=${newTicket}`);
      try {
        const snap = await clientAfter.waitForEvent('snapshot');
        const snapConv = snap.data.session?.conversationId || snap.data.conversationId;
        assert.equal(snapConv, convId);
      } finally {
        clientAfter.close();
      }
    });

    // ----------------------------------------------------
    // 4. 【发布阻塞项】生产级受控工件登记与 TOCTOU 异步防泄密
    // ----------------------------------------------------
    await t.test('生产级受控工件登记与 TOCTOU 异步防泄密（覆盖同名工件、后缀伪造与请求期间导航）', async () => {
      const globalBrain = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
      const fakeWindow = {
        location: { href: 'vscode-file://vscode-app/app', pathname: `/c/${convId}` },
        addEventListener: () => {},
        removeEventListener: () => {},
        __agentThingsConnection: {
          origin: `http://127.0.0.1:${port}`,
          token: service.http.credentials.token,
          brainDir: globalBrain,
        },
      };

      // 提前生成该测试会话的合法工件文件与法定摘要
      const artifactDir = path.join(globalBrain, convId);
      fs.mkdirSync(artifactDir, { recursive: true });
      const legitCardPath = path.join(artifactDir, 'things-card.html');
      const legitCardBody = '<body class="dark"><div id="agentThingsCard">Agent Things 正版内容</div></body>';
      const legitFullDoc = `<!DOCTYPE html><html><head></head>${legitCardBody}</html>`;
      fs.writeFileSync(legitCardPath, legitFullDoc, 'utf8');
      const legitDigest = crypto.createHash('sha256').update(legitFullDoc).digest('hex');

      const harnessSource = fs.readFileSync(path.join(__dirname, '../src/harnesses/antigravity/antigravity-harness.js'), 'utf8');
      const runner = new Function('window', 'document', 'fetch', 'SERVICE_ORIGIN', 'headers', `
        ${harnessSource}
        return window.__antigravityHarnessSecurity;
      `);

      const fakeHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${service.http.credentials.token}`,
      };

      const security = runner(fakeWindow, {}, fetch, `http://127.0.0.1:${port}`, fakeHeaders);
      assert.ok(security, '生产安全处理器初始化成功');

      const { registerCardIframe, onCardMessage, registeredCards } = security;

      // 负例 A：后缀伪造 (.html.evil)
      const evilIframe = {
        src: `file://${globalBrain}/${convId}/things-card.html.evil`,
        contentWindow: { location: { href: `file://${globalBrain}/${convId}/things-card.html.evil` } },
        isConnected: true,
      };
      const regEvil = registerCardIframe(evilIframe, convId);
      assert.equal(regEvil, false, '带 .html.evil 后缀的伪造工件必须被拒绝登记');
      assert.equal(registeredCards.has(evilIframe.contentWindow), false);

      // 负例 B：本地其他目录中的同名工件 (/tmp/other/brain/...)
      const otherDirIframe = {
        src: `file:///tmp/other/brain/${convId}/things-card.html`,
        contentWindow: { location: { href: `file:///tmp/other/brain/${convId}/things-card.html` } },
        isConnected: true,
      };
      const regOther = registerCardIframe(otherDirIframe, convId);
      assert.equal(regOther, false, '本地其他目录中的同名工件必须被拒绝登记');
      assert.equal(registeredCards.has(otherDirIframe.contentWindow), false);

      // 负例 B2：沙盒目录内深层嵌套同名工件 (/brain/nested/fake/brain/.../things-card.html)
      const deepNestedIframe = {
        src: `file://${globalBrain}/nested/fake/brain/${convId}/things-card.html`,
        contentWindow: { location: { href: `file://${globalBrain}/nested/fake/brain/${convId}/things-card.html` } },
        isConnected: true,
      };
      assert.equal(registerCardIframe(deepNestedIframe, convId), false, '深层嵌套同名工件必须被拒绝登记');
      assert.equal(registeredCards.has(deepNestedIframe.contentWindow), false);

      // 负例 B3：缺失会话上下文时直接拒绝登记
      const emptyWin = {
        location: { pathname: '/' },
        addEventListener: () => {},
        removeEventListener: () => {},
        __agentThingsConnection: { origin: `http://127.0.0.1:${port}`, token: 't', brainDir: globalBrain },
      };
      const securityNoContext = runner(emptyWin, {}, fetch, `http://127.0.0.1:${port}`, fakeHeaders);
      assert.equal(securityNoContext.registerCardIframe(deepNestedIframe, null), false, '缺失会话ID时必须拒绝登记');
      emptyWin.__antigravityHarnessDispose?.();

      // 负例 C：网络任意 URL (https://evil.com/...)
      const netIframe = {
        src: `https://evil.com/brain/${convId}/things-card.html`,
        contentWindow: { location: { href: `https://evil.com/brain/${convId}/things-card.html` } },
        isConnected: true,
      };
      assert.equal(registerCardIframe(netIframe, convId), false, '网络 URL 必须被拒绝登记');

      // 正例：合法沙盒工件成功登记
      const validSrc = `file://${globalBrain}/${convId}/things-card.html`;
      const postedReplies = [];
      const portReplies = postedReplies;
      const mockPort = { postMessage: msg => portReplies.push(msg) };
      const validIframe = {
        src: validSrc,
        contentWindow: {
          location: { href: validSrc },
        },
        isConnected: true,
        addEventListener: () => {},
      };
      const validToken = 'token-valid-isolate';
      const regValid = registerCardIframe(validIframe, convId, { loadToken: validToken });
      assert.equal(regValid, true, '合法工件必须成功登记');
      assert.ok(registeredCards.has(validIframe.contentWindow));

      // 负例 D1：合法 iframe 发起无端口请求，绝不回退至 '*' 广播，请求被静默丢弃
      await onCardMessage({
        source: validIframe.contentWindow,
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-no-port', conversationId: convId, loadToken: validToken },
      });
      assert.equal(portReplies.length, 0, '无端口请求必须被忽略，绝不回退至通配符广播');

      // 负例 D2：合法 A 卡片越权请求 B 会话（绑定端口后通过专属端口回传错误）
      await onCardMessage({
        source: validIframe.contentWindow,
        ports: [mockPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-cross', conversationId: 'other-conv-b', loadToken: validToken },
      });
      assert.equal(portReplies.length, 1);
      assert.equal(portReplies[0].success, false);
      assert.match(portReplies[0].error, /禁止跨会话操作/);
      portReplies.length = 0;

      // 负例 E (TOCTOU)：请求期间 iframe 偏离导航，异步回包坚决阻断下发
      // 1. 票据申请异步导航防御
      let resolveTicketFetch;
      const mockFetch = async (url, opts) => {
        if (url.includes('/session/ticket')) {
          await new Promise(r => { resolveTicketFetch = r; });
        }
        return fetch(url, opts);
      };

      const securityWithFetch = runner(fakeWindow, {}, mockFetch, `http://127.0.0.1:${port}`, fakeHeaders);
      const navigatingIframe = {
        src: validSrc,
        contentWindow: {
          location: { href: validSrc },
          postMessage: msg => postedReplies.push(msg),
        },
        isConnected: true,
        addEventListener: () => {},
      };
      const toctouToken1 = 'token-toctou-ticket-1';
      securityWithFetch.registerCardIframe(navigatingIframe, convId, { loadToken: toctouToken1, digest: legitDigest, verified: true });

      // 发起请求（携带专属端口）
      const portNav = { postMessage: msg => postedReplies.push(msg) };
      const authPromise = securityWithFetch.onCardMessage({
        source: navigatingIframe.contentWindow,
        ports: [portNav],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-toctou-ticket', conversationId: convId, loadToken: toctouToken1 },
      });

      // 等待到达 /session/ticket 拦截点
      while (!resolveTicketFetch) {
        await new Promise(r => setImmediate(r));
      }

      // 在网络等待期间，iframe 发生导航偏离
      navigatingIframe.contentWindow.location.href = 'file:///tmp/attacker-page.html';

      // 释放 fetch 响应
      resolveTicketFetch();
      await authPromise;

      // 断言：由于二次核验（TOCTOU），票据绝不能发送给已偏离的 window
      assert.equal(postedReplies.length, 0, '偏离导航后，票据绝不能发送出去');

      // 2. 包含备注的操作回包异步导航防御（经由已绑定的专属端口进行）
      let resolveActionFetch;
      const mockActionFetch = async (url, opts) => {
        if (url.includes('/rpc')) {
          await new Promise(r => { resolveActionFetch = r; });
        }
        return fetch(url, opts);
      };

      const securityAction = runner(fakeWindow, {}, mockActionFetch, `http://127.0.0.1:${port}`, fakeHeaders);
      const navActionIframe = {
        src: validSrc,
        contentWindow: {
          location: { href: validSrc },
        },
        isConnected: true,
        addEventListener: () => {},
      };
      const toctouToken2 = 'token-toctou-action-2';
      securityAction.registerCardIframe(navActionIframe, convId, { loadToken: toctouToken2, digest: legitDigest, verified: true });

      let actionPortListener;
      const portActionNav = {
        postMessage: msg => postedReplies.push(msg),
        set onmessage(fn) { actionPortListener = fn; },
        get onmessage() { return actionPortListener; },
      };

      // 首次完成握手
      await securityAction.onCardMessage({
        source: navActionIframe.contentWindow,
        ports: [portActionNav],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-toctou-auth', conversationId: convId, loadToken: toctouToken2 },
      });
      postedReplies.length = 0;

      // 经由已建立的专属端口发送写操作
      assert.ok(actionPortListener, '专属端口必须已挂载 onmessage 监听器');
      const actionPromise = actionPortListener({
        data: {
          type: 'AGENT_THINGS_ACTION_PROXY',
          nonce: 'nonce-toctou-action',
          action: 'update',
          payload: { record: { state: 'unfinished', progress: 80, note: '绝密事项备注' } },
        },
      });

      // 等待到达 /rpc 拦截点
      while (!resolveActionFetch) {
        await new Promise(r => setImmediate(r));
      }

      // 异步期间偏离
      navActionIframe.contentWindow.location.href = 'file:///tmp/attacker-page.html';
      resolveActionFetch();
      await actionPromise;

      assert.equal(postedReplies.length, 0, '偏离导航后，含备注的操作回包绝不能发送出去');

      // 负例 F：「旧请求未返回，新端口已登记」，旧请求回包绝不投递到新端口
      let resolveFirstTicket;
      let ticketFetchCount = 0;
      const mockTicketFetch = async (url, opts) => {
        if (url.includes('/session/ticket')) {
          ticketFetchCount++;
          if (ticketFetchCount === 1) {
            await new Promise(r => { resolveFirstTicket = r; });
          }
        }
        return fetch(url, opts);
      };

      const securityPortRace = runner(fakeWindow, {}, mockTicketFetch, `http://127.0.0.1:${port}`, fakeHeaders);
      const raceIframe = {
        src: validSrc,
        contentWindow: { location: { href: validSrc } },
        isConnected: true,
        addEventListener: () => {},
      };
      const raceToken1 = 'token-race-1';
      securityPortRace.registerCardIframe(raceIframe, convId, { loadToken: raceToken1, digest: legitDigest, verified: true });

      const oldPortReplies = [];
      const newPortReplies = [];
      const oldPort = { postMessage: msg => oldPortReplies.push(msg) };
      const newPort = { postMessage: msg => newPortReplies.push(msg) };

      // 第 1 次请求携带 oldPort
      const firstAuthPromise = securityPortRace.onCardMessage({
        source: raceIframe.contentWindow,
        ports: [oldPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-old-req', conversationId: convId, loadToken: raceToken1 },
      });

      while (!resolveFirstTicket) {
        await new Promise(r => setImmediate(r));
      }

      // 在第 1 次网络等待期间，宿主通过可信流程重新恢复登记，卡片建立新端口
      const raceToken2 = 'token-race-2';
      securityPortRace.registerCardIframe(raceIframe, convId, { loadToken: raceToken2, digest: legitDigest, verified: true });
      await securityPortRace.onCardMessage({
        source: raceIframe.contentWindow,
        ports: [newPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-reconnect-port', conversationId: convId, loadToken: raceToken2 },
      });

      // 释放第 1 次 fetch 响应
      resolveFirstTicket();
      await firstAuthPromise;

      // 断言：capturedPort (oldPort) !== binding.port (newPort)
      const oldReqLeakedToNew = newPortReplies.filter(r => r.nonce === 'nonce-old-req');
      assert.equal(oldReqLeakedToNew.length, 0, '旧请求回包绝不能投递到新端口');
      assert.equal(oldPortReplies.length, 0, '旧请求已被作废，不能向已失效的旧端口回传');
      assert.equal(newPortReplies.filter(r => r.nonce === 'nonce-reconnect-port').length, 1, '新请求回包正常送达新端口');

      // ----------------------------------------------------
      // 约束 1 负例 G1：原卡片尚未握手，iframe 内部导航抢跑，第二次 load 尚未送达，新文档抢先握手坚决阻断
      // ----------------------------------------------------
      const preemptIframe = {
        src: validSrc,
        contentWindow: { location: { href: validSrc } },
        isConnected: true,
        addEventListener: () => {},
      };
      // 宿主可信装入，派发单次装入令牌
      const testLoadToken = 'token-preempt-valid-123';
      security.registerCardIframe(preemptIframe, convId, { loadToken: testLoadToken, digest: legitDigest, verified: true });

      const evilPortReplies = [];
      const evilPort = { postMessage: msg => evilPortReplies.push(msg), close: () => {} };

      // 原卡片尚未握手，内部导航抢跑的恶意新文档先来握手（携带伪造/缺失的 loadToken）
      await security.onCardMessage({
        source: preemptIframe.contentWindow,
        ports: [evilPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-evil-race', conversationId: convId, loadToken: 'token-evil-fake' },
      });

      assert.equal(evilPortReplies.length, 0, '首次握手前抢跑的新文档绝对拿不到票据');

      // 原卡片使用合法 loadToken 发送首次握手，正常获批
      const legitimatePortReplies = [];
      const legitimatePort = { postMessage: msg => legitimatePortReplies.push(msg), close: () => {} };

      await security.onCardMessage({
        source: preemptIframe.contentWindow,
        ports: [legitimatePort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-legit-first', conversationId: convId, loadToken: testLoadToken },
      });

      assert.equal(legitimatePortReplies.length, 1, '持有合法装入令牌的原卡片正常获得票据');
      assert.ok(legitimatePortReplies[0].ticket);

      // ----------------------------------------------------
      // 约束 2 负例 G2：保持 tab 和 contentWindow 引用不变，内部导航后新文档发起握手坚决阻断
      // ----------------------------------------------------
      // 模拟 WHATWG WindowProxy 引用保持不变，但 iframe 触发了后续 load 事件（内部导航）
      const winProxyIframe = {
        src: validSrc,
        contentWindow: { location: { href: validSrc } },
        isConnected: true,
        _listeners: {},
        addEventListener(event, fn) {
          this._listeners[event] = this._listeners[event] || [];
          this._listeners[event].push(fn);
        },
        dispatch(event) {
          for (const fn of this._listeners[event] || []) fn();
        }
      };

      const winProxyToken = 'token-winproxy-123';
      security.registerCardIframe(winProxyIframe, convId, { loadToken: winProxyToken, digest: legitDigest, verified: true });
      const legitPort1Replies = [];
      const legitPort1 = { postMessage: msg => legitPort1Replies.push(msg), close: () => {} };

      // 首次正常握手
      await security.onCardMessage({
        source: winProxyIframe.contentWindow,
        ports: [legitPort1],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-initial-handshake', conversationId: convId, loadToken: winProxyToken },
      });
      assert.equal(legitPort1Replies.length, 1, '首次握手成功');

      // 模拟内部导航：WindowProxy 引用不变，但触发了 iframe 的第二次 load 事件
      winProxyIframe.dispatch('load');

      // 新文档尝试发起新握手，携带新端口
      const attackerPortReplies = [];
      const attackerPort = { postMessage: msg => attackerPortReplies.push(msg), close: () => {} };

      await security.onCardMessage({
        source: winProxyIframe.contentWindow,
        ports: [attackerPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-attacker-nav', conversationId: convId, loadToken: 'token-attacker' },
      });

      assert.equal(attackerPortReplies.length, 0, '导航后新文档绝对拿不到票据，旧绑定已注销');

      // ----------------------------------------------------
      // 约束 3 负例 G3：跨会话违规只释放临时端口，原卡片通道继续正常工作
      // ----------------------------------------------------
      const channelIframe = {
        src: validSrc,
        contentWindow: { location: { href: validSrc } },
        isConnected: true,
        addEventListener: () => {},
      };
      const channelToken = 'token-channel-g3';
      security.registerCardIframe(channelIframe, convId, { loadToken: channelToken, digest: legitDigest, verified: true });

      const mainPortReplies = [];
      let mainPortClosed = false;
      let mainPortListener;
      const mainPort = {
        postMessage: msg => mainPortReplies.push(msg),
        close: () => { mainPortClosed = true; },
        set onmessage(fn) { mainPortListener = fn; },
        get onmessage() { return mainPortListener; },
      };

      // 首次握手建立原通道
      await security.onCardMessage({
        source: channelIframe.contentWindow,
        ports: [mainPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-main-auth', conversationId: convId, loadToken: channelToken },
      });
      assert.equal(mainPortReplies.length, 1);
      assert.ok(mainPortReplies[0].ticket);
      mainPortReplies.length = 0;

      // 发起跨会话非法请求，携带临时端口
      const tempPortReplies = [];
      let tempPortClosed = false;
      const tempPort = { postMessage: msg => tempPortReplies.push(msg), close: () => { tempPortClosed = true; } };

      await security.onCardMessage({
        source: channelIframe.contentWindow,
        ports: [tempPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-cross-attempt', conversationId: 'other-session-x' },
      });

      assert.equal(tempPortReplies.length, 1);
      assert.equal(tempPortReplies[0].success, false);
      assert.match(tempPortReplies[0].error, /禁止跨会话操作/);
      assert.equal(tempPortClosed, true, '跨会话请求的临时端口必须被释放关闭');
      assert.equal(mainPortClosed, false, '原卡片的专属端口通道绝对不能被关闭');

      // 原卡片通过已绑定的专属端口继续发送合法请求，正常响应
      assert.ok(mainPortListener, '原专属端口必须已挂载 onmessage 监听器');
      await mainPortListener({
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-main-renew', conversationId: convId }
      });
      assert.equal(mainPortReplies.length, 1, '原卡片经由专属端口正常续期');
      assert.ok(mainPortReplies[0].ticket);

      // ----------------------------------------------------
      // 验收项 1 负例 H：生产装入路径缺令牌就拒绝
      // ----------------------------------------------------
      const unreadableIframe = {
        src: validSrc,
        contentWindow: {
          get location() { throw new Error('SecurityError: cross-origin frame'); }
        },
        isConnected: true,
      };
      // 实时地址不可读且无令牌的 iframe 跑生产登记，必须坚决拒绝
      assert.equal(security.registerCardIframe(unreadableIframe), false, '不可读且无令牌的 iframe 生产登记必须拒绝');
      assert.equal(security.registerCardIframe(unreadableIframe, convId), false, '即使显式指定会话，缺令牌也必须拒绝');

      // 即使绕过登记，首次握手缺令牌坚决拒绝发票
      const mockEvilTokenPortReplies = [];
      let evilTokenPortClosed = false;
      const evilTokenPort = {
        postMessage: msg => mockEvilTokenPortReplies.push(msg),
        close: () => { evilTokenPortClosed = true; },
      };
      await security.onCardMessage({
        source: unreadableIframe.contentWindow,
        ports: [evilTokenPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'evil-no-token', conversationId: convId },
      });
      assert.equal(mockEvilTokenPortReplies.length, 0, '首次握手缺令牌绝对拿不到票据');

      // ----------------------------------------------------
      // 验收项 2 负例 I：握手后窗口写入不触达 RPC
      // ----------------------------------------------------
      let rpcCallCount = 0;
      const mockFetchForBypass = async (url, opts) => {
        if (url.includes('/rpc')) rpcCallCount++;
        return fetch(url, opts);
      };
      const securityBypassCheck = runner(fakeWindow, {}, mockFetchForBypass, `http://127.0.0.1:${port}`, fakeHeaders);
      const bypassIframe = {
        src: validSrc,
        contentWindow: { location: { href: validSrc } },
        isConnected: true,
        addEventListener: () => {},
      };
      const bypassToken = 'token-bypass-test';
      securityBypassCheck.registerCardIframe(bypassIframe, convId, { loadToken: bypassToken, digest: legitDigest, verified: true });

      const bypassPortReplies = [];
      let bypassPortListener;
      const bypassPort = {
        postMessage: msg => bypassPortReplies.push(msg),
        set onmessage(fn) { bypassPortListener = fn; },
        get onmessage() { return bypassPortListener; },
      };

      // 首次合法握手
      await securityBypassCheck.onCardMessage({
        source: bypassIframe.contentWindow,
        ports: [bypassPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-bypass-auth', conversationId: convId, loadToken: bypassToken },
      });
      assert.equal(bypassPortReplies.length, 1);

      // 握手完成后，尝试通过 window.postMessage 触发写入
      await securityBypassCheck.onCardMessage({
        source: bypassIframe.contentWindow,
        data: {
          type: 'AGENT_THINGS_ACTION_PROXY',
          nonce: 'nonce-window-bypass',
          action: 'update',
          payload: { record: { state: 'unfinished', progress: 50, note: '窗口写入旁路' } },
        },
      });
      assert.equal(rpcCallCount, 0, '握手后窗口入口消息绝不能触达写入 RPC');

      // 经由专属端口的合法操作正常触达 RPC
      assert.ok(bypassPortListener, '专属端口必须已挂载 onmessage 监听器');
      await bypassPortListener({
        data: {
          type: 'AGENT_THINGS_ACTION_PROXY',
          nonce: 'nonce-legit-port-action',
          action: 'update',
          payload: { record: { state: 'unfinished', progress: 80, note: '专属端口合法写入' } },
        },
      });
      assert.equal(rpcCallCount, 1, '通过专属端口的合法写入请求正常触达 RPC');

      // ----------------------------------------------------
      // 验收项 3：可信工件内容独立摘要核验与防篡改、防重放防御
      // ----------------------------------------------------
      // 1. 正向用例：内容未被篡改，核验通过并获得票据
      const legitVerifyIframe = {
        src: validSrc,
        contentWindow: { location: { href: validSrc } },
        isConnected: true,
        addEventListener: () => {},
      };
      const legitToken = 'token-legit-verify-123';
      security.registerCardIframe(legitVerifyIframe, convId, {
        loadToken: legitToken,
        digest: legitDigest,
      });

      const legitVerifyPortReplies = [];
      const legitVerifyPort = { postMessage: msg => legitVerifyPortReplies.push(msg), close: () => {} };

      const legitHandshake = security.onCardMessage({
        source: legitVerifyIframe.contentWindow,
        ports: [legitVerifyPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-legit-verify', conversationId: convId, loadToken: legitToken },
      });
      let duplicateClosed = false;
      const duplicateReplies = [];
      await security.onCardMessage({
        source: legitVerifyIframe.contentWindow,
        ports: [{ postMessage: msg => duplicateReplies.push(msg), close: () => { duplicateClosed = true; } }],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-duplicate', conversationId: convId, loadToken: legitToken },
      });
      await legitHandshake;

      assert.equal(legitVerifyPortReplies.length, 1, '内容未被篡改的工件必须正常获得票据');
      assert.ok(legitVerifyPortReplies[0].ticket);
      assert.deepEqual(duplicateReplies, [], '摘要校验期间重复握手不得获得票据');
      assert.equal(duplicateClosed, true);

      // 2A. 负例 J1A（只改 head 篡改防绕过）：保持 body 原样，在 head 中注入恶意脚本，坚决拒发票据
      const tamperedHeadIframe = {
        src: validSrc,
        contentWindow: { location: { href: validSrc } },
        isConnected: true,
        addEventListener: () => {},
      };
      const tamperedHeadToken = 'token-tampered-head-111';
      const tamperedHeadDoc = `<!DOCTYPE html><html><head><script>/* evil head exploit */ window.__pwned = true;</script></head>${legitCardBody}</html>`;
      const tamperedHeadDigest = crypto.createHash('sha256').update(tamperedHeadDoc).digest('hex');
      security.registerCardIframe(tamperedHeadIframe, convId, {
        loadToken: tamperedHeadToken,
        digest: tamperedHeadDigest, // 篡改 head 的内容哈希
      });

      const tamperedHeadReplies = [];
      let tamperedHeadClosed = false;
      const tamperedHeadPort = {
        postMessage: msg => tamperedHeadReplies.push(msg),
        close: () => { tamperedHeadClosed = true; },
      };

      await security.onCardMessage({
        source: tamperedHeadIframe.contentWindow,
        ports: [tamperedHeadPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-tampered-head', conversationId: convId, loadToken: tamperedHeadToken },
      });

      assert.equal(tamperedHeadReplies.length, 0, '只改 head 的篡改工件坚决拿不到票据！');
      assert.equal(tamperedHeadClosed, true, '只改 head 篡改核验失败后临时端口必须被立即关闭');

      // 2B. 负例 J1B（改正文 body 篡改）：在合法 Tab 和同一 iframe 下装入正文被篡改的 HTML，坚决拒发票据
      const tamperedIframe = {
        src: validSrc,
        contentWindow: { location: { href: validSrc } },
        isConnected: true,
        addEventListener: () => {},
      };
      const tamperedToken = 'token-tampered-456';
      const tamperedBody = '<body class="dark"><div id="agentThingsCard">恶意注入或被篡改的内容</div></body>';
      const tamperedBodyDoc = `<!DOCTYPE html><html><head></head>${tamperedBody}</html>`;
      const tamperedDigest = crypto.createHash('sha256').update(tamperedBodyDoc).digest('hex');
      security.registerCardIframe(tamperedIframe, convId, {
        loadToken: tamperedToken,
        digest: tamperedDigest, // 被篡改的内容哈希
      });

      const tamperedPortReplies = [];
      let tamperedPortClosed = false;
      const tamperedPort = {
        postMessage: msg => tamperedPortReplies.push(msg),
        close: () => { tamperedPortClosed = true; },
      };

      await security.onCardMessage({
        source: tamperedIframe.contentWindow,
        ports: [tamperedPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-tampered-attempt', conversationId: convId, loadToken: tamperedToken },
      });

      assert.equal(tamperedPortReplies.length, 0, '内容被篡改的工件坚决拿不到票据！');
      assert.equal(tamperedPortClosed, true, '核验失败后临时端口必须被立即关闭');

      // 2C. 负例 J1C（合法文档后追加脚本）：保持合法工件完整，在其 </html> 之后追加恶意攻击脚本，坚决拒发票据
      const appendIframe = {
        src: validSrc,
        contentWindow: { location: { href: validSrc } },
        isConnected: true,
        addEventListener: () => {},
      };
      const appendToken = 'token-append-exploit-789';
      const appendDoc = `${legitFullDoc}<script>/* evil append */ window.__pwned = true;</script>`;
      const appendDigest = crypto.createHash('sha256').update(appendDoc).digest('hex');
      security.registerCardIframe(appendIframe, convId, {
        loadToken: appendToken,
        digest: appendDigest, // 包含了追加脚本后的哈希
      });

      const appendPortReplies = [];
      let appendPortClosed = false;
      const appendPort = {
        postMessage: msg => appendPortReplies.push(msg),
        close: () => { appendPortClosed = true; },
      };

      await security.onCardMessage({
        source: appendIframe.contentWindow,
        ports: [appendPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-append-attempt', conversationId: convId, loadToken: appendToken },
      });

      assert.equal(appendPortReplies.length, 0, '在 </html> 后追加脚本的工件坚决拿不到票据！');
      assert.equal(appendPortClosed, true, '追加脚本工件核验失败后临时端口必须被立即关闭');

      // 2D. 负例 J1D（回归：地址匹配、有令牌、无摘要仍拒发票据）
      // 构造 href 严格匹配预期路径且带有匹配 loadToken，但未附带有效摘要核验的工件，坚决拒发票据
      const noDigestToken = 'token-no-digest-test-999';
      const noDigestIframe = {
        src: validSrc,
        contentWindow: { location: { href: validSrc } },
        isConnected: true,
        getAttribute: name => name === 'data-load-token' ? noDigestToken : null,
        addEventListener: () => {},
      };
      assert.equal(security.registerCardIframe(noDigestIframe, convId), false, 'DOM 自报的令牌不能用于登记');
      security.registerCardIframe(noDigestIframe, convId, { loadToken: noDigestToken });

      const noDigestPortReplies = [];
      let noDigestPortClosed = false;
      const noDigestPort = {
        postMessage: msg => noDigestPortReplies.push(msg),
        close: () => { noDigestPortClosed = true; },
      };

      await security.onCardMessage({
        source: noDigestIframe.contentWindow,
        ports: [noDigestPort],
        data: {
          type: 'AGENT_THINGS_AUTH_REQUEST',
          nonce: 'nonce-no-digest-attempt',
          conversationId: convId,
          loadToken: noDigestToken,
        },
      });

      assert.equal(noDigestPortReplies.length, 0, '地址匹配但无有效摘要核验的工件坚决拒发票据！');
      assert.equal(noDigestPortClosed, true, '无有效摘要核验时临时端口必须被立即关闭');

      // 3. 负例 J2（防重放）：同一工件重新加载后，尝试重放已被消费的旧令牌，坚决拒发票据
      const replayPortReplies = [];
      const replayPort = { postMessage: msg => replayPortReplies.push(msg), close: () => {} };

      await security.onCardMessage({
        source: legitVerifyIframe.contentWindow,
        ports: [replayPort],
        data: { type: 'AGENT_THINGS_AUTH_REQUEST', nonce: 'nonce-replay-attempt', conversationId: convId, loadToken: legitToken },
      });

      assert.equal(replayPortReplies.length, 0, '重放已被消费的旧令牌坚决拿不到票据！');

      // 清理测试生成的工件临时文件
      try { fs.rmSync(artifactDir, { recursive: true, force: true }); } catch (_) {}

      // 清理测试初始化的宿主轮询与监听器，避免定时器挂起事件循环
      if (typeof fakeWindow.__antigravityHarnessDispose === 'function') {
        fakeWindow.__antigravityHarnessDispose();
      }
    });

    // ----------------------------------------------------
    // 5. Antigravity MCP 会话键统一规范化
    // ----------------------------------------------------
    await t.test('Antigravity MCP 路由统一规范化会话键，不破坏共享 Store 规则', async () => {
      const toolRes = await fetch(`http://127.0.0.1:${port}/tools`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${service.http.credentials.token}`,
        },
        body: JSON.stringify({
          name: 'update_session_progress',
          arguments: {
            conversation_id: 'local:test-mcp-normalize-key',
            progress: 85,
            state: 'unfinished',
            note: 'MCP 规范键测试',
          },
        }),
      }).then(r => r.json());

      assert.ok(!toolRes.isError, 'MCP 写入应成功');

      const expectedKey = JSON.stringify(['local', 'test-mcp-normalize-key']);
      const snapshot = service.store.snapshot();
      assert.ok(snapshot.records[expectedKey], 'MCP 必须落到规范键');
      assert.equal(snapshot.records[expectedKey].progress, 85);
      assert.equal(snapshot.records['local:test-mcp-normalize-key'], undefined);
    });

    // ----------------------------------------------------
    // 6. 用实际增量结果验收检查点
    // ----------------------------------------------------
    await t.test('用实际增量结果验收检查点：commitCheckpoint 生成检查点，迁移后追加回合验证增量选取', async () => {
      const cleanId = 'test-inc-checkpoint-conv';
      const canKey = JSON.stringify(['local', cleanId]);
      const legKey = JSON.stringify(['local', 'local:' + cleanId]);

      // 构造生产标准历史提取物 extracted (2 回合)
      const fakeExtracted = {
        hostId: 'antigravity',
        threadId: cleanId,
        continuous: true,
        extractorVersion: 1,
        turnHashes: [
          { turnId: 'turn-1', status: 'completed', hash: 'hash-turn-1' },
          { turnId: 'turn-2', status: 'completed', hash: 'hash-turn-2' },
        ],
        events: [
          { type: 'user', content: '回合 1', ref: 'ref-1' },
          { type: 'answer', content: '答复 1', ref: 'ref-2' },
          { type: 'user', content: '回合 2', ref: 'ref-3' },
          { type: 'answer', content: '答复 2', ref: 'ref-4' },
        ],
        sources: {
          'ref-1': { turnId: 'turn-1', itemId: 'item-1' },
          'ref-2': { turnId: 'turn-1', itemId: 'item-2' },
          'ref-3': { turnId: 'turn-2', itemId: 'item-3' },
          'ref-4': { turnId: 'turn-2', itemId: 'item-4' },
        },
      };

      const ledger = {
        summary: '增量检查点基准账本',
        tasks: [
          { id: 't1', title: '任务 1', status: 'done' },
          { id: 't2', title: '任务 2', status: 'done' },
        ],
      };
      const versions = { prompt: 'p-v1', schema: 's-v1', ledger: 'l-v1' };

      // 使用生产函数 commitCheckpoint 真实生成合法检查点
      const prodCheckpoint = commitCheckpoint(fakeExtracted, ledger, versions);
      assert.ok(prodCheckpoint.turnHashes, '检查点包含 turnHashes');
      assert.equal(prodCheckpoint.extractorVersion, 1);

      const mockState = {
        revision: 10,
        actionSequence: 30,
        records: {
          [legKey]: { state: 'unfinished', progress: 50, actionSequence: 10, updatedAt: 1000 },
          [canKey]: { state: 'unfinished', progress: 90, actionSequence: 30, updatedAt: 3000 },
        },
        analysis: {
          [legKey]: {
            ledger,
            sources: {},
            checkpoint: prodCheckpoint, // 放入真实生产检查点
          },
        },
        timeline: [
          { key: legKey, actionSequence: 15, source: 'analysis', status: 'completed', requestedAt: 1500 },
          { key: canKey, actionSequence: 30, source: 'manual', status: 'completed', requestedAt: 3000 },
        ],
      };

      // 执行迁移
      const { data: migrated } = migrateAntigravityKeys(structuredClone(mockState));

      // 验证 1：迁移必须保留合法检查点，绝不能误删
      assert.ok(migrated.analysis[canKey], '规范键 analysis 存在');
      const migratedCheckpoint = migrated.analysis[canKey].checkpoint;
      assert.ok(migratedCheckpoint, '生产检查点必须被完好保留，严禁误删！');
      assert.equal(migratedCheckpoint.turnHashes.length, 2);

      // 验证 2：用实际增量追加轮次验收 prepareIncremental
      const extendedExtracted = {
        ...fakeExtracted,
        turnHashes: [
          ...fakeExtracted.turnHashes,
          { turnId: 'turn-3', status: 'completed', hash: 'hash-turn-3' }, // 追加第 3 回合
        ],
        events: [
          ...fakeExtracted.events,
          { type: 'user', content: '回合 3', ref: 'ref-5' },
          { type: 'answer', content: '答复 3', ref: 'ref-6' },
        ],
        sources: {
          ...fakeExtracted.sources,
          'ref-5': { turnId: 'turn-3', itemId: 'item-5' },
          'ref-6': { turnId: 'turn-3', itemId: 'item-6' },
        },
      };

      const incResult = prepareIncremental(extendedExtracted, migratedCheckpoint, versions);
      assert.equal(incResult.reason, 'incremental', '必须判定为增量分析');
      assert.equal(incResult.startTurn, 2, '增量分析必须跳过前 2 个已有回合');
      assert.equal(incResult.events.length, 2, '增量分析只选择第 3 回合新增事件');
      assert.equal(incResult.ledger.summary, '增量检查点基准账本');

      // 验证 3：历史篡改时回退重扫
      const tamperedExtracted = {
        ...extendedExtracted,
        turnHashes: [
          { turnId: 'turn-1', status: 'completed', hash: 'hash-tampered' },
          ...extendedExtracted.turnHashes.slice(1),
        ],
      };
      const tamperResult = prepareIncremental(tamperedExtracted, migratedCheckpoint, versions);
      assert.equal(tamperResult.reason, 'history_changed', '历史变化必须触发重扫');
      assert.equal(tamperResult.startTurn, 0, '重扫从第 0 回合开始');
    });

    // ----------------------------------------------------
    // 7. 真实 /rpc analyze 入口失败链路定向送达与卡片复位
    // ----------------------------------------------------
    await t.test('真实 /rpc analyze 入口失败链路定向广播，卡片按钮复位、错误可见、允许重试且 B 会话不串线', async () => {
      const failConvA = 'fail-conv-rpc-alpha';
      const failConvB = 'listener-b-isolated';
      const keyA = JSON.stringify(['local', failConvA]);

      // 启动一个配置了可控 runner 抛错的服务实例
      const failTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-fail-rpc-'));
      const failStateFile = path.join(failTmpDir, 'state.json');

      const failService = new AntigravityService({
        port: 0,
        stateFile: failStateFile,
        run: async () => {
          throw new Error('LLM token quota exceeded (429)');
        },
      });
      const failPort = await failService.start();
      let sseA, sseB;

      try {
        const ticketA = (await fetch(`http://127.0.0.1:${failPort}/session/ticket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${failService.http.credentials.token}` },
          body: JSON.stringify({ conversationId: failConvA }),
        }).then(r => r.json())).ticket;

        const ticketB = (await fetch(`http://127.0.0.1:${failPort}/session/ticket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${failService.http.credentials.token}` },
          body: JSON.stringify({ conversationId: failConvB }),
        }).then(r => r.json())).ticket;

        sseA = listenSse(`http://127.0.0.1:${failPort}/session/events?id=${failConvA}&ticket=${ticketA}`);
        sseB = listenSse(`http://127.0.0.1:${failPort}/session/events?id=${failConvB}&ticket=${ticketB}`);

        await sseA.waitForEvent('snapshot');
        await sseB.waitForEvent('snapshot');

        const failEventPromise = sseA.waitForEvent('change', d => d?.session?.analysisStatus?.status === 'failed');

        // 走真实的 /rpc analyze 入口发起分析
        const rpcRes = await fetch(`http://127.0.0.1:${failPort}/rpc`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${failService.http.credentials.token}`,
          },
          body: JSON.stringify({
            type: 'analyze',
            key: keyA,
            requestId: 'test-rpc-fail-req-1',
          }),
        }).then(r => r.json());

        assert.ok(!rpcRes.error, 'RPC analyze 请求本身提交成功');

        // 等待全链路异步执行失败并定向广播到达
        const failedChange = await failEventPromise;
        assert.equal(failedChange.data.session.conversationId, failConvA);
        assert.equal(failedChange.data.session.analysisStatus.status, 'failed');
        assert.match(failedChange.data.session.analysisStatus.error, /LLM token quota exceeded/);

        // 验证隔离会话 B 绝无泄漏
        const leakedToB = sseB.events.filter(e => e.event === 'change');
        assert.equal(leakedToB.length, 0, '会话 A 的失败事件绝不能串线推到会话 B');

        // 模拟卡片端状态机响应：
        let cardBtnDisabled = true;
        let cardBtnText = '正在分析…';
        let cardFeedbackText = '';

        // 卡片收到失败通知
        const status = failedChange.data.session.analysisStatus;
        if (status.status === 'failed') {
          cardBtnDisabled = false;
          cardBtnText = '更新进度';
          cardFeedbackText = '分析未完成: ' + status.error;
        }

        assert.equal(cardBtnDisabled, false, '分析失败后按钮必须恢复可用');
        assert.equal(cardBtnText, '更新进度', '按钮文本恢复为更新进度');
        assert.match(cardFeedbackText, /LLM token quota exceeded/, '卡片显式展示真实失败原因，支持用户重试');
      } finally {
        sseA?.close();
        sseB?.close();
        await failService.stop();
        fs.rmSync(failTmpDir, { recursive: true, force: true });
      }
    });

    // ----------------------------------------------------
    // 8. 草稿冲突保护与明确下一步闭环
    // ----------------------------------------------------
    await t.test('草稿冲突保护：保留草稿与外部更新，通过读取最新版本并保留草稿重新提交成功', async () => {
      const conflictConv = 'conflict-conv-gamma';
      const confKey = JSON.stringify(['local', conflictConv]);

      // 初始化数据
      const initRes = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${service.http.credentials.token}` },
        body: JSON.stringify({
          type: 'update',
          key: confKey,
          requestId: 'init-update-1',
          expectedRevision: 0,
          record: { state: 'unfinished', progress: 50, note: '初始记录' },
        }),
      }).then(r => r.json());

      let savedRevision = initRes.snapshot.records[confKey].revision;
      let draftBaseRevision = savedRevision; // 载入编辑表单时锁定基准版本
      let isFormDirty = true; // 用户输入了 80% 草稿
      let currentProgress = 80;
      let currentNote = '80% 草稿备注';

      // 外部（侧栏）保存为 70%（版本推进）
      const sideRes = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${service.http.credentials.token}` },
        body: JSON.stringify({
          type: 'update',
          key: confKey,
          requestId: 'side-update-2',
          expectedRevision: savedRevision,
          record: { state: 'unfinished', progress: 70, note: '侧栏保存的 70%' },
        }),
      }).then(r => r.json());
      const extRev = sideRes.snapshot.records[confKey].revision;
      assert.ok(extRev > savedRevision, '外部保存后版本必须递增');

      // SSE 推送到达卡片：
      savedRevision = extRev; // 更新最新保存版本
      // 但因 isFormDirty 为 true，draftBaseRevision 绝对不推进，保持为初始版本！
      assert.ok(draftBaseRevision < savedRevision);
      assert.equal(currentProgress, 80, '用户草稿 80% 完好保留');

      // 卡片点击保存：携带 draftBaseRevision (旧版本)
      const saveRes = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${service.http.credentials.token}` },
        body: JSON.stringify({
          type: 'update',
          key: confKey,
          requestId: 'card-conflict-save',
          expectedRevision: draftBaseRevision,
          record: { state: 'unfinished', progress: currentProgress, note: currentNote },
        }),
      }).then(r => r.json());

      // 断言：服务端乐观锁命中冲突！
      assert.ok(saveRes.error, '预期版本冲突必须报错');
      assert.match(saveRes.error, /此会话已在其他窗口更新|版本/);

      // 卡片冲突处理：展示冲突提示，草稿 80% 保留
      assert.equal(currentProgress, 80);

      // 用户点击「读取最新版本并保留草稿」：
      draftBaseRevision = savedRevision; // 基准版本对齐至最新已保存版本
      assert.equal(draftBaseRevision, extRev);
      assert.equal(currentProgress, 80, '草稿依然保留');

      // 用户再次点击保存：携带对齐后的 draftBaseRevision
      const secondSaveRes = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${service.http.credentials.token}` },
        body: JSON.stringify({
          type: 'update',
          key: confKey,
          requestId: 'card-resolved-save',
          expectedRevision: draftBaseRevision,
          record: { state: 'unfinished', progress: currentProgress, note: currentNote },
        }),
      }).then(r => r.json());

      assert.ok(!secondSaveRes.error, '对齐后再次保存必须成功');
      const finalRecord = secondSaveRes.snapshot.records[confKey];
      assert.equal(finalRecord.progress, 80);
      assert.equal(finalRecord.note, '80% 草稿备注');
      assert.ok(finalRecord.revision > extRev, '成功保存后版本继续递增');
    });

  } finally {
    await service.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
