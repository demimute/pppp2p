const { appendEvent, updateState } = require('./progress-lib.js');
const { loadPlan, markTaskStarted, pickNextRunnableTask, resolveTaskOwner } = require('./task-lib.js');

async function main() {
  const plan = await loadPlan();
  if (plan.active_tasks.length > 0) {
    process.stdout.write(JSON.stringify({ status: 'ok', active: plan.active_tasks.length, action: 'noop' }) + '\n');
    return;
  }

  const allDone = plan.queued_tasks.length === 0 && plan.active_tasks.length === 0;
  const nextTask = await pickNextRunnableTask();
  if (!nextTask) {
    if (allDone) {
      await updateState({
        current_step: '主线任务已全部完成',
        status: 'done',
        last_error: null,
        last_progress_at: new Date().toISOString(),
      });
      await appendEvent({ type: 'orchestrator_finished' });
      process.stdout.write(JSON.stringify({ status: 'done', action: 'finished' }) + '\n');
      return;
    }

    await updateState({ status: 'stalled', last_error: '主线未完成且没有可运行任务' });
    await appendEvent({ type: 'orchestrator_stalled', reason: 'no runnable tasks' });
    process.stdout.write(JSON.stringify({ status: 'stalled', action: 'none' }) + '\n');
    return;
  }

  const owner = await resolveTaskOwner(nextTask);
  await markTaskStarted(nextTask.id, owner);
  await updateState({
    current_step: `主线任务运行中: ${nextTask.title}`,
    status: 'running',
    last_progress_at: new Date().toISOString(),
    last_error: null,
  });
  await appendEvent({ type: 'orchestrator_started_task', task_id: nextTask.id, title: nextTask.title, owner, module: nextTask.module || null });
  process.stdout.write(JSON.stringify({ status: 'ok', action: 'started', task_id: nextTask.id, title: nextTask.title, owner, module: nextTask.module || null }) + '\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
