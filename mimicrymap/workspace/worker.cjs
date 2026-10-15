'use strict';
const engine = require('./engine.cjs');
process.once('message', async ({ action, value }) => {
  try {
    if (
      ![
        'importFasta',
        'buildComparison',
        'prepareMapping',
        'searchRecords',
        'readResult',
        'readInstalledResult',
        'readRecord',
        'findSaved',
        'validateComparison',
        'hashFile',
        'prepareAnnotations',
        'refreshAnnotations',
      ].includes(action)
    )
      throw Error('Unknown Mimicry workspace operation');
    let last = 0, lastPhase;
    const report = (progress) => {
      if ((progress.phase && progress.phase !== lastPhase) || Date.now() - last > 300 ||
          (progress.total != null && progress.done === progress.total)) {
        last = Date.now();
        if (progress.phase) lastPhase = progress.phase;
        process.send?.({ progress });
      }
    };
    const result = await engine[action](value, report);
    process.send?.({ result }, () => process.disconnect());
  } catch (error) {
    process.send?.({ error: error.message }, () => process.disconnect());
  }
});
// Terminating this disposable worker cannot publish a partial comparison.
process.on('disconnect', () => process.exit());
