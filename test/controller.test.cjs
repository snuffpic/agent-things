'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { StartupController } = require('../src/startup/controller.cjs');

const NOW = 1_000_000;
const app = (overrides = {}) => ({
  key: 'new', pid: 42, launchedAt: NOW - 2000, finishedLaunching: true, windows: 1, argumentsKnown: true, debugPort: null, ...overrides
});
const snapshot = (apps, overrides = {}) => ({ apps, frontmostPid: 42, inputIdleMs: 5000, inputStamp: 7, ...overrides });

// `script` feeds successive snapshots; the last one repeats.
function harness(script, options = {}, adapterOverrides = {}) {
  const calls = [];
  const events = [];
  const queue = [...script];
  const clock = { now: NOW };
  const adapter = {
    snapshot: async () => (queue.length > 1 ? queue.shift() : queue[0]),
    portInUse: async () => false,
    quit: async () => { calls.push('quit'); return { accepted: true }; },
    launch: async () => { calls.push('launch'); return { launched: true, key: 'debug', pid: 43 }; },
    show: async () => { calls.push('show'); return { shown: true }; },
    record: async event => { events.push(event); },
    ...adapterOverrides
  };
  const controller = new StartupController(adapter, {
    now: () => clock.now,
    sleep: async ms => { clock.now += ms; },
    windowSettleMs: 0,
    ...options
  });
  return { adapter, calls, clock, controller, events };
}

async function baselined(script, options, adapterOverrides) {
  const context = harness([snapshot([]), ...script], options, adapterOverrides);
  await context.controller.tick();
  await context.controller.tick();
  return context;
}

const eligible = [snapshot([app()]), snapshot([]), snapshot([]), snapshot([app({ key: 'debug', pid: 43, debugPort: 39222 })], { frontmostPid: 1 })];

test('an eligible launch is swapped once and shown', async () => {
  const { calls, events } = await baselined([
    snapshot([app()]),
    snapshot([], { frontmostPid: 1 }),
    snapshot([], { frontmostPid: 1 }),
    snapshot([app({ key: 'debug', pid: 43, debugPort: 39222 })], { frontmostPid: 1 })
  ]);
  assert.deepEqual(calls, ['quit', 'launch', 'show']);
  assert.deepEqual(events, ['watching', 'attempt', 'quit-accepted', 'reopening', 'reopened']);
});

test('apps already running at startup are never touched', async () => {
  const context = harness([snapshot([app()])]);
  await context.controller.tick();
  await context.controller.tick();
  assert.deepEqual(context.calls, []);
  assert.deepEqual(context.events, ['watching']);
});

test('observe mode never quits anything', async () => {
  const { calls, events } = await baselined(eligible, { allowClientRestart: false });
  assert.deepEqual(calls, []);
  assert.ok(events.every(event => event === 'observing'));
});

test('a process that already has a debug port is left alone', async () => {
  const { calls } = await baselined([snapshot([app({ debugPort: 39222 })])]);
  assert.deepEqual(calls, []);
});

test('unknown process arguments are left alone', async () => {
  const { calls } = await baselined([snapshot([app({ argumentsKnown: false })])]);
  assert.deepEqual(calls, []);
});

test('multiple instances are left alone', async () => {
  const { calls } = await baselined([snapshot([app(), app({ key: 'other', pid: 50 })])]);
  assert.deepEqual(calls, []);
});

test('a launch older than eight seconds is skipped', async () => {
  const { calls, events } = await baselined([snapshot([app({ launchedAt: NOW - 8001 })])]);
  assert.deepEqual(calls, []);
  assert.equal(events.at(-1), 'skipped-active-or-background');
});

test('user input since launch skips the handoff', async () => {
  const { calls, events } = await baselined([snapshot([app()], { inputIdleMs: 500 })]);
  assert.deepEqual(calls, []);
  assert.equal(events.at(-1), 'skipped-active-or-background');
});

test('a launch still in progress is retried, not rejected', async () => {
  const { calls, controller } = await baselined([snapshot([app({ finishedLaunching: false })])]);
  assert.deepEqual(calls, []);
  assert.equal(controller.pendingLaunch, true);
  assert.equal(controller.seen.has('new'), false);
});

test('a background launch waits for the app to come forward', async () => {
  const { calls, controller } = await baselined([snapshot([app()], { frontmostPid: 1 })]);
  assert.deepEqual(calls, []);
  assert.equal(controller.pendingLaunch, true);
});

