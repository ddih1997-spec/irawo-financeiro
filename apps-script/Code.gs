/**
 * IRAWÒ — backend do controle financeiro (Google Apps Script).
 * A planilha é o banco de dados. Rode `iniciar()` uma vez; depois publique como Web App.
 * Segredos (TOKEN e OPENROUTER_KEY) ficam em Propriedades do script, nunca no código.
 */
const ABA = 'Lancamentos';
const CAB = ['id', 'grupo_id', 'tipo', 'descricao', 'pessoa', 'categoria', 'valor', 'vencimento',
  'status', 'data_pagamento', 'parcela', 'total_parcelas', 'forma', 'obs', 'criado_em'];
// datas ficam como texto puro (não viram Date); campos livres são gravados como texto literal
// (rich text não interpreta "=" como fórmula, ex.: "=IMPORTRANGE(...)" vindo de uma foto)
const COLUNAS_TEXTO = ['vencimento', 'data_pagamento', 'criado_em'];
const TEXTOS = ['descricao', 'pessoa', 'categoria', 'forma', 'obs'];
// a chave pode ter qualquer um destes nomes nas Propriedades do script
function chaveIA_(props) { return props.getProperty('OPENROUTER_KEY') || props.getProperty('OPENROUTER_API_KEY'); }
const MODELO_PADRAO = 'google/gemini-2.5-flash';
// endereço da implantação publicada (getUrl() no editor devolve /dev, que só funciona para o dono)
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbyIuCJxfN9QW-I-kJFKF_KpkLsYg-KTYOxwZVuaFMTy0ezbv7JF2G2-bEex4wjY0F6r/exec';
const APP_URL = 'https://ddih1997-spec.github.io/irawo-financeiro/';

/** Rode uma vez no editor: cria as abas, o resumo e gera o TOKEN de acesso. */
function iniciar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ABA);
  if (!sh) sh = ss.insertSheet(ABA, 0);
  sh.getRange(1, 1, 1, CAB.length).setValues([CAB])
    .setFontWeight('bold').setBackground('#2a1f4a').setFontColor('#f2b84b');
  sh.setFrozenRows(1);
  const linhas = Math.max(sh.getMaxRows() - 1, 1);
  COLUNAS_TEXTO.forEach(c => sh.getRange(2, CAB.indexOf(c) + 1, linhas, 1).setNumberFormat('@'));
  sh.getRange(2, CAB.indexOf('valor') + 1, linhas, 1).setNumberFormat('R$ #,##0.00');
  sh.autoResizeColumns(1, CAB.length);
  montarResumo_(ss);

  ss.getSheets().forEach(s => {
    if (s.getName() !== ABA && s.getName() !== 'Resumo' && s.getLastRow() === 0 && s.getLastColumn() === 0 && ss.getSheets().length > 2) ss.deleteSheet(s);
  });

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) {
    props.setProperty('TOKEN', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  }
  console.log('TOKEN=' + props.getProperty('TOKEN'));
  return 'Pronto. Copie o TOKEN do log de execução.';
}

/** Fórmulas via setFormula usam o separador de argumentos do idioma da planilha (pt-BR: ";"). */
function fx_(formula) {
  const loc = String(SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetLocale() || '');
  const virgula = /^(en|ja|zh|ko|he|th|hi)/i.test(loc) || /^(es_(MX|US))/i.test(loc);
  if (virgula) return formula;
  let dentro = false, out = '';
  for (const c of formula) {
    if (c === '"') dentro = !dentro;
    out += (c === ',' && !dentro) ? ';' : c;
  }
  return out;
}

function montarResumo_(ss) {
  let r = ss.getSheetByName('Resumo');
  if (!r) r = ss.insertSheet('Resumo', 1);
  r.clear();
  const L = ABA + '!';
  const rng = c => L + c + '2:' + c + '5000';
  const somaPago = tipo => `=SUMPRODUCT((${rng('C')}="${tipo}")*(${rng('I')}="pago")*(LEFT(${rng('J')},7)=B1)*${rng('G')})`;
  const somaPend = (tipo, extra) => `=SUMPRODUCT((${rng('C')}="${tipo}")*(${rng('I')}="pendente")${extra || ''}*${rng('G')})`;
  const dados = [
    ['Mês (aaaa-mm)', '=YEAR(TODAY())&"-"&TEXT(MONTH(TODAY()),"00")'],
    ['Recebido no mês', somaPago('receita')],
    ['Gastos no mês', somaPago('despesa')],
    ['Saldo do mês', '=B2-B3'],
    ['Total a receber', somaPend('receita')],
    ['Total a pagar', somaPend('despesa')],
    ['A receber vencido', somaPend('receita', `*(${rng('H')}<B8)`)],
    ['Hoje (aaaa-mm-dd)', '=B1&"-"&TEXT(DAY(TODAY()),"00")'],
  ];
  dados.forEach((d, i) => {
    r.getRange(i + 1, 1).setValue(d[0]).setFontWeight('bold');
    r.getRange(i + 1, 2).setFormula(fx_(d[1]));
  });
  r.getRange(2, 2, 6, 1).setNumberFormat('R$ #,##0.00');
  r.setColumnWidth(1, 190); r.setColumnWidth(2, 150);
}

