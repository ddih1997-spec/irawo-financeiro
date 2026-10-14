/* IRAWÒ — lógica pura (sem DOM). Funciona no navegador (window.L) e no Node (require). */
(function (raiz) {
  'use strict';

  const CATEGORIAS = {
    receita: ['Serviços e trabalhos', 'Mensalidade / contribuição', 'Festas e eventos', 'Cursos e oficinas',
      'Venda de produtos', 'Doações', 'Outras receitas'],
    despesa: ['Materiais e oferendas', 'Alimentação e insumos', 'Aluguel e contas', 'Equipe e colaboradores',
      'Manutenção e obras', 'Divulgação', 'Impostos e taxas', 'Transporte', 'Outras despesas'],
  };

  const pad = n => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const parse = s => { const [y, m, d] = String(s).split('-').map(Number); return { y, m, d }; };
  const valida = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const hojeDe = (dt = new Date()) => ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  const mesDe = s => String(s || '').slice(0, 7);
  const fmtBR = s => { if (!valida(s)) return ''; const { y, m, d } = parse(s); return `${pad(d)}/${pad(m)}/${y}`; };
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const rotuloMes = ym => { const [y, m] = ym.split('-').map(Number); return `${MESES[m - 1]} de ${y}`; };
  const rotuloMesCurto = ym => { const [y, m] = ym.split('-').map(Number); return `${MESES[m - 1].slice(0, 3)}/${String(y).slice(2)}`; };

  function addMeses(s, k) {
    const { y, m, d } = parse(s);
    const t = y * 12 + (m - 1) + k;
    const ny = Math.floor(t / 12), nm = t % 12 + 1;
    const ultimo = new Date(ny, nm, 0).getDate();
    return ymd(ny, nm, Math.min(d, ultimo));
  }
  const addMesYM = (ym, k) => addMeses(ym + '-01', k).slice(0, 7);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const cent = v => Math.round((Number(v) || 0) * 100);

  /** Converte um "plano" (item da IA ou do formulário) em linhas de lançamento/parcelas. */
  function expandir(it, hoje) {
    const hj = hoje || hojeDe();
    const total = cent(it.valor_total);
    const n = Math.max(1, parseInt(it.parcelas, 10) || 1);
    const data = valida(it.data) ? it.data : hj;
    const venc1 = valida(it.primeiro_vencimento) ? it.primeiro_vencimento : data;
    const entrada = Math.min(cent(it.entrada), total);
    const gid = it.grupo_id || uid();
    const base = {
      grupo_id: gid, tipo: it.tipo === 'despesa' ? 'despesa' : 'receita', descricao: it.descricao || '',
      pessoa: it.pessoa || '', categoria: it.categoria || '', forma: it.forma || '', obs: it.obs || '',
    };
    const linhas = [];
    if (n === 1 && !entrada) {
      const pago = !!it.pago;
      linhas.push(Object.assign({}, base, {
        valor: total / 100, vencimento: pago ? data : venc1, status: pago ? 'pago' : 'pendente',
        data_pagamento: pago ? data : '', parcela: 1, total_parcelas: 1,
      }));
      return linhas;
    }
    const resto = total - entrada;
    if (resto <= 0) {   // entrada cobre tudo: vira um lançamento único já pago
      return [Object.assign({}, base, { valor: total / 100, vencimento: data, status: 'pago', data_pagamento: data, parcela: 1, total_parcelas: 1 })];
    }
    const cota = Math.floor(resto / n);
    const tp = n + (entrada ? 1 : 0);
    let idx = 1;
    if (entrada) {
      linhas.push(Object.assign({}, base, {
        valor: entrada / 100, vencimento: data, status: 'pago', data_pagamento: data, parcela: idx++, total_parcelas: tp,
      }));
    }
    for (let i = 0; i < n; i++) {
      const v = i === n - 1 ? resto - cota * (n - 1) : cota;
      linhas.push(Object.assign({}, base, {
        valor: v / 100, vencimento: addMeses(venc1, i), status: 'pendente', data_pagamento: '',
        parcela: idx++, total_parcelas: tp,
      }));
    }
    return linhas;
  }

  const soma = (rows, f) => rows.reduce((a, r) => a + (f(r) ? cent(r.valor) : 0), 0) / 100;
  const pendente = r => r.status === 'pendente';
  const pagoNoMes = (r, ym) => r.status === 'pago' && mesDe(r.data_pagamento) === ym;

  function resumo(rows, ym, hoje) {
    const hj = hoje || hojeDe();
    const em7 = (() => { const { y, m, d } = parse(hj); const dt = new Date(y, m - 1, d + 7); return hojeDe(dt); })();
    const recebido = soma(rows, r => r.tipo === 'receita' && pagoNoMes(r, ym));
    const gasto = soma(rows, r => r.tipo === 'despesa' && pagoNoMes(r, ym));
    const porCategoria = {};
    rows.filter(r => r.tipo === 'despesa' && pagoNoMes(r, ym)).forEach(r => {
      const c = r.categoria || 'Sem categoria';
      porCategoria[c] = (porCategoria[c] || 0) + cent(r.valor);
    });
    Object.keys(porCategoria).forEach(k => { porCategoria[k] /= 100; });
    const receitaPorCategoria = {};
    rows.filter(r => r.tipo === 'receita' && pagoNoMes(r, ym)).forEach(r => {
      const c = r.categoria || 'Sem categoria';
      receitaPorCategoria[c] = (receitaPorCategoria[c] || 0) + cent(r.valor);
    });
    Object.keys(receitaPorCategoria).forEach(k => { receitaPorCategoria[k] /= 100; });
    return {
      recebido, gasto, saldo: Math.round((recebido - gasto) * 100) / 100, porCategoria, receitaPorCategoria,
      aReceber: soma(rows, r => r.tipo === 'receita' && pendente(r)),
      aPagar: soma(rows, r => r.tipo === 'despesa' && pendente(r)),
      vencidoReceber: soma(rows, r => r.tipo === 'receita' && pendente(r) && r.vencimento < hj),
      vencidoPagar: soma(rows, r => r.tipo === 'despesa' && pendente(r) && r.vencimento < hj),
      proximos7Receber: soma(rows, r => r.tipo === 'receita' && pendente(r) && r.vencimento >= hj && r.vencimento <= em7),
      proximos7Pagar: soma(rows, r => r.tipo === 'despesa' && pendente(r) && r.vencimento >= hj && r.vencimento <= em7),
      mesAReceber: soma(rows, r => r.tipo === 'receita' && pendente(r) && mesDe(r.vencimento) === ym),
    };
  }

  /** Últimos n meses (terminando em ymFim): recebido x gasto. */
  function serieMeses(rows, ymFim, n) {
    const meses = [];
    for (let i = n - 1; i >= 0; i--) meses.push(addMesYM(ymFim, -i));
    return {
      meses,
      recebido: meses.map(m => soma(rows, r => r.tipo === 'receita' && pagoNoMes(r, m))),
      gasto: meses.map(m => soma(rows, r => r.tipo === 'despesa' && pagoNoMes(r, m))),
    };
  }

  /** Previsão de recebimentos pendentes nos próximos n meses (atrasados entram no mês atual). */
  function previsao(rows, ymIni, n) {
    const meses = [];
    for (let i = 0; i < n; i++) meses.push(addMesYM(ymIni, i));
    const atrasado = soma(rows, r => r.tipo === 'receita' && pendente(r) && mesDe(r.vencimento) < ymIni);
    return {
      meses, atrasado,
      valores: meses.map(m => soma(rows, r => r.tipo === 'receita' && pendente(r) && mesDe(r.vencimento) === m)),
    };
  }

  /** Agrupa parcelas por serviço (grupo_id) para a tela "A receber / A pagar". */
  function agruparServicos(rows, tipo, hoje, incluirQuitados) {
    const hj = hoje || hojeDe();
    const mapa = {};
    rows.filter(r => r.tipo === tipo).forEach(r => { (mapa[r.grupo_id || r.id] = mapa[r.grupo_id || r.id] || []).push(r); });
    const grupos = Object.keys(mapa).map(gid => {
      const parcelas = mapa[gid].slice().sort((a, b) => (a.parcela - b.parcela) || String(a.vencimento).localeCompare(String(b.vencimento)));
      const total = soma(parcelas, () => true);
      const pago = soma(parcelas, r => r.status === 'pago');
      const pend = parcelas.filter(pendente);
      const proxima = pend.map(p => p.vencimento).sort()[0] || '';
      return {
        gid, parcelas, total, pago, falta: Math.round((total - pago) * 100) / 100,
        descricao: parcelas[0].descricao, pessoa: parcelas[0].pessoa, categoria: parcelas[0].categoria,
        proxima, vencido: !!proxima && proxima < hj, quitado: pend.length === 0,
        pct: total ? Math.round((pago / total) * 100) : 100,
      };
    });
    return grupos
      .filter(g => incluirQuitados || !g.quitado)
      .sort((a, b) => (a.quitado - b.quitado) || String(a.proxima || '9').localeCompare(String(b.proxima || '9')));
  }

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  /** Sugere parcelas pendentes que combinam com o pedido de baixa ditado/enviado. */
  function buscarBaixa(rows, busca, hoje) {
    const tipo = busca && busca.tipo === 'despesa' ? 'despesa' : 'receita';
    const termos = norm(`${busca.pessoa || ''} ${busca.descricao || ''}`).split(/\s+/).filter(t => t.length > 2);
    const temPista = termos.length > 0 || !!busca.valor;
    const cand = rows.filter(r => r.tipo === tipo && pendente(r)).map(r => {
      const alvo = norm(`${r.pessoa} ${r.descricao} ${r.categoria}`);
      let pts = termos.reduce((a, t) => a + (alvo.includes(t) ? 2 : 0), 0);
      if (busca.valor && Math.abs(cent(busca.valor) - cent(r.valor)) <= 1) pts += 3;
      // o número da parcela só desempata: sozinho não basta para sugerir
      if (pts > 0 && busca.parcela_numero && Number(busca.parcela_numero) === Number(r.parcela)) pts += 2;
      return { r, pts };
    }).filter(x => x.pts > 0 || !temPista);
    cand.sort((a, b) => (b.pts - a.pts) || String(a.r.vencimento).localeCompare(String(b.r.vencimento)));
    return cand.slice(0, 5).map(x => x.r);
  }

  function extrairJSON(texto) {
    const t = String(texto || '').replace(/```json|```/g, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('A IA não devolveu um JSON válido.');
    return JSON.parse(t.slice(a, b + 1));
  }

  const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  function montarPrompt(hoje, textoExtra) {
    const { y, m, d } = parse(hoje);
    const dia = DIAS[new Date(y, m - 1, d).getDay()];
    return `Você é o assistente financeiro da casa de axé IRAWÒ. Hoje é ${dia}, ${hoje}.
Interprete o conteúdo enviado (áudio, imagem, vídeo e/ou texto) e responda SOMENTE com um JSON, sem explicações:
{"intent":"lancar"|"baixa"|"desconhecido","mensagem":"frase curta em português","itens":[...],"baixa":{...}}

intent "lancar" -> "itens" é uma lista; cada item:
{"tipo":"receita"|"despesa","descricao":"curta","pessoa":"cliente ou fornecedor, ou vazio","categoria":"UMA da lista","valor_total":número,"parcelas":inteiro>=1,"primeiro_vencimento":"AAAA-MM-DD","entrada":número ou null,"pago":true|false,"data":"AAAA-MM-DD","forma":"pix|dinheiro|cartão|transferência|boleto|"}
Categorias de receita: ${CATEGORIAS.receita.join(' | ')}
Categorias de despesa: ${CATEGORIAS.despesa.join(' | ')}

intent "baixa" (alguém pagou/recebemos uma parcela que já estava combinada) -> "baixa":
{"tipo":"receita"|"despesa","pessoa":"","descricao":"","parcela_numero":inteiro ou null,"valor":número ou null,"data_pagamento":"AAAA-MM-DD"}

Regras:
- Valores em reais, número com ponto decimal ("mil e quinhentos" = 1500; "dois e cinquenta" = 2.5).
- Já aconteceu (recebi, paguei, comprei): pago=true e "data" = dia em que ocorreu (ontem, sexta etc. calculado a partir de hoje). Ainda vai acontecer: pago=false e "primeiro_vencimento" = vencimento.
- Parcelado: "parcelas" = número de parcelas e "valor_total" = valor total ("3x de 500" => valor_total 1500, parcelas 3). Se disser entrada, coloque "entrada" (paga na "data") e as parcelas dividem o restante. Em parcelado sem entrada, pago=false.
- Nota fiscal, cupom ou comprovante: despesa já paga; pessoa = estabelecimento; data = data do documento; valor_total = total pago.
- Sem ano, use o ano de hoje. Sem data de pagamento dita, use hoje.
- Se não der para saber o valor, devolva itens=[] e peça a informação em "mensagem".
- Vários lançamentos na mesma fala/imagem: vários itens.
${textoExtra ? 'Texto do usuário: ' + textoExtra : ''}`;
  }

  const api = {
    CATEGORIAS, pad, ymd, parse, valida, hojeDe, mesDe, fmtBR, rotuloMes, rotuloMesCurto, addMeses, addMesYM, uid, cent,
    expandir, resumo, serieMeses, previsao, agruparServicos, norm, buscarBaixa, extrairJSON, montarPrompt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.L = api;
})(typeof window !== 'undefined' ? window : globalThis);