test('a rejected process is not revisited', async () => {
  const { calls, controller } = await baselined([snapshot([app()], { inputIdleMs: 500 })]);
  await controller.tick();
  assert.deepEqual(calls, []);
});

test('the cooldown blocks a second attempt', async () => {
  const { calls, events } = await baselined([snapshot([app()])], { lastAttemptAt: NOW - 1000 });
  assert.deepEqual(calls, []);
  assert.equal(events.at(-1), 'skipped-cooldown');
});

test('a busy port blocks the handoff', async () => {
  const { calls, events } = await baselined([snapshot([app()])], {}, { portInUse: async () => true });
  assert.deepEqual(calls, []);
  assert.equal(events.at(-1), 'port-in-use');
});

test('the receipt is written before the quit request', async () => {
  const order = [];
  await baselined(eligible, {}, {
    record: async event => { order.push(event); },
    quit: async () => { order.push('quit'); return { accepted: false }; }
  });
  assert.ok(order.indexOf('attempt') < order.indexOf('quit'));
});

test('a failed receipt means no quit', async () => {
  const { calls, events } = await baselined([snapshot([app()])], {}, {
    record: async event => {
      if (event === 'attempt') throw new Error('disk full');
    }
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(events, []);
});

test('a refused quit stops there', async () => {
  const { calls, events } = await baselined([snapshot([app()])], {}, {
    quit: async () => ({ accepted: false })
  });
  assert.deepEqual(calls, []);
  assert.equal(events.at(-1), 'quit-refused');
});

test('a quit that passes the initial deadline stays pending without launching', async () => {
  const { calls, events } = await baselined([snapshot([app()]), snapshot([app({ windows: 0 })])]);
  assert.deepEqual(calls, ['quit']);
  assert.equal(events.at(-1), 'quit-timeout');
});

test('another instance appearing during the wait cancels the handoff', async () => {
  const { calls, events } = await baselined([snapshot([app()]), snapshot([app(), app({ key: 'other', pid: 50 })])]);
  assert.deepEqual(calls, ['quit']);
  assert.equal(events.at(-1), 'another-instance-started');
});

test('an app reopened by the user before our launch cancels it', async () => {
  const { calls, events } = await baselined([snapshot([app()]), snapshot([]), snapshot([app({ key: 'mine', pid: 60 })])]);
  assert.deepEqual(calls, ['quit']);
  assert.equal(events.at(-1), 'reopen-canceled');
});

test('automatic startup process replacement completes the original handoff without a cooldown retry', async () => {
  const replacement = app({ key: 'replacement', pid: 50, launchedAt: NOW - 100 });
  const quitting = [];
  const { calls, events } = await baselined([
    snapshot([app()]),
    snapshot([app(), replacement], { frontmostPid: 50 }),
    snapshot([replacement], { frontmostPid: 50 }),
    snapshot([], { frontmostPid: 1 }),
    snapshot([], { frontmostPid: 1 }),
    snapshot([app({ key: 'debug', pid: 43, debugPort: 39222 })], { frontmostPid: 1 })
  ], {}, { quit: async candidate => { quitting.push(candidate.key); return { accepted: true }; } });
  assert.deepEqual(quitting, ['new', 'replacement']);
  assert.deepEqual(calls, ['launch', 'show']);
  assert.deepEqual(events, ['watching', 'attempt', 'quit-accepted', 'following-startup-replacement', 'quit-accepted', 'reopening', 'reopened']);
});

test('a replacement caused by new user input is not terminated', async () => {
  const quitting = [];
  const { calls, events } = await baselined([
    snapshot([app()]),
    snapshot([app({ key: 'user-reopened', pid: 50 })], { frontmostPid: 50, inputStamp: 8 })
  ], {}, { quit: async candidate => { quitting.push(candidate.key); return { accepted: true }; } });
  assert.deepEqual(quitting, ['new']);
  assert.deepEqual(calls, []);
  assert.equal(events.at(-1), 'another-instance-started');
});

test('startup replacement following is bounded to one process', async () => {
  const quitting = [];
  const { calls, events } = await baselined([
    snapshot([app()]),
    snapshot([app({ key: 'first-replacement', pid: 50 })], { frontmostPid: 50 }),
    snapshot([app({ key: 'second-replacement', pid: 51 })], { frontmostPid: 51 })
  ], {}, { quit: async candidate => { quitting.push(candidate.key); return { accepted: true }; } });
  assert.deepEqual(quitting, ['new', 'first-replacement']);
  assert.deepEqual(calls, []);
  assert.equal(events.at(-1), 'another-instance-started');
});

test('input during the handoff still reopens but does not steal focus', async () => {
  const { calls, events } = await baselined([
    snapshot([app()]),
    snapshot([], { inputStamp: 8 }),
    snapshot([], { inputStamp: 8 }),
    snapshot([app({ key: 'debug', pid: 43, debugPort: 39222 })], { inputStamp: 8 })
  ]);
  assert.deepEqual(calls, ['quit', 'launch']);
  assert.equal(events.at(-1), 'reopened');
});

test('the reopened process is not handed off again', async () => {
  const context = await baselined([
    snapshot([app()]),
    snapshot([], { frontmostPid: 1 }),
    snapshot([], { frontmostPid: 1 }),
    snapshot([app({ key: 'debug', pid: 43 })], { frontmostPid: 1 })
  ]);
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch', 'show']);
});

test('errors are recorded and do not stop later ticks', async () => {
  let broken = true;
  const events = [];
  const controller = new StartupController({
    snapshot: async () => {
      if (broken) throw new Error('bridge failed');
      return snapshot([]);
    },
    record: async event => { events.push(event); }
  });
  await controller.tick();
  broken = false;
  await controller.tick();
  assert.deepEqual(events, ['error', 'watching']);
});

test('two successful ordinary launches within two minutes both receive a handoff', async () => {
  const receipts = [];
  const context = harness([
    snapshot([]),
    snapshot([app()]), snapshot([], { frontmostPid: 1 }), snapshot([], { frontmostPid: 1 }),
    snapshot([app({ key: 'debug', pid: 43, debugPort: 39222 })], { frontmostPid: 1 }),
    snapshot([]),
    snapshot([app({ key: 'second', pid: 44 })], { frontmostPid: 44 }),
    snapshot([], { frontmostPid: 1 }), snapshot([], { frontmostPid: 1 }),
    snapshot([app({ key: 'debug-second', pid: 45, debugPort: 39222 })], { frontmostPid: 1 })
  ], {}, {
    launch: async () => {
      context.calls.push('launch');
      return context.calls.filter(call => call === 'launch').length === 1
        ? { launched: true, key: 'debug', pid: 43 }
        : { launched: true, key: 'debug-second', pid: 45 };
    },
    record: async (event, details) => receipts.push({ event, ...details })
  });
  await context.controller.tick();
  await context.controller.tick();
  await context.controller.tick();
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch', 'show', 'quit', 'launch', 'show']);
  assert.ok(context.clock.now - NOW < 120000);
  assert.equal(context.controller.lastAttemptAt, 0);
  assert.equal(receipts.filter(item => item.event === 'reopened' && item.lastAttemptAt === 0).length, 2);
});

test('a failed launch retains cooldown across a newly started process', async () => {
  const context = await baselined([
    snapshot([app()]), snapshot([]), snapshot([]),
    snapshot([app({ key: 'second', pid: 44 })], { frontmostPid: 44 })
  ], {}, { launch: async () => ({ launched: false }) });
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit']);
  assert.ok(context.events.includes('launch-failed'));
  assert.equal(context.events.at(-1), 'skipped-cooldown');
  assert.ok(context.controller.lastAttemptAt > 0);
});

test('an accepted quit can finish after the old ten-second deadline', async () => {
  const context = harness([snapshot([])]);
  let phase = 0;
  context.adapter.snapshot = async () => {
    if (phase++ === 0) return snapshot([]);
    if (context.clock.now - NOW < 17000) return snapshot([app({ windows: phase > 2 ? 0 : 1 })]);
    return snapshot([], { frontmostPid: 1 });
  };
  await context.controller.tick();
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch', 'show']);
  assert.equal(context.events.at(-1), 'reopened');
});

test('an accepted quit finishing at sixty seconds resumes after the initial timeout', async () => {
  const context = await baselined([snapshot([app()]), snapshot([app({ windows: 0 })])]);
  assert.equal(context.events.at(-1), 'quit-timeout');
  assert.equal(context.controller.pendingLaunch, true);
  context.clock.now = NOW + 60000;
  const script = [
    snapshot([], { inputStamp: 7, frontmostPid: 1 }),
    snapshot([], { inputStamp: 7, frontmostPid: 1 }),
    snapshot([app({ key: 'debug', pid: 43, debugPort: 39222 })], { inputStamp: 7 }),
  ];
  context.adapter.snapshot = async () => script.length > 1 ? script.shift() : script[0];
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch']);
  assert.equal(context.events.at(-1), 'reopened');
  assert.equal(context.controller.pendingHandoff, null);
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch']);
});

test('a user-opened replacement cancels the pending late exit', async () => {
  const context = await baselined([snapshot([app()]), snapshot([app({ windows: 0 })])]);
  context.adapter.snapshot = async () => snapshot([app({ key: 'manual', pid: 99 })], { inputStamp: 8 });
  await context.controller.tick();
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit']);
  assert.equal(context.events.at(-1), 'late-exit-replaced');
  assert.equal(context.controller.pendingHandoff, null);
});

test('user activity after an unconfirmed quit prevents reopening on a later ordinary exit', async () => {
  const context = await baselined([snapshot([app()])]);
  context.clock.now = NOW + 5 * 60000;
  context.adapter.snapshot = async () => snapshot([app()], { inputStamp: 8 });
  await context.controller.tick();
  assert.equal(context.controller.pendingHandoff, null);
  assert.equal(context.events.at(-1), 'handoff-user-resumed');
  context.adapter.snapshot = async () => snapshot([], { inputStamp: 8 });
  await context.controller.tick();
  // The ignored request was re-sent twice while input stayed untouched.
  assert.deepEqual(context.calls, ['quit', 'quit', 'quit']);
});

test('a late termination notification itself relinquishes an interrupted handoff', async () => {
  const context = await baselined([snapshot([app()])]);
  context.clock.now = NOW + 60000;
  context.adapter.snapshot = async () => snapshot([], { inputStamp: 8 });
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'quit', 'quit']);
  assert.equal(context.controller.pendingHandoff, null);
  assert.equal(context.events.at(-1), 'handoff-user-resumed');
});

