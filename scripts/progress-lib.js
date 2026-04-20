const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OPS_DIR = path.join(ROOT, 'ops');
const STATE_PATH = path.join(OPS_DIR, 'state.json');
const EVENTS_PATH = path.join(OPS_DIR, 'events.jsonl');
const REPORT_LOCK_PATH = path.join(OPS_DIR, 'report.lock');

async function ensureOpsDir() {
  await fs.mkdir(OPS_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await ensureOpsDir();
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tempPath, filePath);
}

async function loadState() {
  await ensureOpsDir();
  return readJson(STATE_PATH, {
    current_goal: '',
    current_step: '',
    status: 'idle',
    started_at: null,
    last_progress_at: null,
    last_report_at: null,
    last_report_hash: null,
    last_error: null,
    changed_files: [],
    evidence: {},
  });
}

async function saveState(state) {
  await ensureOpsDir();
  await writeJson(STATE_PATH, state);
  return state;
}

async function updateState(patch) {
  const state = await loadState();
  const next = {
    ...state,
    ...patch,
  };
  await saveState(next);
  return next;
}

async function appendEvent(event) {
  await ensureOpsDir();
  const payload = {
    ts: nowIso(),
    ...event,
  };
  await fs.appendFile(EVENTS_PATH, `${JSON.stringify(payload)}\n`);
  return payload;
}

async function recordProgress(step, patch = {}) {
  return updateState({
    current_step: step,
    status: 'running',
    last_progress_at: nowIso(),
    last_error: null,
    ...patch,
  });
}

async function recordFailure(step, error, patch = {}) {
  return updateState({
    current_step: step,
    status: 'blocked',
    last_error: error instanceof Error ? error.message : String(error),
    ...patch,
  });
}

async function detectStall(thresholdMinutes = 10) {
  const state = await loadState();
  if (!state.last_progress_at) return { stalled: false, state };

  const diffMs = Date.now() - new Date(state.last_progress_at).getTime();
  const stalled = diffMs >= thresholdMinutes * 60 * 1000;

  if (stalled && state.status !== 'stalled') {
    const next = await updateState({
      status: 'stalled',
      last_error: `超过 ${thresholdMinutes} 分钟无新进展`,
    });
    await appendEvent({ type: 'stall_detected', threshold_minutes: thresholdMinutes });
    return { stalled: true, state: next };
  }

  return { stalled, state };
}

function renderReport(state) {
  const changedFiles = Array.isArray(state.changed_files) && state.changed_files.length > 0
    ? state.changed_files.join(', ')
    : '无';
  const evidence = state.evidence || {};

  return [
    `当前目标：${state.current_goal || '未设置'}`,
    `当前步骤：${state.current_step || '未设置'}`,
    `状态：${state.status || 'unknown'}`,
    `最近错误：${state.last_error || '无'}`,
    `变更文件：${changedFiles}`,
    `证据：commit=${evidence.commit || '无'}, build_ok=${evidence.build_ok === true ? 'true' : evidence.build_ok === false ? 'false' : 'unknown'}`,
  ].join('\n');
}

async function acquireReportLock() {
  await ensureOpsDir();
  try {
    const handle = await fs.open(REPORT_LOCK_PATH, 'wx');
    await handle.close();
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

async function releaseReportLock() {
  try {
    await fs.unlink(REPORT_LOCK_PATH);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function hashReport(report) {
  return crypto.createHash('sha1').update(report).digest('hex');
}

async function maybeReport({ thresholdMinutes = 10, emit = console.log } = {}) {
  const lockAcquired = await acquireReportLock();
  if (!lockAcquired) {
    return { skipped: true, reason: 'report lock already held' };
  }

  try {
    const state = await loadState();
    const lastReportAt = state.last_report_at ? new Date(state.last_report_at).getTime() : 0;
    const due = Date.now() - lastReportAt >= thresholdMinutes * 60 * 1000;

    if (!due) {
      return { skipped: true, reason: 'not due', state };
    }

    const report = renderReport(state);
    const reportHash = hashReport(report);

    if (state.last_report_hash && state.last_report_hash === reportHash) {
      await appendEvent({ type: 'report_skipped_duplicate', threshold_minutes: thresholdMinutes, report_hash: reportHash });
      return { skipped: true, reason: 'duplicate', state, report };
    }

    emit(report);
    const next = await updateState({ last_report_at: nowIso(), last_report_hash: reportHash });
    await appendEvent({ type: 'report_sent', threshold_minutes: thresholdMinutes, report_hash: reportHash });
    return { skipped: false, state: next, report };
  } finally {
    await releaseReportLock();
  }
}

module.exports = {
  EVENTS_PATH,
  STATE_PATH,
  appendEvent,
  detectStall,
  loadState,
  maybeReport,
  nowIso,
  hashReport,
  readJson,
  recordFailure,
  recordProgress,
  renderReport,
  saveState,
  updateState,
  writeJson,
};
