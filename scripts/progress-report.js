const { appendEvent, loadState, renderReport, updateState } = require('./progress-lib.js');

async function main() {
  const state = await loadState();
  const report = renderReport(state);
  process.stdout.write(`${report}\n`);
  await updateState({ last_report_at: new Date().toISOString() });
  await appendEvent({ type: 'report_sent_manual' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
