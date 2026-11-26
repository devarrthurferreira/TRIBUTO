import { readFileSync } from 'node:fs';
import { escapeHtml } from '../marketing/crm-email-template.mjs';

export { normalizeDossier, normalizeFees } from './fields.mjs';

const logo = readFileSync(new URL('../../web/maximum-logo.png', import.meta.url)).toString('base64');
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const saoPauloDateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo',
});
const missing = 'Não informado';
const documentStyle = `
  :root {
    color-scheme: light;
    color: #252024;
    font: 13.5px/1.48 system-ui, -apple-system, "Segoe UI", sans-serif;
    --wine: #640c15;
    --line: #ebdfe1;
    --warm: #faf6f6;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: clamp(5px, 2.2vw, 18px); background: #f5f3f3; }
  .sheet {
    max-width: 850px;
    margin-inline: auto;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 15px;
    box-shadow: 0 8px 30px #3c1c2410;
  }
  .cover {
    padding: clamp(12px, 3.2vw, 24px);
    color: #fff;
    background: var(--wine);
    border-radius: 14px 14px 0 0;
  }
  .brand {
    display: grid;
    place-items: center;
    padding: 15px 10px;
    border: 1px solid #ffffff40;
    border-radius: 5px;
  }
  .brand img { width: 260px; max-width: 76%; height: auto; display: block; }
  .eyebrow { margin: 17px 0 4px; color: #f4cca6; font-size: .8rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  h1 { margin: 0; font-size: clamp(1.28rem, 3.6vw, 1.78rem); line-height: 1.2; overflow-wrap: anywhere; }
  .cover-meta { margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 2px 15px; color: #f8e8ea; font-size: .85rem; }
  .cover-meta span { overflow-wrap: anywhere; }
  article { padding: clamp(12px, 3.2vw, 27px); }
  section + section { margin-top: 23px; }
  h2 {
    margin: 0;
    padding: 8px 13px;
    color: #fff;
    background: var(--wine);
    border-radius: 7px 7px 0 0;
    font-size: 1rem;
    break-after: avoid;
  }
  dl { margin: 0; }
  .detail-row {
    display: grid;
    grid-template-columns: minmax(9rem, 37%) minmax(0, 1fr);
    padding: 8px 12px;
    gap: 3px 16px;
    border-bottom: 1px solid var(--line);
  }
  .detail-row:nth-child(even) { background: var(--warm); }
  dt { font-weight: 650; color: #5c4147; }
  dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .detail-row--long { display: block; }
  .detail-row--long dt { margin-bottom: 5px; }
  .records { margin: 12px 0 0; padding: 0; list-style: none; }
  .record { border: 1px solid var(--line); border-radius: 7px; }
  .record + .record { margin-top: 9px; }
  .record h3 { margin: 0; padding: 6px 12px; color: var(--wine); background: #f5eaec; border-radius: 6px 6px 0 0; font-size: .9rem; break-after: avoid; overflow-wrap: anywhere; }
  .record .detail-row:last-child { border: 0; }
  .note { margin: 9px 12px 0; color: #684f55; }
  .promises { margin: 10px 0 0; padding-inline: 34px 12px; overflow-wrap: anywhere; white-space: pre-wrap; }
  .promises li + li { margin-top: 5px; }
  @media screen and (max-width: 500px) {
    .detail-row { grid-template-columns: minmax(0, 1fr); }
    .cover-meta { display: grid; }
  }
  @media print {
    @page { size: A4; margin: 12mm 13mm; }
    :root { font-size: 9.5pt; line-height: 1.38; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    body { padding: 0; background: #fff; }
    .sheet { max-width: none; border: 0; border-radius: 0; box-shadow: none; }
    .cover { padding: 12pt 15pt; break-inside: avoid; }
    .brand { padding: 8pt; }
    .brand img { width: 145pt; }
    .eyebrow { margin-top: 9pt; }
    h1 { font-size: 15pt; }
    article { padding: 12pt 0 0; }
    section + section { margin-top: 12pt; }
    h2, .detail-row { padding: 5pt 8pt; }
    .detail-row:not(.detail-row--long), .record--short { break-inside: avoid; }
    .detail-row--long dd, .promises li { orphans: 3; widows: 3; }
  }
`;

function dateLabel(value) {
  if (!value) return missing;
  return String(value).split('-').reverse().join('/');
}

function timestampLabel(value) {
  if (!value) return missing;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? saoPauloDateTime.format(timestamp) : missing;
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
  return '<dl>' + rows.map(([key, value]) => {
    const content = label(value);
    const type = String(content).length > 300 ? ' detail-row--long' : '';
    return `<div class="detail-row${type}"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(content)}</dd></div>`;
  }).join('') + '</dl>';
}

function section(title, html) {
  return `<section><h2>${escapeHtml(title)}</h2>${html}</section>`;
}

function records(items, toRows, emptyText, itemLabel) {
  if (!items.length) return `<p class="note">${escapeHtml(emptyText)}</p>`;
  return '<ul class="records">' + items.map((item, index) => {
    const rows = toRows(item);
    const type = rows.some(([, value]) => String(value).length > 300) ? '' : ' record--short';
    return `<li class="record${type}"><h3>${escapeHtml(itemLabel + ' ' + (index + 1))}</h3>${dataList(rows)}</li>`;
  }).join('') + '</ul>';
}