test('a persisted accepted quit can recover after the agent restarts', async () => {
  const first = await baselined([snapshot([app()])]);
  const restored = harness([snapshot([])], { pendingHandoff: first.controller.pendingHandoff });
  await restored.controller.tick();
  assert.deepEqual(restored.calls, ['launch', 'show']);
  await restored.controller.tick();
  assert.deepEqual(restored.calls, ['launch', 'show']);
  assert.equal(restored.events.at(-1), 'reopened');
});

test('an incomplete workspace identity can disappear without canceling the handoff', async () => {
  const incomplete = app({ key: '50:0', pid: 50, launchedAt: 0, finishedLaunching: false, argumentsKnown: false });
  const { calls, events } = await baselined([
    snapshot([app()]),
    snapshot([app(), incomplete]),
    snapshot([incomplete], { frontmostPid: 50 }),
    ...eligible.slice(1)
  ]);
  assert.deepEqual(calls, ['quit', 'launch']);
  assert.deepEqual(events, ['watching', 'attempt', 'quit-accepted', 'reopening', 'reopened']);
});

test('a verified new foreground launch after user input can recover during cooldown', async () => {
  const restarted = app({ key: 'second', pid: 44, launchedAt: NOW + 1000 });
  const context = harness([
    snapshot([]), snapshot([app()]),
    snapshot([restarted], { frontmostPid: 44, inputStamp: 8, inputIdleMs: 500 }),
    ...eligible.slice(1).map(item => ({ ...item, inputStamp: 8 }))
  ]);
  let quits = 0;
  context.adapter.quit = async () => {
    context.calls.push('quit');
    return { accepted: ++quits > 1 };
  };
  await context.controller.tick();
  await context.controller.tick();
  context.clock.now = NOW + 1400;
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'quit', 'launch']);
  assert.deepEqual(context.events, ['watching', 'attempt', 'quit-refused', 'attempt', 'quit-accepted', 'reopening', 'reopened']);
});

