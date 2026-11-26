import { readFileSync } from 'node:fs';
import { escapeHtml } from '../marketing/crm-email-template.mjs';

export { normalizeDossier, normalizeFees } from './fields.mjs';

const logo = readFileSync(new URL('../../web/maximum-logo.png', import.meta.url)).toString('base64');
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const missing = 'Não informado';
const documentStyle = `
  :root { color-scheme: light; color: #2a2224; font: 15px/1.52 Arial, Helvetica, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 14px; background: #f7f4f4; }
  .sheet { max-width: 930px; margin-inline: auto; background: #fff; border: 1px solid #e8dfe1; border-radius: 18px; overflow: hidden; }
  header { color: #fff; background: #64080e; padding: 26px clamp(18px, 5vw, 40px); }
  header img { width: 230px; max-width: 100%; height: auto; display: block; }
  header p { margin: 18px 0 4px; color: #f0be99; font-size: .82rem; letter-spacing: .09em; text-transform: uppercase; }
  h1 { margin: 0 0 5px; font-size: clamp(1.35rem, 4vw, 2.1rem); line-height: 1.16; overflow-wrap: anywhere; }
  header small { color: #fde6e9; }
  article { padding: 24px clamp(16px, 4vw, 40px); }
  section { margin: 0 0 24px; }
  h2 { margin: 0 0 6px; padding: 7px 0; color: #64080e; border-bottom: 2px solid #e9c6c0; font-size: 1.12rem; break-after: avoid; }
  dl { margin: 0; }
  dl div { display: grid; grid-template-columns: minmax(9rem, 36%) minmax(0, 1fr); padding: 7px 0; gap: 10px 16px; border-bottom: 1px solid #eee6e7; }
  dt { font-weight: 700; color: #52363a; }
  dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .records { margin: 12px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; }
  .records li { padding: 9px 14px; border: 1px solid #eee6e7; border-radius: 9px; }
  .records li dl div:last-child { border: 0; }
  .note { color: #694f53; }
  .promises { overflow-wrap: anywhere; }
  @media (max-width: 430px) {
    dl div { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  }
  @media print {
    @page { size: A4; margin: 12mm; }
    :root { font-size: 10.5pt; line-height: 1.38; }
    body { padding: 0; background: #fff; }
    .sheet { border: 0; border-radius: 0; }
    header { print-color-adjust: exact; padding: 14pt 18pt; }
    article { padding: 10pt 0; }
    section { margin-bottom: 14px; }
    dl div { padding: 4px 0; }
    dl div, .records li { break-inside: avoid; }
  }
`;

function dateLabel(value) {
  if (!value) return missing;
  return String(value).split('-').reverse().join('/');
}

