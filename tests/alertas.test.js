const test = require('node:test');
const assert = require('node:assert');
const A = require('../backend/Alertas.js');
test('seleccionarAlertas: solo quietos por encima del umbral y sin alerta previa', () => {
  const r = A.seleccionarAlertas([
    { expediente: '1', dias_quieto: 11, alerta_enviada_en: '' },
    { expediente: '2', dias_quieto: 10, alerta_enviada_en: '' },
    { expediente: '3', dias_quieto: 30, alerta_enviada_en: '01/10/2026' },
    { expediente: '4', dias_quieto: '', alerta_enviada_en: '' }
  ], 10);
  assert.deepStrictEqual(r.map(x => x.expediente), ['1']);
});
