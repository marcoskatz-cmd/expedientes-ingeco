const test = require('node:test');
const assert = require('node:assert');
const { CFG } = require('../backend/Config.js');
test('config tiene las 7 hojas', () => {
  assert.strictEqual(Object.keys(CFG.HOJAS).length, 7);
});
