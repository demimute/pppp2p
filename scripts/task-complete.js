const { appendEvent, updateState } = require('./progress-lib.js');
const { markTaskCompleted, pickNextRunnableTask } = require('./task-lib.js');

async function main() {
  const taskId = process.argv[2];
  const result = process.argv[3] ? JSON.parse(process.argv[3]) : {};

  if (!taskId) {
    throw new Error('usage: node scripts/task-complete.js <taskId> [jsonResult]');
  }

  await markTaskCompleted(taskId, result);
  const nextTask = await pickNextRunnableTask();
  await updateState({
    current_step: nextTask ? `等待续派: ${nextTask.title}` : '等待下一主线任务',
    status: nextTask ? 'running' : 'stalled',
    last_progress_at: new Date().toISOString(),
    last_error: nextTask ? null : '当前无可运行的下一主线任务',
  });
  await appendEvent({ type: 'task_complete_processed', task_id: taskId, next_task: nextTask?.id || null });
  process.stdout.write(JSON.stringify({ ok: true, task_id: taskId, next_task: nextTask?.id || null }) + '\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