function cnpjLabel(value) {
  return value?.replace(/^([A-Z\d]{2})([A-Z\d]{3})([A-Z\d]{3})([A-Z\d]{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function yesNoLabel(value) {
  return value === 'sim' ? 'Sim' : 'Não';
}

function label(value) {
  return value == null || value === '' ? missing : value;
}

function dataList(rows) {
  return '<dl>' + rows.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(label(value))}</dd></div>`).join('') + '</dl>';
}

function section(title, html) {
  return `<section><h2>${escapeHtml(title)}</h2>${html}</section>`;
}

function records(items, toRows, emptyText) {
  if (!items.length) return `<p class="note">${escapeHtml(emptyText)}</p>`;
  return '<ul class="records">' + items.map(item => '<li>' + dataList(toRows(item)) + '</li>').join('') + '</ul>';
}

export function renderDossierHtml(dossier) {
  const { empresa, informacoesGerais: geral, informacoesOperacionais: operacao, consideracoesSetores: setores } = dossier;
  const companyRows = [
    ['Empresa', empresa.nome], ['Regime tributário', empresa.regimeTributario],
    ['CNPJ', cnpjLabel(empresa.cnpj)], ['Cidade e estado', `${empresa.cidade} · ${empresa.estado}`],
    ['Grupo', dossier.grupo], ['Data de início', dateLabel(dossier.dataInicio)], ['Retificação', yesNoLabel(dossier.retificacao)],
  ];
  if (dossier.retificacao === 'sim') companyRows.push(['Meses da retificação', dossier.mesesRetificacao]);

  const contactRows = [
    ['Negociação realizada com', dossier.negociacaoCom], ['Indicação', yesNoLabel(dossier.indicacao.temIndicacao)],
    ['Origem', dossier.origem],
  ];
  if (dossier.indicacao.temIndicacao === 'sim') contactRows.splice(2, 0, ['Indicador', dossier.indicacao.nomeIndicador]);

  const affiliation = records(dossier.filiais, filial => [
    ['Tipo', filial.tipo === 'coligada' ? 'Coligada / agregada' : 'Filial'],
    ['Nome', filial.nome], ['Regime tributário', filial.regimeTributario], ['CNPJ', cnpjLabel(filial.cnpj)],
    ['Cidade', filial.cidade], ['Estado', filial.estado],
  ], 'Nenhuma filial ou coligada informada.');
  const contacts = records(dossier.contatos, contato => [
    ['Nome', contato.nome], ['Função', contato.papel], ['Telefone', contato.telefone], ['E-mail', contato.email], ['Setor', contato.setor],
  ], 'Nenhum contato informado.');
  const promises = dossier.promessasRealizadas.length
    ? '<ul class="promises">' + dossier.promessasRealizadas.map(value => `<li>${escapeHtml(value)}</li>`).join('') + '</ul>'
    : '<p class="note">Nenhuma promessa informada.</p>';
  const topics = records(dossier.topicosConsideracoesSetores, topic => [
    ['Setor', topic.setor], ['Descrição', topic.descricao],
  ], 'Nenhum tópico adicional informado.');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>Dossiê · ${escapeHtml(empresa.nome)}</title>
  <style>${documentStyle}</style>
</head>
<body><main class="sheet">
  <header><img alt="Maximum Assessoria Contábil" src="data:image/png;base64,${logo}"><p>Sucesso do Cliente · Dossiê interno</p>
  <h1>${escapeHtml(empresa.nome)}</h1>${dossier.protocolo ? `<small>${escapeHtml(dossier.protocolo)}</small>` : ''}</header>
  <article>
    ${section('Dados da empresa', dataList(companyRows))}
    ${section('Filiais e coligadas', dataList([['Possui filiais ou coligadas', yesNoLabel(dossier.possuiFiliais)], ['Quantidade', dossier.quantidadeFiliais]]) + affiliation)}
    ${section('Contatos e negociação', dataList(contactRows) + contacts)}
    ${section('Informações gerais', dataList([
      ['Faturamento médio mensal', geral.faturamentoMedioMensal], ['Setor de atuação', geral.setorAtuacao], ['Estados de atuação', geral.atuacaoEstados],
      ['E-commerce', yesNoLabel(geral.possuiEcommerce)], ['Licitações e contratos públicos', yesNoLabel(geral.licitacoesContratosPublicos)],
      ['Auditorias recorrentes', yesNoLabel(geral.auditoriasRecorrentes)],
    ]))}
    ${section('Informações operacionais', dataList([
      ['Sistemas utilizados', operacao.sistemasUtilizados], ['Periodicidade de entrega do balanço', operacao.periodicidadeBalanco],
      ['Número de funcionários', operacao.numeroFuncionarios], ['Separação por centro de custo', yesNoLabel(operacao.separacaoCentroCusto)],
      ['Contas bancárias e bancos', operacao.contasBancarias], ['Regime especial', yesNoLabel(operacao.regimeEspecial)],
      ['Parcelamentos e empréstimos ativos', operacao.parcelamentosEmprestimos],
    ]))}
    ${section('Motivo e promessas', dataList([['Motivo da troca de contabilidade', dossier.motivoTrocaContabilidade]]) + promises)}
    ${section('Considerações por setor', dataList([
      ['Societário', setores.societario], ['Pessoal', setores.pessoal], ['Fiscal', setores.fiscal], ['Contábil', setores.contabil],
      ['Sucesso do Cliente', setores.sucessoCliente], ['Programação', setores.programacao], ['Diretoria', setores.diretoria],
      ['Demais observações', dossier.demaisObservacoes],
    ]) + topics)}
  </article>
</main></body>
</html>`;
}

export function renderFeesMessage(dossier) {
  const { empresa = {}, protocolo, honorarios } = dossier;
  const subject = `Honorários do dossiê · ${empresa.nome || protocolo} · v${honorarios.version}`.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ');
  const rows = [
    ['Empresa', empresa.nome], ['CNPJ', cnpjLabel(empresa.cnpj)], ['Protocolo', protocolo],
    ['Honorário mensal', brl.format(honorarios.valorMensalCentavos / 100)],
    ['Implantação', brl.format(honorarios.valorImplantacaoCentavos / 100)],
    ['Vencimento', `Dia ${honorarios.vencimentoDia} (último dia do mês quando necessário)`],
    ['Início da cobrança', dateLabel(honorarios.inicioCobranca)],
    ['Condições e observações', honorarios.observacoes || 'Nenhuma'],
    ['Versão dos honorários', honorarios.version],
  ];
  const emailRows = rows.map(([key, value]) => `<tr><th scope="row" style="width:38%;text-align:left;padding:10px;border-bottom:1px solid #eee;vertical-align:top">${escapeHtml(key)}</th><td style="padding:10px;border-bottom:1px solid #eee;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(label(value))}</td></tr>`).join('');
  return {
    subject,
    text: 'Maximum | Honorários do dossiê\n\n' + rows.map(([key, value]) => `${key}: ${label(value)}`).join('\n'),
    html: `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><body style="margin:0;padding:16px;background:#f7f4f4;font:15px Arial,Helvetica,sans-serif;color:#262022"><main style="max-width:640px;margin:auto;background:#fff;border:1px solid #e8dfe1"><header style="padding:22px;background:#64080e;color:#fff"><p style="margin:0 0 7px;color:#f0be99">MAXIMUM · SUCESSO DO CLIENTE</p><h1 style="font-size:23px;margin:0">Honorários do dossiê</h1></header><table style="width:100%;border-collapse:collapse">${emailRows}</table></main></body></html>`,
  };
}
