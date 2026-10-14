const assert = require('node:assert');
const { describe, it } = require('node:test');
const L = require('../logica');
const cat = [{ nome: 'BORI', valor: 3000, categoria: 'Serviços e trabalhos', tipo: 'receita' }, { nome: 'Yahuaska', valor: 300, categoria: 'Serviços e trabalhos', tipo: 'receita' }, { nome: 'Mercado', valor: 0, categoria: 'Alimentação e insumos', tipo: 'despesa' }];
const H = '2026-10-14';
describe('IA simulada (modo demonstração)', () => {
  it('serviço parcelado com entrada e primeiro vencimento', () => {
    const o = L.interpretarDemo('Fechei um trabalho com a Dona Rita por 1.800 reais em 6 vezes, entrada de 300, primeira em 10 de novembro', cat, H);
    const i = o.itens[0];
    assert.strictEqual(o.intent, 'lancar'); assert.strictEqual(i.tipo, 'receita'); assert.strictEqual(i.pessoa, 'Dona Rita');
    assert.strictEqual(i.valor_total, 1800); assert.strictEqual(i.parcelas, 6); assert.strictEqual(i.entrada, 300); assert.strictEqual(i.primeiro_vencimento, '2026-11-10');
  });
  it('despesa já paga com pix', () => {
    const i = L.interpretarDemo('Comprei 300 reais de velas e ervas hoje no pix', cat, H).itens[0];
    assert.strictEqual(i.tipo, 'despesa'); assert.strictEqual(i.valor_total, 300); assert.strictEqual(i.pago, true); assert.strictEqual(i.forma, 'pix');
  });
  it('"ontem" vira a data de ontem', () => {
    assert.strictEqual(L.interpretarDemo('Paguei o aluguel de 1.800 ontem', cat, H).itens[0].data, '2026-10-13');
  });
  it('produto padrão sem valor usa o preço cadastrado', () => {
    const i = L.interpretarDemo('Yahuaska para a Ana', cat, H).itens[0];
    assert.strictEqual(i.valor_total, 300); assert.strictEqual(i.descricao, 'Yahuaska'); assert.strictEqual(i.pessoa, 'Ana');
  });
  it('"3x de 500" soma 1500', () => {
    assert.strictEqual(L.interpretarDemo('Trabalho do João 3x de 500', cat, H).itens[0].valor_total, 1500);
  });
  it('baixa de parcela por ordinal', () => {
    const o = L.interpretarDemo('A Maria pagou a segunda parcela do bori', cat, H);
    assert.strictEqual(o.intent, 'baixa'); assert.strictEqual(o.baixa.parcela_numero, 2); assert.strictEqual(o.baixa.pessoa, 'Maria'); assert.strictEqual(o.baixa.descricao, 'BORI');
  });
  it('baixa por número e valor', () => {
    const o = L.interpretarDemo('Recebi a parcela 3 do João, 430 reais', cat, H);
    assert.strictEqual(o.baixa.parcela_numero, 3); assert.strictEqual(o.baixa.valor, 430);
  });
  it('foto e áudio devolvem exemplos e sempre avisam que é simulação', () => {
    assert.strictEqual(L.interpretarDemo('', cat, H, 'imagem').itens[0].valor_total, 187.4);
    assert.strictEqual(L.interpretarDemo('', cat, H, 'audio').intent, 'baixa');
    assert.ok(L.interpretarDemo('x 10', cat, H).mensagem.includes('Simulação'));
  });
});
