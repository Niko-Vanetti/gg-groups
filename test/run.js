// Arranque de las pruebas: node test/run.js
const results = [];
global.test = (name, fn) => results.push({ name, fn });

require('./logic.test.js');
require('./ui.test.js');

(async () => {
  let failed = 0;
  for (const { name, fn } of results) {
    try {
      await fn();
      console.log('  ok   ' + name);
    } catch (e) {
      failed++;
      console.log('  FALLA ' + name + '\n         ' + (e && e.message));
    }
  }
  console.log(`\n${results.length - failed}/${results.length} pruebas pasan`);
  process.exit(failed ? 1 : 0);
})();