export function renderDossierHtml(dossier) {
  const { empresa, informacoesGerais: geral, informacoesOperacionais: operacao, consideracoesSetores: setores } = dossier;
  const wasUpdated = dossier.updatedAt && Date.parse(dossier.updatedAt) > Date.parse(dossier.createdAt);
  const summaryRows = [
    ['Ação', dossier.archivedAt ? 'Dossiê arquivado' : wasUpdated ? 'Dossiê atualizado' : 'Dossiê cadastrado'],
    ['Protocolo', dossier.protocolo], ['Empresa', empresa.nome], ['Grupo pertencente', dossier.grupo],
    ['Criação', timestampLabel(dossier.createdAt)],
  ];
  if (wasUpdated) summaryRows.push(['Última atualização', timestampLabel(dossier.updatedAt)]);
  if (dossier.archivedAt) summaryRows.push(['Arquivamento', timestampLabel(dossier.archivedAt)]);
  const companyRows = [
    ['Empresa', empresa.nome], ['Regime tributário', empresa.regimeTributario],
    ['CNPJ', cnpjLabel(empresa.cnpj)], ['Cidade e estado', `${empresa.cidade} – ${empresa.estado}`],
    ['Grupo pertencente', dossier.grupo], ['Data de início', dateLabel(dossier.dataInicio)],
    ['Terá retificação?', yesNoLabel(dossier.retificacao)], ['Meses da retificação', dossier.mesesRetificacao],
  ];

  const contactRows = [
    ['Negociação realizada com', dossier.negociacaoCom], ['Indicação', yesNoLabel(dossier.indicacao.temIndicacao)],
    ['Origem', dossier.origem],
  ];
  if (dossier.indicacao.temIndicacao === 'sim') contactRows.splice(2, 0, ['Indicador', dossier.indicacao.nomeIndicador]);

  const affiliation = records(dossier.filiais, filial => [
    ['Tipo', filial.tipo === 'coligada' ? 'Coligada / agregada' : 'Filial'],
    ['Nome', filial.nome], ['Regime tributário', filial.regimeTributario], ['CNPJ', cnpjLabel(filial.cnpj)],
    ['Cidade', filial.cidade], ['Estado', filial.estado],
  ], 'Nenhuma filial ou coligada informada.', 'Unidade');
  const contacts = records(dossier.contatos, contato => [
    ['Nome', contato.nome], ['Função', contato.papel], ['Telefone', contato.telefone], ['E-mail', contato.email], ['Setor', contato.setor],
  ], 'Nenhum contato informado.', 'Contato');
  const promises = dossier.promessasRealizadas.length
    ? '<ol class="promises">' + dossier.promessasRealizadas.map(value => `<li>${escapeHtml(value)}</li>`).join('') + '</ol>'
    : '<p class="note">Nenhuma promessa informada.</p>';
  const topics = records(dossier.topicosConsideracoesSetores, topic => [
    ['Setor', topic.setor], ['Descrição', topic.descricao],
  ], 'Nenhum tópico adicional informado.', 'Tópico');
  const documentTitle = dossier.protocolo || ('Dossiê · ' + empresa.nome);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(documentTitle)}</title>
  <style>${documentStyle}</style>
</head>
<body><main class="sheet">
  <header class="cover">
    <div class="brand"><img width="512" height="107" alt="Maximum Assessoria Contábil" src="data:image/png;base64,${logo}"></div>
    <p class="eyebrow">Dossiê do cliente</p>
    <h1>${escapeHtml(empresa.nome)}</h1>
    <p class="cover-meta">${dossier.protocolo ? `<span>Protocolo <strong>${escapeHtml(dossier.protocolo)}</strong></span>` : ''}
      ${dossier.createdAt ? `<span>Criado em ${escapeHtml(timestampLabel(dossier.createdAt))}</span>` : ''}</p>
  </header>
  <article>
    ${section('Resumo da movimentação', dataList(summaryRows))}
    ${section('1. Dados da empresa', dataList(companyRows))}
    ${section('2. Filiais e coligadas', dataList([['Possui filiais ou coligadas?', yesNoLabel(dossier.possuiFiliais)], ['Quantidade declarada', dossier.quantidadeFiliais]]) + affiliation)}
    ${section('3. Contatos e negociação', dataList(contactRows) + contacts)}
    ${section('4. Informações gerais', dataList([
      ['Faturamento médio mensal', geral.faturamentoMedioMensal], ['Setor de atuação', geral.setorAtuacao], ['Estados de atuação', geral.atuacaoEstados],
      ['E-commerce', yesNoLabel(geral.possuiEcommerce)], ['Licitações e contratos públicos', yesNoLabel(geral.licitacoesContratosPublicos)],
      ['Auditorias recorrentes', yesNoLabel(geral.auditoriasRecorrentes)],
    ]))}
    ${section('5. Informações operacionais', dataList([
      ['Sistemas utilizados', operacao.sistemasUtilizados], ['Periodicidade de entrega do balanço', operacao.periodicidadeBalanco],
      ['Número de funcionários', operacao.numeroFuncionarios], ['Separação por centro de custo', yesNoLabel(operacao.separacaoCentroCusto)],
      ['Contas bancárias e bancos', operacao.contasBancarias], ['Regime especial', yesNoLabel(operacao.regimeEspecial)],
      ['Parcelamentos e empréstimos ativos', operacao.parcelamentosEmprestimos],
    ]))}
    ${section('6. Motivo e promessas', dataList([['Motivo da troca de contabilidade', dossier.motivoTrocaContabilidade]]) + promises)}
    ${section('7. Considerações por setor', dataList([
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