test('an incomplete launch snapshot is retried once its process identity is available', async () => {
  const { controller, calls, events } = await baselined([
    snapshot([app({ key: '42:0', launchedAt: 0, finishedLaunching: false, argumentsKnown: false })]),
    ...eligible
  ]);
  assert.equal(controller.pendingLaunch, true);
  await controller.tick();
  assert.deepEqual(calls, ['quit', 'launch']);
  assert.deepEqual(events, ['watching', 'attempt', 'quit-accepted', 'reopening', 'reopened']);
});

test('a pre-existing app with incomplete launch metadata is never handed off', async () => {
  const context = harness([
    snapshot([app({ key: '42:0', launchedAt: 0, finishedLaunching: false })]),
    snapshot([app()])
  ]);
  await context.controller.tick();
  await context.controller.tick();
  assert.deepEqual(context.calls, []);
  assert.deepEqual(context.events, ['watching']);
});

test('launch clicks settle and retry instead of permanently excluding the new process', async () => {
  const context = await baselined([
    snapshot([app()], { inputIdleMs: 50, keyboardIdleMs: 10000 }),
    snapshot([app()], { inputIdleMs: 400, keyboardIdleMs: 10000 }),
    ...eligible.slice(1),
  ]);
  assert.equal(context.controller.pendingLaunch, true);
  assert.equal(context.controller.seen.has('new'), false);
  assert.deepEqual(context.calls, []);
  assert.equal(context.events.at(-1), 'waiting-startup');
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch']);
});

