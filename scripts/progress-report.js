const crypto = require('crypto');
const { appendEvent, loadState, renderReport, updateState } = require('./progress-lib.js');

function hashReport(report) {
  return crypto.createHash('sha1').update(report).digest('hex');
}

async function main() {
  const state = await loadState();
  const report = renderReport(state);
  const reportHash = hashReport(report);

  if (state.last_report_hash && state.last_report_hash === reportHash) {
    process.stdout.write('NO_REPLY\n');
    await appendEvent({ type: 'report_skipped_duplicate', report_hash: reportHash });
    return;
  }

  process.stdout.write(`${report}\n`);
  await updateState({ last_report_at: new Date().toISOString(), last_report_hash: reportHash });
  await appendEvent({ type: 'report_sent_manual', report_hash: reportHash });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
