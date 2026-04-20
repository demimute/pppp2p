const path = require('path');
const { appendEvent, readJson, writeJson, nowIso } = (() => {
  const base = require('./progress-lib.js');
  return {
    appendEvent: base.appendEvent,
    readJson: base.readJson,
    writeJson: base.writeJson,
    nowIso: base.nowIso,
  };
})();

const PLAN_PATH = path.resolve(__dirname, '..', 'ops', 'plan.json');
const OWNERS_PATH = path.resolve(__dirname, '..', 'ops', 'owners.json');

async function loadPlan() {
  return readJson(PLAN_PATH, {
    main_goal: '',
    active_tasks: [],
    queued_tasks: [],
    blocked_tasks: [],
    completed_tasks: [],
  });
}

async function savePlan(plan) {
  await writeJson(PLAN_PATH, plan);
  return plan;
}

async function markTaskStarted(taskId, owner = 'orchestrator') {
  const plan = await loadPlan();
  const task = plan.queued_tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`queued task not found: ${taskId}`);

  plan.queued_tasks = plan.queued_tasks.filter((item) => item.id !== taskId);
  plan.active_tasks.push({ ...task, owner, status: 'running', started_at: nowIso() });
  await savePlan(plan);
  await appendEvent({ type: 'task_started', task_id: taskId, owner });
  return plan;
}

async function markTaskCompleted(taskId, result = {}) {
  const plan = await loadPlan();
  const activeTask = plan.active_tasks.find((item) => item.id === taskId);
  const queuedTask = plan.queued_tasks.find((item) => item.id === taskId);
  const task = activeTask || queuedTask;
  if (!task) throw new Error(`task not found in active/queued lists: ${taskId}`);

  plan.active_tasks = plan.active_tasks.filter((item) => item.id !== taskId);
  plan.queued_tasks = plan.queued_tasks.filter((item) => item.id !== taskId);
  plan.completed_tasks = plan.completed_tasks.filter((item) => item.id !== taskId);
  plan.completed_tasks.push({ ...task, status: 'done', completed_at: nowIso(), result });
  await savePlan(plan);
  await appendEvent({ type: 'task_completed', task_id: taskId, result, repaired_from: activeTask ? 'active' : 'queued' });
  return plan;
}

async function pickNextRunnableTask() {
  const plan = await loadPlan();
  const completedIds = new Set(plan.completed_tasks.map((task) => task.id));
  return plan.queued_tasks.find((task) =>
    (task.depends_on || []).every((dep) => completedIds.has(dep))
  ) || null;
}

async function loadOwners() {
  return readJson(OWNERS_PATH, {});
}

async function resolveTaskOwner(task) {
  const owners = await loadOwners();
  if (!task?.module) return task?.owner || 'unassigned';
  return owners[task.module]?.owner || task?.owner || 'unassigned';
}

module.exports = {
  OWNERS_PATH,
  PLAN_PATH,
  loadOwners,
  loadPlan,
  resolveTaskOwner,
  savePlan,
  markTaskStarted,
  markTaskCompleted,
  pickNextRunnableTask,
};