test('typing after launch still protects the running session', async () => {
  const decisions = [];
  const context = await baselined([
    snapshot([app()], { inputIdleMs: 400, keyboardIdleMs: 400 }),
  ], {}, { record: async (event, details) => decisions.push({event, ...details}) });
  assert.deepEqual(context.calls, []);
  assert.equal(decisions.at(-1).reason, 'keyboard-input');
  assert.equal(decisions.at(-1).ageMs, 2000);
});

test('input during the native quit guard retries the same fresh process without cooldown', async () => {
  let attempts = 0;
  const context = await baselined([
    snapshot([app()], { inputIdleMs: 400, keyboardIdleMs: 10000 }),
    snapshot([app()], { inputIdleMs: 500, keyboardIdleMs: 10000, inputStamp: 8 }),
    ...eligible.slice(1).map(s => ({...s, inputStamp:8})),
  ], {}, { quit: async () => ({ accepted: ++attempts > 1, reason: 'input-changed' }) });
  assert.equal(context.controller.pendingLaunch, true);
  await context.controller.tick();
  assert.equal(attempts, 2);
  assert.deepEqual(context.calls, ['launch']);
});

test('a launch observed early can finish slowly and still receive its handoff', async () => {
  const context = await baselined([
    snapshot([app({finishedLaunching:false})], {keyboardIdleMs:10000}),
    snapshot([app()], {inputIdleMs:30000, keyboardIdleMs:30000}),
    ...eligible.slice(1),
  ]);
  context.clock.now = NOW + 20000;
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch']);
});

test('a background update launch can come forward after the initial eight seconds', async () => {
  const context = await baselined([
    snapshot([app()], {frontmostPid:1, keyboardIdleMs:10000}),
    snapshot([app()], {inputIdleMs:40000, keyboardIdleMs:40000}),
    ...eligible.slice(1),
  ]);
  context.clock.now = NOW + 30000;
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch']);
});

test('an observed startup wait remains bounded and never quits after its deadline', async () => {
  const context = await baselined([snapshot([app({finishedLaunching:false})], {keyboardIdleMs:10000})]);
  context.clock.now = NOW + 121000;
  context.adapter.snapshot = async () => snapshot([app()], {inputIdleMs:200000, keyboardIdleMs:200000});
  await context.controller.tick();
  assert.deepEqual(context.calls, []);
  assert.equal(context.controller.pendingLaunch, false);
});

// A quit Apple Event that arrives before ChatGPT shows its first window is approved by
// AppKit without the app's quit lifecycle (2026-11-14 production logs, PIDs 30429/38703/79438).
test('a launched app without a visible window is not asked to quit yet', async () => {
  const { calls, events } = await baselined([
    snapshot([app({ windows: 0 })]),
    snapshot([app({ windows: 0 })])
  ]);
  assert.deepEqual(calls, []);
  assert.deepEqual(events, ['watching', 'waiting-startup']);
});

test('the handoff starts once the first window has been visible for the settle time', async () => {
  const context = harness([snapshot([]), snapshot([app({ windows: 0 })]), snapshot([app()]), snapshot([app()]),
    snapshot([], { frontmostPid: 1 }), snapshot([], { frontmostPid: 1 }), snapshot([app({ key: 'debug', pid: 43, debugPort: 39222 })], { frontmostPid: 1 })],
  { windowSettleMs: 1000 });
  await context.controller.tick();
  await context.controller.tick();
  await context.controller.tick();
  assert.deepEqual(context.calls, [], 'window just appeared');
  context.clock.now += 1000;
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch', 'show']);
});

test('a bridge without window information never triggers a quit', async () => {
  const legacy = app();
  delete legacy.windows;
  const { calls } = await baselined([snapshot([legacy])]);
  assert.deepEqual(calls, []);
});

