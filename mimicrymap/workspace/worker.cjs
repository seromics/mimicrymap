'use strict';
const engine = require('./engine.cjs');
process.once('message', async ({ action, value }) => {
  try {
    if (
      ![
        'importFasta',
        'buildComparison',
        'buildSummaryIndexes',
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
    let last = 0;
    const report = (progress) => {
      if (Date.now() - last > 300 || progress.done === progress.total) {
        last = Date.now();
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
