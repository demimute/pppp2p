const { appendEvent, recordFailure, recordProgress, updateState } = require('./progress-lib.js');

async function main() {
  const mode = process.argv[2];
  const step = process.argv[3] || '';
  const extra = process.argv[4] ? JSON.parse(process.argv[4]) : {};

  if (!mode) {
    throw new Error('usage: node scripts/progress-update.js <progress|failure|goal> <step> [json]');
  }

  if (mode === 'goal') {
    await updateState({
      current_goal: step,
      current_step: extra.current_step || step,
      status: 'running',
      started_at: new Date().toISOString(),
      last_progress_at: new Date().toISOString(),
      last_error: null,
      ...extra,
    });
    await appendEvent({ type: 'goal_set', goal: step });
    return;
  }

  if (mode === 'progress') {
    await recordProgress(step, extra);
    await appendEvent({ type: 'step_progress', step, ...extra });
    return;
  }

  if (mode === 'failure') {
    await recordFailure(step, extra.error || 'unknown failure', extra);
    await appendEvent({ type: 'step_failed', step, error: extra.error || 'unknown failure' });
    return;
  }

  throw new Error(`unknown mode: ${mode}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
