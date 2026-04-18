const { appendEvent, updateState } = require('./progress-lib.js');
const { loadPlan } = require('./task-lib.js');

async function main() {
  const plan = await loadPlan();
  const hasActive = plan.active_tasks.length > 0;
  const hasQueued = plan.queued_tasks.length > 0;

  if (!hasActive && hasQueued) {
    await updateState({
      status: 'stalled',
      last_error: '主线没有活跃任务，但仍有排队任务未启动',
    });
    await appendEvent({ type: 'watchdog_alert', reason: 'no active tasks while queue is non-empty' });
    process.stdout.write(JSON.stringify({ status: 'stalled', reason: 'queue waiting with no active task' }) + '\n');
    return;
  }

  process.stdout.write(JSON.stringify({ status: 'ok', active: plan.active_tasks.length, queued: plan.queued_tasks.length }) + '\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
