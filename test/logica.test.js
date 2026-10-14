const assert = require('node:assert');
const { describe, it } = require('node:test');
const logica = require('../logica');

describe('logica.js', () => {
  const fixedToday = '2027-02-28';
  const fixedTodayObj = new Date(fixedToday);

  // Helper to clone object
  const clone = obj => JSON.parse(JSON.stringify(obj));

  describe('expandir', () => {
    it('should split 3x of 100 into cents summing exactly total', () => {
      const it = {
        valor_total: 100,
        parcelas: 3,
        entrada: 0,
        pago: false,
        tipo: 'receita',
        descricao: 'Test',
      };
      const linhas = logica.expandir(it, fixedToday);
      assert.strictEqual(linhas.length, 3);
      const sumCents = linhas.reduce((acc, l) => acc + Math.round(l.valor * 100), 0);
      assert.strictEqual(sumCents, 100 * 100); // total in cents
      // Expect distribution like 33.33,33.33,33.34
      const values = linhas.map(l => l.valor).sort();
      // Approximate check
      assert.ok(Math.abs(values[0] - 33.33) < 0.01);
      assert.ok(Math.abs(values[1] - 33.33) < 0.01);
      assert.ok(Math.abs(values[2] - 33.34) < 0.01);
    });

    it('should create 1 paid entry line + 5 pending installments summing to total', () => {
      const it = {
        valor_total: 3000,
        parcelas: 5,
        entrada: 500,
        pago: false, // entrada paid? According to logic, entrada is always marked paid
        tipo: 'receita',
        descricao: 'Test',
      };
      const linhas = logica.expandir(it, fixedToday);
      // Expect 1 entrada + 5 parcelas = 6 lines
      assert.strictEqual(linhas.length, 6);
      const paid = linhas.filter(l => l.status === 'pago');
      const pending = linhas.filter(l => l.status === 'pendente');
      assert.strictEqual(paid.length, 1);
      assert.strictEqual(pending.length, 5);
      assert.strictEqual(paid[0].valor, 500);
      assert.strictEqual(paid[0].data_pagamento, fixedToday);
      const sumPaid = paid[0].valor;
      assert.strictEqual(sumPaid, 500);
      const totalSum = linhas.reduce((acc, l) => acc + l.valor, 0);
      assert.strictEqual(totalSum, 3000);
    });

    it('should clamp end-of-month dates', () => {
      // Test addMeses directly maybe, but we can test via expandir with primeiro_vencimento
      const it = {
        valor_total: 100,
        parcelas: 2,
        entrada: 0,
        primeiro_vencimento: '2027-01-31', // Jan 31 2027 (not leap year)
        tipo: 'receita',
        descricao: 'Test',
      };
      const linhas = logica.expandir(it, fixedToday);
      assert.strictEqual(linhas.length, 2);
      // First vencimento as given
      assert.strictEqual(linhas[0].vencimento, '2027-01-31');
      // Second vencimento should be 2027-02-28 (clamped)
      assert.strictEqual(linhas[1].vencimento, '2027-02-28');
      // Test leap year: 2028-01-31 + 1 month => 2028-02-29
      const it2 = {...it, primeiro_vencimento: '2028-01-31'};
      const linhas2 = logica.expandir(it2, fixedToday);
      assert.strictEqual(linhas2[1].vencimento, '2028-02-29');
    });

    it('should set single paid launch with status pago and data_pagamento', () => {
      const it = {
        valor_total: 150,
        parcelas: 1,
        entrada: 0,
        pago: true,
        tipo: 'receita',
        descricao: 'Test',
        data: fixedToday,
      };
      const linhas = logica.expandir(it, fixedToday);
      assert.strictEqual(linhas.length, 1);
      assert.strictEqual(linhas[0].status, 'pago');
      assert.strictEqual(linhas[0].data_pagamento, fixedToday);
      assert.strictEqual(linhas[0].valor, 150);
    });
  });

  describe('resumo', () => {
    it('should count recebido/gasto only status pago by month of data_pagamento', () => {
      const rows = [
        {tipo: 'receita', valor: 100, status: 'pago', data_pagamento: '2027-02-10'},
        {tipo: 'receita', valor: 50, status: 'pendente', data_pagamento: ''},
        {tipo: 'receita', valor: 30, status: 'pago', data_pagamento: '2027-01-20'},
        {tipo: 'despesa', valor: 40, status: 'pago', data_pagamento: '2027-02-15'},
        {tipo: 'despesa', valor: 20, status: 'pendente', data_pagamento: ''},
      ];
      const ym = '2027-02';
      const res = logica.resumo(rows, ym, fixedToday);
      // recebido: only receita paid in Feb 2027 => 100
      assert.strictEqual(res.recebido, 100);
      // gasto: only despesa paid in Feb 2027 => 40
      assert.strictEqual(res.gasto, 40);
      // aReceber: sum of pending receita => 50
      assert.strictEqual(res.aReceber, 50);
    });

    it('should consider vencido when vencimento < hoje', () => {
      const rows = [
        {tipo: 'receita', valor: 30, status: 'pendente', vencimento: '2027-02-20'}, // before today 2027-02-28
        {tipo: 'receita', valor: 40, status: 'pendente', vencimento: '2027-03-01'}, // after today
      ];
      const ym = '2027-02';
      const res = logica.resumo(rows, ym, fixedToday);
      // vencidoReceber should sum those with vencimento < hoje
      assert.strictEqual(res.vencidoReceber, 30);
    });
  });

  describe('agruparServicos', () => {
    it('should compute pct, falta, quitado and order by next parcel', () => {
      const rows = [
        // Group 1: two installments, first paid, second pending
        {grupo_id: 'g1', tipo: 'receita', valor: 100, status: 'pago', parcela: 1, total_parcelas: 2, vencimento: '2027-02-01', descricao: 'Servico A', pessoa: 'Joao'},
        {grupo_id: 'g1', tipo: 'receita', valor: 100, status: 'pendente', parcela: 2, total_parcelas: 2, vencimento: '2027-03-01', descricao: 'Servico A', pessoa: 'Joao'},
        // Group 2: one installment pending
        {grupo_id: 'g2', tipo: 'receita', valor: 200, status: 'pendente', parcela: 1, total_parcelas: 1, vencimento: '2027-02-15', descricao: 'Servico B', pessoa: 'Maria'},
        // Group 3: both paid (quitado)
        {grupo_id: 'g3', tipo: 'receita', valor: 150, status: 'pago', parcela: 1, total_parcelas: 1, vencimento: '2027-01-01', descricao: 'Servico C', pessoa: 'Pedro'},
        {grupo_id: 'g3', tipo: 'receita', valor: 150, status: 'pago', parcela: 2, total_parcelas: 2, vencimento: '2027-02-01', descricao: 'Servico C', pessoa: 'Pedro'},
      ];
      const grupos = logica.agruparServicos(rows, 'receita', fixedToday, false); // incluirQuitados false => exclude quitados
      // Expect groups g1 and g2 only
      assert.strictEqual(grupos.length, 2);
      // Find g1 and g2
      const g1 = grupos.find(g => g.gid === 'g1');
      const g2 = grupos.find(g => g.gid === 'g2');
      assert.ok(g1);
      assert.ok(g2);
      // g1 total 200, paid 100, falta 100, pct 50, quitado false
      assert.strictEqual(g1.total, 200);
      assert.strictEqual(g1.pago, 100);
      assert.strictEqual(g1.falta, 100);
      assert.strictEqual(g1.pct, 50);
      assert.strictEqual(g1.quitado, false);
      // next parcel date should be 2027-03-01 (the pending)
      assert.strictEqual(g1.proxima, '2027-03-01');
      // g2 total 200, paid 0, falta 200, pct 0
      assert.strictEqual(g2.total, 200);
      assert.strictEqual(g2.pago, 0);
      assert.strictEqual(g2.falta, 200);
      assert.strictEqual(g2.pct, 0);
      assert.strictEqual(g2.quitado, false);
      assert.strictEqual(g2.proxima, '2027-02-15');
      // Order by next parcel: g2 (2027-02-15) before g1 (2027-03-01)
      assert.strictEqual(grupos[0].gid, 'g2');
      assert.strictEqual(grupos[1].gid, 'g1');
    });
  });

  describe('buscarBaixa', () => {
    it('should find the correct installment by person name ignoring accents and case', () => {
      const rows = [
        {tipo: 'receita', valor: 100, status: 'pendente', pessoa: 'João Silva', descricao: 'Aluguel', vencimento: '2027-03-01', parcela: 1},
        {tipo: 'receita', valor: 150, status: 'pendente', pessoa: 'Maria Oliveira', descricao: 'Conta de Luz', vencimento: '2027-03-05', parcela: 2},
        {tipo: 'receita', valor: 200, status: 'pendente', pessoa: 'joao silva', descricao: 'Aluguel', vencimento: '2027-04-01', parcela: 2},
      ];
      const busca = {pessoa: 'JOAO SILVA', descricao: 'aluguel'};
      const resultados = logica.buscarBaixa(rows, busca, fixedToday);
      // Should match both João Silva and joao silva (case/accent insensitive)
      // Expect at least one result; the algorithm scores based on tokens.
      assert.ok(resultados.length > 0);
      // The normalized person name (without accents, lowercase) should be 'joao silva'
      const pessoaNorm = resultados[0].pessoa.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      assert.strictEqual(pessoaNorm, 'joao silva');
    });
  });

  describe('extrairJSON', () => {
    it('should accept text with markdown code fences', () => {
      const texto = `Aqui está o JSON:
      {"intent":"lancar","mensagem":"teste","itens":[]}
      `;
      const obj = logica.extrairJSON(texto);
      assert.deepStrictEqual(obj, {intent: 'lancar', mensagem: 'teste', itens: []});
      // With fences
      const texto2 = '```json\n{"intent":"baixa","mensagem":"pago","baixa":{}}\n```';
      const obj2 = logica.extrairJSON(texto2);
      assert.deepStrictEqual(obj2, {intent: 'baixa', mensagem: 'pago', baixa: {}});
    });
  });
});
