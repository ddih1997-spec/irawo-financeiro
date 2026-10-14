const assert = require('node:assert');
const { describe, it } = require('node:test');
const L = require('../logica');

const mk = () => L.expandir({ tipo: 'receita', descricao: 'Bori', pessoa: 'Ana', categoria: 'Serviços e trabalhos', valor_total: 1290, parcelas: 3, primeiro_vencimento: '2026-11-10', data: '2026-10-13', grupo_id: 'g1' }, '2026-10-13')
  .map((r, i) => ({ ...r, id: 'p' + (i + 1) }));

describe('baixa com valor diferente', () => {
  it('quitar: parcela de 430 paga com 500 fica 500 e as outras não mudam', () => {
    const rows = mk();
    const pl = L.planejarBaixa(rows, 'p1', { valor: 500, data: '2026-10-20', modo: 'quitar' });
    assert.strictEqual(pl.atualizar.length, 1);
    assert.strictEqual(pl.atualizar[0].valor, 500);
    assert.strictEqual(pl.atualizar[0].status, 'pago');
    assert.strictEqual(pl.diferenca, -70);
  });
  it('ajustar: pagou 70 a mais, as duas próximas caem 35 cada e o total se mantém', () => {
    const rows = mk();
    const pl = L.planejarBaixa(rows, 'p1', { valor: 500, data: '2026-10-20', modo: 'ajustar' });
    const novo = {}; pl.atualizar.forEach(u => { novo[u.id] = u.valor; });
    assert.strictEqual(novo.p2, 395); assert.strictEqual(novo.p3, 395);
    assert.strictEqual(Math.round((novo.p1 + novo.p2 + novo.p3) * 100), 129000);
  });
  it('ajustar com centavos que não dividem: o resto vai na última', () => {
    const rows = mk();
    const pl = L.planejarBaixa(rows, 'p1', { valor: 429.99, modo: 'ajustar' }); // faltou 0,01
    const novo = {}; pl.atualizar.forEach(u => { novo[u.id] = u.valor; });
    assert.strictEqual(Math.round((novo.p1 + novo.p2 + novo.p3) * 100), 129000);
  });
  it('parcial: pagou 300 de 430, cria uma parcela de 130 pendente no mesmo serviço', () => {
    const rows = mk();
    const pl = L.planejarBaixa(rows, 'p1', { valor: 300, modo: 'parcial' });
    assert.strictEqual(pl.adicionar.length, 1);
    assert.strictEqual(pl.adicionar[0].valor, 130);
    assert.strictEqual(pl.adicionar[0].status, 'pendente');
    assert.strictEqual(pl.adicionar[0].grupo_id, 'g1');
  });
  it('ajustar na última parcela (sem próximas) vira só quitar', () => {
    const rows = mk();
    const pl = L.planejarBaixa(rows, 'p3', { valor: 500, modo: 'ajustar' });
    assert.strictEqual(pl.atualizar.length, 1);
  });
  it('ajustar nunca deixa parcela negativa', () => {
    const rows = mk();
    const pl = L.planejarBaixa(rows, 'p1', { valor: 2000, modo: 'ajustar' });
    pl.atualizar.slice(1).forEach(u => assert.ok(u.valor >= 0));
  });
});

describe('prompt com produtos padrão', () => {
  it('inclui os produtos e valores', () => {
    const p = L.montarPrompt('2026-10-13', 'bori para a Maria', [{ nome: 'BORI', valor: 3000 }, { nome: 'EBÓ', valor: 800 }]);
    assert.ok(p.includes('BORI = 3000') && p.includes('EBÓ = 800'));
  });
  it('sem catálogo não quebra', () => {
    assert.ok(L.montarPrompt('2026-10-13', '').includes('Hoje é'));
  });
});

describe('desfazer baixa', () => {
  const aplica = (rows, pl) => {
    const m = new Map(rows.map(r => [String(r.id), { ...r }]));
    pl.atualizar.forEach(u => Object.assign(m.get(String(u.id)), u));
    (pl.excluir || []).forEach(i => m.delete(String(i)));
    (pl.adicionar || []).forEach((a, k) => m.set('n' + k, { ...a, id: 'n' + k }));
    return [...m.values()];
  };
  const soma = rows => Math.round(rows.reduce((a, r) => a + r.valor * 100, 0));

  it('quitar com valor diferente: desfazer devolve o valor previsto', () => {
    let rows = mk();
    rows = aplica(rows, L.planejarBaixa(rows, 'p1', { valor: 500, data: '2026-10-20', modo: 'quitar' }));
    assert.strictEqual(rows.find(r => r.id === 'p1').valor, 500);
    rows = aplica(rows, L.planejarDesfazer(rows, 'p1'));
    const p1 = rows.find(r => r.id === 'p1');
    assert.strictEqual(p1.valor, 430); assert.strictEqual(p1.status, 'pendente'); assert.ok(!String(p1.obs).includes('prev='));
  });
  it('ajustar: desfazer restaura as próximas parcelas e o total', () => {
    let rows = mk();
    const antes = soma(rows);
    rows = aplica(rows, L.planejarBaixa(rows, 'p1', { valor: 500, modo: 'ajustar' }));
    rows = aplica(rows, L.planejarDesfazer(rows, 'p1'));
    assert.strictEqual(soma(rows), antes);
    assert.deepStrictEqual(rows.map(r => r.valor), [430, 430, 430]);
  });
  it('parcial: desfazer remove o restante e volta a uma parcela só', () => {
    let rows = mk();
    rows = aplica(rows, L.planejarBaixa(rows, 'p1', { valor: 300, modo: 'parcial' }));
    assert.strictEqual(rows.length, 4);
    rows = aplica(rows, L.planejarDesfazer(rows, 'p1'));
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows.find(r => r.id === 'p1').valor, 430);
  });
  it('baixa normal (sem diferença) desfaz só o status', () => {
    let rows = mk();
    rows = aplica(rows, L.planejarBaixa(rows, 'p2', { valor: 430, modo: 'quitar' }));
    rows = aplica(rows, L.planejarDesfazer(rows, 'p2'));
    assert.strictEqual(rows.find(r => r.id === 'p2').status, 'pendente');
    assert.strictEqual(rows.find(r => r.id === 'p2').valor, 430);
  });
});

describe('prompt com despesas padrão', () => {
  const cat = [{ nome: 'BORI', valor: 3000, categoria: 'Serviços e trabalhos', tipo: 'receita' },
    { nome: 'Mercado', valor: 0, categoria: 'Alimentação e insumos', tipo: 'despesa' },
    { nome: 'Luz', valor: 150, categoria: 'Aluguel e contas', tipo: 'despesa' }];
  it('lista receitas e despesas separadas', () => {
    const p = L.montarPrompt('2026-10-14', 'comprei no mercado', cat);
    assert.ok(p.includes('BORI = 3000'));
    assert.ok(p.includes('Mercado [Alimentação e insumos]'));
    assert.ok(p.includes('Luz [Aluguel e contas] = 150'));
    assert.ok(!p.includes('Mercado = '));
  });
});