function doGet() {
  return saida_({ ok: true, app: 'IRAWÒ' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('TOKEN');
    if (!token || req.token !== token) return saida_({ ok: false, erro: 'Acesso negado' });
    const lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      switch (req.acao) {
        case 'status': return saida_({ ok: true, temChave: !!chaveIA_(props), modelo: props.getProperty('MODELO') || MODELO_PADRAO });
        case 'listar': return saida_({ ok: true, dados: lerTudo_() });
        case 'adicionar': adicionar_(req.itens || []); return saida_({ ok: true, dados: lerTudo_() });
        case 'atualizar': atualizar_(req.itens || []); return saida_({ ok: true, dados: lerTudo_() });
        case 'excluir': excluir_(req.ids || []); return saida_({ ok: true, dados: lerTudo_() });
        case 'catalogo': return saida_({ ok: true, dados: lerCatalogo_() });
        case 'salvarCatalogo': salvarCatalogo_(req.itens || []); return saida_({ ok: true, dados: lerCatalogo_() });
        case 'categorias': return saida_({ ok: true, dados: lerCategorias_() });
        case 'salvarCategorias': salvarCategorias_(req); return saida_({ ok: true, dados: lerCategorias_() });
        case 'salvarChave':
          if (!req.chave || String(req.chave).length < 20) return saida_({ ok: false, erro: 'Chave inválida' });
          props.setProperty('OPENROUTER_KEY', String(req.chave).trim());
          return saida_({ ok: true, temChave: true });
        case 'ia': return saida_(ia_(req));
        default: return saida_({ ok: false, erro: 'Ação desconhecida' });
      }
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return saida_({ ok: false, erro: String(err && err.message || err) });
  }
}

function saida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function aba_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA);
  if (!sh) throw new Error('Aba Lancamentos não existe. Rode iniciar().');
  return sh;
}

function lerTudo_() {
  const sh = aba_();
  const n = sh.getLastRow();
  if (n < 2) return [];
  const tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, n - 1, CAB.length).getValues()
    .filter(l => l[0] !== '')
    .map(l => {
      const o = {};
      CAB.forEach((c, i) => {
        let v = l[i];
        if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        o[c] = v;
      });
      o.valor = Number(o.valor) || 0;
      o.parcela = Number(o.parcela) || 1;
      o.total_parcelas = Number(o.total_parcelas) || 1;
      return o;
    });
}

function agora_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function texto_(v) {
  return SpreadsheetApp.newRichTextValue().setText(String(v === null || v === undefined ? '' : v)).build();
}

function adicionar_(itens) {
  if (!itens.length) return;
  const sh = aba_();
  const ini = sh.getLastRow() + 1;
  const linhas = itens.map(it => {
    const id = Utilities.getUuid().slice(0, 8);
    const o = Object.assign({}, it, { id: id, grupo_id: it.grupo_id || id, criado_em: agora_() });
    return CAB.map(c => (o[c] === undefined || o[c] === null) ? '' : o[c]);
  });
  COLUNAS_TEXTO.forEach(c => sh.getRange(ini, CAB.indexOf(c) + 1, linhas.length, 1).setNumberFormat('@'));
  const livres = TEXTOS.map(c => CAB.indexOf(c));
  const bruto = linhas.map(l => l.map((v, i) => livres.indexOf(i) >= 0 ? '' : v));
  sh.getRange(ini, 1, linhas.length, CAB.length).setValues(bruto);
  TEXTOS.forEach(c => {
    const i = CAB.indexOf(c);
    sh.getRange(ini, i + 1, linhas.length, 1).setNumberFormat('@').setRichTextValues(linhas.map(l => [texto_(l[i])]));
  });
}

function mapaIds_(sh) {
  const n = sh.getLastRow();
  const m = {};
  if (n < 2) return m;
  sh.getRange(2, 1, n - 1, 1).getValues().forEach((l, i) => { m[l[0]] = i + 2; });
  return m;
}

