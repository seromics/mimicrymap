'use strict';
const engine = require('./engine.cjs');
process.once('message', async ({ action, value }) => {
  try {
    if (
      ![
        'importFasta',
        'buildComparison',
        'exportBundle',
        'prepareMapping',
        'searchRecords',
        'readResult',
        'readComparisonInputs',
        'readInstalledComparisonInputs',
        'readInstalledResult',
        'readRecord',
        'findSaved',
        'validateComparison',
        'hashFile',
        'prepareAnnotations',
        'prepareReferenceTaxonomy',
        'customTracks',
        'refreshAnnotations',
        'exportStudyLibrary',
        'verifyStudyComparison',
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
    const result = await (action==='customTracks'?require('./custom-track-worker.cjs')[action]:action==='prepareReferenceTaxonomy'?require('./reference-taxonomy.cjs')[action]:['exportStudyLibrary','verifyStudyComparison'].includes(action)
      ? require('./study-library.cjs')[action] : engine[action])(value, report);
    process.send?.({ result }, () => process.disconnect());
  } catch (error) {
    process.send?.({ error: error.message }, () => process.disconnect());
  }
});
// Terminating this disposable worker cannot publish a partial comparison.
process.on('disconnect', () => process.exit());
