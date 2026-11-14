'use strict';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAX_LAUNCH_AGE_MS = 8000;
const MAX_STARTUP_WAIT_MS = 120000;
const INPUT_QUIET_MS = 350;
// A quit request that reaches ChatGPT before its main process shows a window is approved
// by AppKit without the app's own quit lifecycle: the app keeps running, then exits
// abruptly minutes later. Only ask once a window has been on screen for a moment.
const WINDOW_SETTLE_MS = 1000;
// ChatGPT can drain background work before the final shutdown.
const QUIT_TIMEOUT_MS = 25000;
// A windowless app is inside its own quit lifecycle; ChatGPT has taken 5–43 s there.
// Keep the handoff for it, but never claim an exit this long after the request.
const MAX_DRAIN_MS = 600000;
// Quitting closes every window first. A target that keeps a window this long after an
// accepted request has cancelled it: ChatGPT does so when it rebuilds its main window
// during startup (2026-11-14 15:53, PID69030). Re-ask only while nobody has touched input.
const DECLINED_AFTER_MS = 5000;
const MAX_QUIT_RETRIES = 2;
const COOLDOWN_MS = 120000;

// Decides whether a freshly opened Codex may be swapped for one with the debugging port.
// All side effects go through `adapter`, so every guard below is testable without a real app.
class StartupController {
  constructor(adapter, { now = Date.now, sleep = delay, lastAttemptAt = 0, attemptPid, attemptInputStamp, pendingHandoff = null, cooldownMs = COOLDOWN_MS, allowClientRestart = true, windowSettleMs = WINDOW_SETTLE_MS } = {}) {
    Object.assign(this, { adapter, now, sleep, lastAttemptAt, attemptPid, attemptInputStamp, cooldownMs, windowSettleMs });
    this.allowClientRestart = allowClientRestart === true;
    this.seen = new Set();
    this.seenIncomplete = new Set();
    this.baselined = false;
    this.busy = false;
    this.stopped = false;
    this.pendingLaunch = false;
    this.pendingHandoff = pendingHandoff;
    this.windowSeen = null;
  }

  // Bridges without window information never report a ready host, so nothing is quit early.
  hostReady(app) {
    if (!app.finishedLaunching || !(app.windows > 0)) {
      if (this.windowSeen?.key === app.key) this.windowSeen = null;
      return false;
    }
    if (this.windowSeen?.key !== app.key) this.windowSeen = { key: app.key, since: this.now() };
    return this.now() - this.windowSeen.since >= this.windowSettleMs;
  }

  stop() {
    this.stopped = true;
  }