test('a native not-ready refusal is retried for the same launch', async () => {
  const answers = [{ accepted: false, reason: 'not-ready' }, { accepted: true }];
  const quits = [];
  const context = await baselined([snapshot([app()]), snapshot([app()]), snapshot([], { frontmostPid: 1 }), snapshot([], { frontmostPid: 1 }),
    snapshot([app({ key: 'debug', pid: 43, debugPort: 39222 })], { frontmostPid: 1 })], {},
  { quit: async () => { quits.push('quit'); return answers.shift(); } });
  assert.deepEqual(quits, ['quit']);
  assert.ok(context.events.includes('quit-refused'));
  await context.controller.tick();
  assert.deepEqual(quits, ['quit', 'quit']);
  assert.deepEqual(context.calls, ['launch', 'show']);
});

test('an updater relaunch overlapping the retiring process is handed off once alone', async () => {
  const old = app({ key: 'old', pid: 41, launchedAt: NOW - 600000, debugPort: null });
  const context = harness([snapshot([old]), snapshot([old, app()]), snapshot([app()]), snapshot([], { frontmostPid: 1 }), snapshot([], { frontmostPid: 1 }),
    snapshot([app({ key: 'debug', pid: 43, debugPort: 39222 })], { frontmostPid: 1 })]);
  await context.controller.tick();
  await context.controller.tick();
  assert.deepEqual(context.calls, []);
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch', 'show']);
});

// 2026-11-14 15:30, PID40718: the accepted quit closed the window at once, the app drained
// for 42.5 s, and clicks elsewhere during that time made the exit look like a user quit.
test('clicks elsewhere while the app drains windowless still reopen it after exit', async () => {
  const context = await baselined([snapshot([app()]), snapshot([app({ windows: 0 })])]);
  assert.equal(context.events.at(-1), 'quit-timeout');
  assert.equal(context.controller.pendingHandoff.windows, 0);
  context.clock.now += 10000;
  context.adapter.snapshot = async () => snapshot([app({ windows: 0 })], { inputStamp: 8 });
  await context.controller.tick();
  assert.ok(context.controller.pendingHandoff, 'still draining: keep the handoff');
  context.adapter.snapshot = async () => snapshot([], { inputStamp: 8 });
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'launch']);
  assert.equal(context.events.at(-1), 'reopened');
});

test('a windowless app that exits only after the drain limit is not reopened', async () => {
  const context = await baselined([snapshot([app()]), snapshot([app({ windows: 0 })])]);
  context.clock.now = NOW + 11 * 60000;
  context.adapter.snapshot = async () => snapshot([], { inputStamp: 8 });
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit']);
  assert.equal(context.events.at(-1), 'handoff-user-resumed');
});

test('a draining app that shows a window again is treated as declined once the user acts', async () => {
  const context = await baselined([snapshot([app()]), snapshot([app({ windows: 0 })])]);
  context.clock.now += 10000;
  context.adapter.snapshot = async () => snapshot([app()], { inputStamp: 8 });
  await context.controller.tick();
  assert.equal(context.controller.pendingHandoff, null);
  assert.equal(context.events.at(-1), 'handoff-user-resumed');
});

// 2026-11-14 15:53, PID69030: the accepted quit closed the first window, the host built a
// new main window at once and kept running.
test('a quit the host cancels by keeping a window is re-sent once input is untouched', async () => {
  const context = harness([snapshot([])]);
  let phase = 0;
  context.adapter.snapshot = async () => {
    if (phase++ === 0) return snapshot([]);
    if (context.calls.filter(call => call === 'quit').length < 2) return snapshot([app()]);
    return snapshot([], { frontmostPid: 1 });
  };
  await context.controller.tick();
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit', 'quit', 'launch', 'show']);
  assert.ok(context.events.includes('quit-retried'));
});

test('a cancelled quit is not re-sent after any click, key or scroll', async () => {
  const context = harness([snapshot([])]);
  let phase = 0;
  context.adapter.snapshot = async () => (phase++ === 0 ? snapshot([]) : phase < 4 ? snapshot([app()]) : snapshot([app()], { inputStamp: 8 }));
  await context.controller.tick();
  await context.controller.tick();
  assert.deepEqual(context.calls, ['quit']);
  assert.equal(context.events.at(-1), 'quit-timeout');
});

test('a draining app without windows is never asked again', async () => {
  const { calls, events } = await baselined([snapshot([app()]), snapshot([app({ windows: 0 })])]);
  assert.deepEqual(calls, ['quit']);
  assert.ok(!events.includes('quit-retried'));
});
