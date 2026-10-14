const assert = require('node:assert');
const { describe, it } = require('node:test');
const L = require('../logica');

describe('regressões', () => {
  it('entrada maior que o total vira um único lançamento pago (sem parcelas zeradas)', () => {
    const r = L.expandir({ tipo: 'receita', valor_total: 1500, entrada: 2000, parcelas: 3, data: '2026-10-13' }, '2026-10-13');
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].status, 'pago');
    assert.strictEqual(r[0].valor, 1500);
  });
  const rows = [
    { id: '1', tipo: 'receita', status: 'pendente', pessoa: 'Maria Souza', descricao: 'Trabalho', categoria: 'x', valor: 500, parcela: 2, vencimento: '2026-11-01' },
    { id: '2', tipo: 'receita', status: 'pendente', pessoa: 'João Lima', descricao: 'Curso', categoria: 'x', valor: 100, parcela: 5, vencimento: '2026-11-01' },
  ];
  it('número da parcela sozinho não basta se há nome informado', () => {
    const ids = L.buscarBaixa(rows, { tipo: 'receita', pessoa: 'maria', parcela_numero: 5 }).map(r => r.id);
    assert.deepStrictEqual(ids, ['1']);
  });
  it('acha pelo nome sem acento', () => {
    assert.deepStrictEqual(L.buscarBaixa(rows, { tipo: 'receita', pessoa: 'JOAO' }).map(r => r.id), ['2']);
  });
  it('sem nenhuma pista, lista as pendentes para o usuário escolher', () => {
    assert.strictEqual(L.buscarBaixa(rows, { tipo: 'receita' }).length, 2);
  });
  it('centavos: 3x de 100 soma exatamente 100', () => {
    const r = L.expandir({ tipo: 'despesa', valor_total: 100, parcelas: 3, data: '2026-10-13' }, '2026-10-13');
    assert.strictEqual(Math.round(r.reduce((a, x) => a + x.valor * 100, 0)), 10000);
  });
});
