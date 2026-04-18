const { appendEvent, updateState } = require('./progress-lib.js');
const { loadPlan, markTaskCompleted, pickNextRunnableTask } = require('./task-lib.js');

async function main() {
  const taskId = process.argv[2];
  const result = process.argv[3] ? JSON.parse(process.argv[3]) : {};

  if (!taskId) {
    throw new Error('usage: node scripts/task-complete.js <taskId> [jsonResult]');
  }

  const updatedPlan = await markTaskCompleted(taskId, result);
  const nextTask = await pickNextRunnableTask();
  const hasActive = updatedPlan.active_tasks.length > 0;
  const allDone = updatedPlan.queued_tasks.length === 0 && updatedPlan.active_tasks.length === 0;
  await updateState({
    current_step: allDone
      ? '主线任务已全部完成'
      : hasActive
        ? `主线任务运行中: ${updatedPlan.active_tasks[0].title}`
        : nextTask
          ? `等待续派: ${nextTask.title}`
          : '等待下一主线任务',
    status: allDone ? 'done' : (hasActive || nextTask ? 'running' : 'stalled'),
    last_progress_at: new Date().toISOString(),
    last_error: allDone ? null : (nextTask || hasActive ? null : '当前无可运行的下一主线任务'),
    evidence: {
      completed_task: taskId,
      result_summary: result.summary || null,
    },
  });
  await appendEvent({ type: 'task_complete_processed', task_id: taskId, next_task: nextTask?.id || null });
  process.stdout.write(JSON.stringify({ ok: true, task_id: taskId, next_task: nextTask?.id || null }) + '\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