  remember(apps) {
    for (const app of apps) {
      this.seen.add(app.key);
      if (app.launchedAt === 0) this.seenIncomplete.add(app.pid);
    }
  }

  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    this.pendingLaunch = false;
    try {
      await this.evaluate();
    } catch (error) {
      await this.adapter.record('error', { message: error.message }).catch(() => {});
    } finally {
      this.busy = false;
    }
  }

  async evaluate() {
    const snapshot = await this.adapter.snapshot();
    if (!this.allowClientRestart) {
      this.seen = new Set(snapshot.apps.map(app => app.key));
      this.baselined = true;
      await this.adapter.record('observing', { existingApps: snapshot.apps.length });
      return;
    }
    // Anything already running when we start is somebody's work session: never touch it.
    if (!this.baselined) {
      this.remember(snapshot.apps);
      this.baselined = true;
      await this.adapter.record('watching', { existingApps: snapshot.apps.length });
      if (this.pendingHandoff) await this.resumeHandoff(snapshot);
      return;
    }

    if (this.pendingHandoff) {
      await this.resumeHandoff(snapshot);
      return;
    }

    const livePids = new Set(snapshot.apps.map(app => app.pid));
    for (const pid of this.seenIncomplete) {
      if (!livePids.has(pid)) this.seenIncomplete.delete(pid);
    }
    const fresh = snapshot.apps.filter(app => !this.seen.has(app.key) && !this.seenIncomplete.has(app.pid));
    if (this.seen.size > 256) this.seen = new Set(snapshot.apps.map(app => app.key));
    // An updater relaunch can briefly overlap the retiring process. Keep the young
    // newcomer unclaimed until it is alone instead of marking it seen forever.
    if (fresh.length === 1 && snapshot.apps.length > 1 && fresh[0].launchedAt > 0
        && this.now() - fresh[0].launchedAt <= MAX_LAUNCH_AGE_MS) {
      for (const app of snapshot.apps) if (app !== fresh[0]) this.seen.add(app.key);
      this.pendingLaunch = true;
      return;
    }
    if (fresh.length !== 1 || snapshot.apps.length !== 1) {
      this.remember(snapshot.apps);
      return;
    }

    const app = fresh[0];
    const now = this.now();
    if (app.launchedAt === 0) {
      if (this.pendingIdentity?.pid !== app.pid) this.pendingIdentity = { pid: app.pid, since: now };
      if (now - this.pendingIdentity.since < MAX_LAUNCH_AGE_MS) this.pendingLaunch = true;
      else this.remember([app]);
      return;
    }
    this.pendingIdentity = null;
    const age = now - app.launchedAt;
    if (!app.argumentsKnown || app.debugPort !== null) {
      this.seen.add(app.key);
      return;
    }
    const hasKeyboardClock = Number.isFinite(snapshot.keyboardIdleMs);
    const keyboardIdleMs = hasKeyboardClock ? snapshot.keyboardIdleMs : snapshot.inputIdleMs;
    const launchDeadline = this.launchCandidate?.key === app.key
      ? this.launchCandidate.deadline : app.launchedAt + MAX_LAUNCH_AGE_MS;
    const untouched = age >= 0 && now <= launchDeadline && keyboardIdleMs >= age;
    const inputQuiet = !hasKeyboardClock || snapshot.inputIdleMs >= INPUT_QUIET_MS;
    const ready = this.hostReady(app);
    // Dock and navigation clicks settle before the handoff. Typing still protects
    // the running session, and the native helper rechecks input immediately before quit.
    if (untouched && (!ready || snapshot.frontmostPid !== app.pid || !inputQuiet)) {
      if (this.launchCandidate?.key !== app.key) this.launchCandidate = { key: app.key, deadline: app.launchedAt + MAX_STARTUP_WAIT_MS };
      const reason = !app.finishedLaunching ? 'launching' : !ready ? 'host-starting'
        : snapshot.frontmostPid !== app.pid ? 'background' : 'input-settling';
      const waitingFor = `${app.key}:${reason}`;
      if (this.waitingFor !== waitingFor) {
        this.waitingFor = waitingFor;
        await this.adapter.record('waiting-startup', { processKey: app.key, reason, ageMs: age,
          inputIdleMs: snapshot.inputIdleMs, keyboardIdleMs });
      }
      this.pendingLaunch = true;
      return;
    }

    // Remember rejected candidates too, so a running window is never revisited later.
    this.seen.add(app.key);
    if (!untouched || snapshot.frontmostPid !== app.pid) {
      await this.adapter.record('skipped-active-or-background', { processKey: app.key,
        reason: age < 0 ? 'invalid-launch-time' : now > launchDeadline ? 'launch-window-expired' : 'keyboard-input',
        ageMs: age, inputIdleMs: snapshot.inputIdleMs, keyboardIdleMs, frontmostPid: snapshot.frontmostPid });
      return;
    }
    // Allow a genuinely new user launch to recover after a failed handoff.
    const userReopened = Number.isFinite(this.attemptInputStamp) && this.attemptPid != null && app.pid !== this.attemptPid
      && snapshot.inputStamp !== this.attemptInputStamp
      && app.launchedAt > this.lastAttemptAt && now - snapshot.inputIdleMs > this.lastAttemptAt;
    if (!userReopened && this.lastAttemptAt && now - this.lastAttemptAt < this.cooldownMs) {
      await this.adapter.record('skipped-cooldown');
      return;
    }
    if (await this.adapter.portInUse()) {
      await this.adapter.record('port-in-use');
      return;
    }
    await this.handoff(app, snapshot);
  }

  async handoff(app, snapshot) {
    if (this.stopped) return;
    // The receipt must be durable before quitting, so a crash here cannot become a restart loop.
    this.lastAttemptAt = this.now();
    this.attemptPid = app.pid;
    this.attemptInputStamp = snapshot.inputStamp;
    await this.adapter.record('attempt', { lastAttemptAt: this.lastAttemptAt, processKey: app.key,
      attemptPid: this.attemptPid, attemptInputStamp: this.attemptInputStamp });
    if (this.stopped) return;

    const quit = await this.adapter.quit(app, snapshot.inputStamp);
    if (!quit.accepted) {
      const deadline = this.launchCandidate?.key === app.key ? this.launchCandidate.deadline : app.launchedAt + MAX_LAUNCH_AGE_MS;
      const retry = (quit.reason === 'input-changed' || quit.reason === 'not-ready') && this.now() <= deadline;
      if (retry) {
        this.seen.delete(app.key);
        this.pendingLaunch = true;
        this.lastAttemptAt = 0;
      }
      await this.adapter.record('quit-refused', { reason: quit.reason, retry, lastAttemptAt: this.lastAttemptAt });
      return;
    }

    this.pendingHandoff = { app, inputStamp: snapshot.inputStamp, requestedAt: this.now() };
    await this.adapter.record('quit-accepted', { pendingHandoff: this.pendingHandoff });
    const absent = await this.waitForExit(app, snapshot.inputStamp);
    if (!absent) {
      this.pendingLaunch = Boolean(this.pendingHandoff);
      return;
    }
    await this.reopen(absent, snapshot.inputStamp);
  }

  async resumeHandoff(snapshot) {
    const pending = this.pendingHandoff;
    const replaced = snapshot.apps.some(app => app.key !== pending.app.key &&
      !(app.pid === pending.app.pid && app.launchedAt === 0));
    // An accepted OS quit request cannot be withdrawn by expiring our receipt.
    // Keep ownership of that process until it exits or a replacement takes over.
    if (replaced) {
      this.remember(snapshot.apps);
      this.pendingHandoff = null;
      await this.adapter.record('late-exit-replaced', { pendingHandoff: null });
      return;
    }
    const requestedAt = pending.requestedAt ?? this.lastAttemptAt;
    const target = snapshot.apps.find(app => app.key === pending.app.key);
    if (target) pending.windows = Number.isInteger(target.windows) ? target.windows : null;
    // Input only means "the user is back in this app" while it still has a window: a
    // draining, windowless app cannot be used, so clicks elsewhere keep the handoff.
    // A later ordinary exit of a usable app must not be mistaken for this handoff.
    const elapsed = this.now() - requestedAt;
    const draining = pending.windows === 0;
    if ((elapsed >= QUIT_TIMEOUT_MS && snapshot.inputStamp !== pending.inputStamp && !draining) || elapsed >= MAX_DRAIN_MS) {
      this.remember(snapshot.apps);
      this.pendingHandoff = null;
      await this.adapter.record('handoff-user-resumed', { pendingHandoff: null, processKey: pending.app.key });
      return;
    }
    if (snapshot.apps.length) {
      this.pendingLaunch = true;
      return;
    }
    await this.adapter.record('late-exit-observed', { processKey: pending.app.key });
    await this.reopen(snapshot, pending.inputStamp);
  }

  async reopen(absent, inputStamp) {
    await this.adapter.record('reopening');
    this.pendingHandoff = null;
    if (this.stopped) return;

    await this.sleep(250);
    const beforeLaunch = await this.adapter.snapshot();
    if (this.stopped || beforeLaunch.apps.length) {
      this.remember(beforeLaunch.apps);
      await this.adapter.record('reopen-canceled', { pendingHandoff: null });
      return;
    }

    // Past a successful quit, input only suppresses focus; the app itself is always reopened.
    const opened = await this.adapter.launch();
    if (!opened.launched) {
      await this.adapter.record('launch-failed', { pendingHandoff: null });
      return;
    }
    if (opened.key) this.seen.add(opened.key);
    if (this.stopped) return;

    const beforeShow = await this.adapter.snapshot();
    this.remember(beforeShow.apps);
    const undisturbed = absent.inputStamp === inputStamp
      && beforeLaunch.inputStamp === inputStamp
      && beforeShow.inputStamp === inputStamp
      && beforeShow.frontmostPid === beforeLaunch.frontmostPid
      && !beforeShow.apps.some(current => current.key !== opened.key);
    const shown = undisturbed && !this.stopped
      ? await this.adapter.show(opened, inputStamp, beforeLaunch.frontmostPid)
      : { shown: false };
    await this.adapter.record('reopened', { shown: !!shown.shown, processKey: opened.key, lastAttemptAt: 0, pendingHandoff: null });
    this.lastAttemptAt = 0;
  }

  async waitForExit(app, inputStamp) {
    const startedAt = this.now();
    let deadline = startedAt + QUIT_TIMEOUT_MS;
    let waitingFor = app;
    let followedReplacement = false;
    let retries = 0;
    let shownSince = null;
    let current;
    while (!this.stopped && this.now() < deadline) {
      await this.sleep(200);
      current = await this.adapter.snapshot();
      const replacements = current.apps.filter(other => other.key !== waitingFor.key
        && !(other.pid === waitingFor.pid && other.launchedAt === 0));
      if (replacements.length) {
        const candidate = replacements[0];
        const age = this.now() - candidate.launchedAt;
        const untouched = current.inputStamp === inputStamp && age >= 0 && age <= MAX_STARTUP_WAIT_MS && current.inputIdleMs >= age;
        // LaunchServices can briefly report both the retiring process and its replacement.
        if (!followedReplacement && current.inputStamp === inputStamp && replacements.length === 1
            && (candidate.launchedAt === 0 || (untouched && current.apps.length > 1))) continue;
        // Follow one automatic startup replacement as part of this same handoff. A user
        // reopening the app changes the input stamp, so their new session stays untouched.
        if (!followedReplacement && untouched && current.apps.length === 1 &&
            candidate.argumentsKnown && candidate.debugPort === null &&
            (current.frontmostPid === candidate.pid || current.frontmostPid === waitingFor.pid)) {
          if (!this.hostReady(candidate)) continue;
          this.seen.add(candidate.key);
          followedReplacement = true;
          await this.adapter.record('following-startup-replacement', {
            previousProcessKey: waitingFor.key, processKey: candidate.key
          });
          if (this.stopped) return null;
          const quit = await this.adapter.quit(candidate, inputStamp);
          if (!quit.accepted) {
            this.pendingHandoff = null;
            await this.adapter.record('quit-refused', { pendingHandoff: null });
            return null;
          }
          this.pendingHandoff.app = candidate;
          await this.adapter.record('quit-accepted', { pendingHandoff: this.pendingHandoff });
          waitingFor = candidate;
          continue;
        }
        this.remember(current.apps);
        this.pendingHandoff = null;
        await this.adapter.record('another-instance-started', {
          processKey: waitingFor.key, processKeys: current.apps.map(other => other.key), inputChanged: current.inputStamp !== inputStamp,
          pendingHandoff: null
        });
        return null;
      }
      if (current.apps.length === 0) return current;
      const target = current.apps.find(other => other.key === waitingFor.key);
      if (!(target?.windows > 0)) { shownSince = null; continue; }
      shownSince ??= this.now();
      if (this.now() - shownSince < DECLINED_AFTER_MS || retries >= MAX_QUIT_RETRIES || current.inputStamp !== inputStamp) continue;
      retries += 1;
      shownSince = null;
      if (this.stopped) return null;
      const again = await this.adapter.quit(target, inputStamp);
      await this.adapter.record('quit-retried', { processKey: target.key, attempt: retries, accepted: !!again.accepted, reason: again.reason ?? null });
      if (again.accepted) {
        this.pendingHandoff.requestedAt = this.now();
        deadline = this.now() + QUIT_TIMEOUT_MS;
      } else retries = MAX_QUIT_RETRIES;
    }
    const remaining = current?.apps.find(other => other.key === waitingFor.key);
    if (this.pendingHandoff && remaining) this.pendingHandoff.windows = Number.isInteger(remaining.windows) ? remaining.windows : null;
    if (!this.stopped) await this.adapter.record('quit-timeout', { processKey: waitingFor.key, pendingHandoff: this.pendingHandoff,
      waitedMs: this.now() - startedAt, processKeys: current?.apps.map(other => other.key) || [],
      // Zero windows means the app entered its own quit lifecycle and is draining.
      windows: current?.apps.find(other => other.key === waitingFor.key)?.windows ?? null,
      inputChanged: current?.inputStamp !== inputStamp });
    return null;
  }
}

module.exports = { StartupController, COOLDOWN_MS, WINDOW_SETTLE_MS };
