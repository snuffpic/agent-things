'use strict';
const { progressError } = require('./progress-error.cjs');
function requestBudget({ timeoutMs = 5000, signal } = {}) {
  const deadline = performance.now() + timeoutMs;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason || progressError('REQUEST_CANCELLED'));
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(progressError('REQUEST_TIMEOUT')), timeoutMs);
  return {
    signal: controller.signal,
    remaining() { controller.signal.throwIfAborted(); return Math.max(1, deadline - performance.now()); },
    async run(operation) {
      controller.signal.throwIfAborted();
      let abort;
      try { return await Promise.race([operation(), new Promise((_, reject) => {
        abort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', abort, { once: true });
        if (controller.signal.aborted) abort();
      })]); } finally { if (abort) controller.signal.removeEventListener('abort', abort); }
    },
    dispose() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); },
  };
}
module.exports = { requestBudget };