function atualizar_(itens) {
  const sh = aba_();
  const m = mapaIds_(sh);
  itens.forEach(it => {
    const linha = m[it.id];
    if (!linha) return;
    Object.keys(it).forEach(k => {
      const col = CAB.indexOf(k);
      if (col < 1 || k === 'criado_em') return; // nunca altera o id
      const cel = sh.getRange(linha, col + 1);
      if (TEXTOS.indexOf(k) >= 0) { cel.setNumberFormat('@').setRichTextValue(texto_(it[k])); return; }
      if (COLUNAS_TEXTO.indexOf(k) >= 0) cel.setNumberFormat('@');
      cel.setValue(it[k] === null ? '' : it[k]);
    });
  });
}

function excluir_(ids) {
  const sh = aba_();
  const m = mapaIds_(sh);
  ids.map(id => m[id]).filter(Boolean).sort((a, b) => b - a).forEach(l => sh.deleteRow(l));
}

// ---- Receitas e despesas padrão (atalhos; o valor é opcional) ----
const ABA_CAT = 'Catalogo';
const PADRAO_CAT = [
  ['BORI', 3000, 'Serviços e trabalhos', 'receita'], ['EBÓ', 800, 'Serviços e trabalhos', 'receita'], ['Yahuaska', 300, 'Serviços e trabalhos', 'receita'],
  ['Mercado', '', 'Alimentação e insumos', 'despesa'], ['Gás', '', 'Aluguel e contas', 'despesa'], ['Luz', '', 'Aluguel e contas', 'despesa'],
  ['Água', '', 'Aluguel e contas', 'despesa'], ['Bichinho', '', 'Materiais e oferendas', 'despesa'],
];

function abaCatalogo_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ABA_CAT);
  const cab = c => c.setFontWeight('bold').setBackground('#2a1f4a').setFontColor('#f2b84b');
  if (!sh) {
    sh = ss.insertSheet(ABA_CAT);
    cab(sh.getRange(1, 1, 1, 4).setValues([['nome', 'valor', 'categoria', 'tipo']]));
    sh.setFrozenRows(1);
    sh.getRange(2, 1, PADRAO_CAT.length, 4).setValues(PADRAO_CAT);
    sh.getRange(2, 2, 200, 1).setNumberFormat('R$ #,##0.00');
    sh.autoResizeColumns(1, 4);
  } else if (String(sh.getRange(1, 4).getValue()).trim() !== 'tipo') {
    // migração: planilha antiga só tinha receitas
    cab(sh.getRange(1, 4).setValue('tipo'));
    const n = sh.getLastRow();
    if (n > 1) sh.getRange(2, 4, n - 1, 1).setValue('receita');
    const despesas = PADRAO_CAT.filter(l => l[3] === 'despesa');
    sh.getRange(sh.getLastRow() + 1, 1, despesas.length, 4).setValues(despesas);
    sh.autoResizeColumns(1, 4);
  }
  return sh;
}

function lerCatalogo_() {
  const sh = abaCatalogo_();
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 4).getValues()
    .filter(l => String(l[0]).trim() !== '')
    .map(l => ({ nome: String(l[0]), valor: Number(l[1]) || 0, categoria: String(l[2] || ''), tipo: String(l[3]).trim() === 'despesa' ? 'despesa' : 'receita' }));
}

function salvarCatalogo_(itens) {
  const sh = abaCatalogo_();
  const n = sh.getLastRow();
  if (n > 1) sh.getRange(2, 1, n - 1, 4).clearContent();
  const lista = itens.filter(i => String(i.nome || '').trim() !== '').slice(0, 200);
  if (!lista.length) return;
  sh.getRange(2, 1, lista.length, 1).setNumberFormat('@').setRichTextValues(lista.map(i => [texto_(i.nome)]));
  sh.getRange(2, 2, lista.length, 1).setValues(lista.map(i => [Number(i.valor) || '']));
  sh.getRange(2, 3, lista.length, 1).setNumberFormat('@').setRichTextValues(lista.map(i => [texto_(i.categoria || '')]));
  sh.getRange(2, 4, lista.length, 1).setValues(lista.map(i => [i.tipo === 'despesa' ? 'despesa' : 'receita']));
}

// ---- Categorias editáveis (receita e despesa) ----
const ABA_CATG = 'Categorias';
const PADRAO_CATG = {
  receita: ['Serviços e trabalhos', 'Mensalidade / contribuição', 'Festas e eventos', 'Cursos e oficinas', 'Venda de produtos', 'Doações', 'Outras receitas'],
  despesa: ['Materiais e oferendas', 'Alimentação e insumos', 'Aluguel e contas', 'Equipe e colaboradores', 'Manutenção e obras', 'Divulgação', 'Impostos e taxas', 'Transporte', 'Outras despesas'],
};

