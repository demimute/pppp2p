const {
  appendEvent,
  detectStall,
  loadState,
  maybeReport,
} = require('./progress-lib.js');

async function main() {
  const thresholdMinutes = Number(process.argv[2] || 10);

  const stallResult = await detectStall(thresholdMinutes);
  const reportResult = await maybeReport({
    thresholdMinutes,
    emit: (message) => {
      process.stdout.write(`${message}\n`);
    },
  });

  const state = await loadState();
  await appendEvent({
    type: 'watchdog_checked',
    threshold_minutes: thresholdMinutes,
    stalled: stallResult.stalled,
    report_sent: !reportResult.skipped,
  });

  process.stdout.write(`${JSON.stringify({
    stalled: stallResult.stalled,
    reported: !reportResult.skipped,
    status: state.status,
  })}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