function escreverCategorias_(sh, obj) {
  const n = sh.getLastRow();
  if (n > 1) sh.getRange(2, 1, n - 1, 2).clearContent();
  const linhas = [];
  ['receita', 'despesa'].forEach(t => (obj[t] || []).forEach(nome => {
    if (String(nome).trim() !== '') linhas.push([t, String(nome).trim()]);
  }));
  if (!linhas.length) return;
  sh.getRange(2, 1, linhas.length, 2).setNumberFormat('@')
    .setRichTextValues(linhas.map(l => [texto_(l[0]), texto_(l[1])]));
}

function abaCategorias_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ABA_CATG);
  if (!sh) {
    sh = ss.insertSheet(ABA_CATG);
    sh.getRange(1, 1, 1, 2).setValues([['tipo', 'nome']])
      .setFontWeight('bold').setBackground('#2a1f4a').setFontColor('#f2b84b');
    sh.setFrozenRows(1);
    escreverCategorias_(sh, PADRAO_CATG);
    sh.autoResizeColumns(1, 2);
  }
  return sh;
}

function lerCategorias_() {
  const sh = abaCategorias_();
  const n = sh.getLastRow();
  const out = { receita: [], despesa: [] };
  if (n < 2) return PADRAO_CATG;
  sh.getRange(2, 1, n - 1, 2).getValues().forEach(l => {
    const t = String(l[0]).trim(), nome = String(l[1]).trim();
    if (out[t] && nome) out[t].push(nome);
  });
  if (!out.receita.length) out.receita = PADRAO_CATG.receita;
  if (!out.despesa.length) out.despesa = PADRAO_CATG.despesa;
  return out;
}

function salvarCategorias_(obj) {
  escreverCategorias_(abaCategorias_(), { receita: obj.receita || [], despesa: obj.despesa || [] });
}

/** Proxy para o OpenRouter: a chave nunca sai do servidor. */
function ia_(req) {
  const props = PropertiesService.getScriptProperties();
  const chave = chaveIA_(props);
  if (!chave) return { ok: false, erro: 'Chave do OpenRouter ainda não configurada (Ajustes).' };
  const content = [{ type: 'text', text: String(req.prompt || '') }];
  (req.midias || []).forEach(m => {
    if (m.tipo === 'audio') content.push({ type: 'input_audio', input_audio: { data: m.base64, format: m.formato || 'wav' } });
    else if (m.tipo === 'imagem') content.push({ type: 'image_url', image_url: { url: 'data:' + (m.mime || 'image/jpeg') + ';base64,' + m.base64 } });
    else if (m.tipo === 'video') content.push({ type: 'video_url', video_url: { url: 'data:' + (m.mime || 'video/mp4') + ';base64,' + m.base64 } });
  });
  const resp = UrlFetchApp.fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + chave, 'X-Title': 'IRAWO Financeiro' },
    payload: JSON.stringify({
      model: props.getProperty('MODELO') || MODELO_PADRAO,
      messages: [{ role: 'user', content: content }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  const corpo = resp.getContentText();
  if (code >= 300) return { ok: false, erro: 'OpenRouter ' + code + ': ' + corpo.slice(0, 300) };
  const j = JSON.parse(corpo);
  const texto = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!texto) return { ok: false, erro: 'A IA não devolveu resposta.' };
  return { ok: true, texto: texto };
}

/**
 * Rode DEPOIS de publicar o Web App: escreve na aba Resumo um link que abre o app já
 * configurado (endereço + token). Abra a planilha no celular e toque no link, uma vez.
 * Quem tem acesso à planilha tem acesso ao app: não compartilhe a planilha.
 */
function linkDeAcesso() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r = ss.getSheetByName('Resumo') || ss.insertSheet('Resumo', 1);
  const url = WEBAPP_URL;
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!url || !token) throw new Error('Publique o Web App e rode iniciar() antes.');
  const cfg = Utilities.base64Encode(JSON.stringify({ u: url, t: token }), Utilities.Charset.UTF_8);
  const link = APP_URL + '#cfg=' + encodeURIComponent(cfg);
  r.getRange('A10').setValue('Abrir o app já configurado (toque uma vez no celular):').setFontWeight('bold');
  r.getRange('A11').setRichTextValue(SpreadsheetApp.newRichTextValue().setText('▶ Abrir IRAWÒ').setLinkUrl(link).build());
  r.getRange('A12').setValue('Atenção: este link contém a chave de acesso. Não compartilhe a planilha.').setFontColor('#c0392b');
  console.log('Link gravado na aba Resumo (A11).');
}
