import { button, documentLabel, el, mountDossierForm } from './dossier-form.js';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const statusLabels = {
  unset: 'Honorários pendentes', saved: 'Pronto para envio', review: 'Revisar valores', queued: 'Em fila',
  sending: 'Enviando', sent: 'Aceito pelo SMTP', failed: 'Falha no envio', uncertain: 'Sem confirmação',
  not_queued: 'Pendente',
};
const pageSize = 20;

function printButton() {
  const control = button('Imprimir ou salvar em PDF', true);
  const icon = el('i', 'bi bi-file-earmark');
  icon.setAttribute('aria-hidden', 'true');
  control.prepend(icon);
  return control;
}

function dateLabel(value) {
  const timestamp = new Date(value);
  return value && Number.isFinite(timestamp.valueOf()) ? dateTime.format(timestamp) : '—';
}

function notice(message = '', { error = false } = {}) {
  const node = el('p', 'dossier-message' + (error ? ' dossier-error' : ''), message);
  node.setAttribute('role', error ? 'alert' : 'status');
  node.hidden = !message;
  return node;
}

function setNotice(target, message, error = false) {
  target.textContent = message || '';
  target.hidden = !message;
  target.classList.toggle('dossier-error', error);
  target.setAttribute('role', error ? 'alert' : 'status');
}

function badge(status) {
  const node = el('span', 'dossier-badge', statusLabels[status] || statusLabels.unset);
  if (Object.hasOwn(statusLabels, status)) node.dataset.status = status;
  return node;
}

function input(label, { type = 'text', value = '', name, required = false, ...attributes } = {}) {
  const wrapper = el('label', 'dossier-field');
  const caption = el('span', '', label + (required ? ' *' : ''));
  const control = el(type === 'select' || type === 'textarea' ? type : 'input');
  if (type !== 'select' && type !== 'textarea') control.type = type;
  if (name) control.name = name;
  control.required = required;
  Object.assign(control, attributes);
  control.value = value;
  wrapper.append(caption, control);
  return { wrapper, control };
}

function copyLink(control, status) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error();
    return navigator.clipboard.writeText(control.value).then(() => {
      setNotice(status, 'Link copiado. Compartilhe apenas com quem vai preencher.');
    }).catch(() => {
      control.focus();
      control.select();
      setNotice(status, 'Selecione e copie o link.');
    });
  } catch {
    control.focus();
    control.select();
    setNotice(status, 'Selecione e copie o link.');
  }
}

function historicalEmails(text) {
  const chunks = text.split(/^Protocolo:\s*\*\*(?=DOS-)/m).slice(1);
  if (!chunks.length) throw new Error('Cole as tabelas dos e-mails com o protocolo original.');
  return chunks.map(chunk => {
    const match = /^(DOS-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-[A-Z0-9]+)\*\*/.exec(chunk);
    if (!match) throw new Error('Protocolo inválido.');
    const [, protocolo,y,m,d,h,min,s] = match;
    const values = new Map();
    const filiais = [], contatos = [], notes = [], promises = [];
    let section = '', columns = [];
    const clean = value => value.trim().replaceAll('**','').replaceAll('&#xA;', '\n').replaceAll('&#x20;', ' ').replaceAll('\\|','|').replaceAll('\\*','*').replace(/\[([^\]]+)\]\(mailto:[^)]+\)/g,'$1');
    for (const raw of chunk.split('\n')) {
      if (raw.startsWith('- ') && /Motivo e promessas/i.test(section)) promises.push(clean(raw.slice(2)));
      if (!raw.startsWith('|')) continue;
      const cells = raw.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(clean);
      if (/^\d+\./.test(cells[0])) { section = cells[0]; columns = []; continue; }
      if (!cells[0] || /^-+$/.test(cells[0])) continue;
      if (cells.length === 2) { values.set(cells[0], cells[1]); continue; }
      if (['Nome','Tipo'].includes(cells[0])) { columns = cells; continue; }
      const row = Object.fromEntries(columns.map((k,i) => [k,cells[i] === 'Não informado' ? '' : cells[i]]));
      if (row.Nome && /Filiais/i.test(section)) {
        filiais.push({nome:row.Nome, cnpj:row.CNPJ, cidade:row.Cidade, estado:row.Estado,
          tipo:row.Tipo?.startsWith('Coligada') ? 'coligada':'filial', regimeTributario:row['Regime tributário'] || 'Não informado'});
      }
      if (row.Nome && /Contatos/i.test(section)) {
        const emails = (row['E-mail'] || '').split(/;\s*/);
        const email = emails.find(address => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address));
        if (row['E-mail'] && row['E-mail'] !== email) notes.push(row.Nome + ' — ' + row['E-mail']);
        contatos.push({nome:row.Nome,papel:row['Quem é'],telefone:row.Telefone,email,setor:row.Setor});
      }
    }
    const get = (...labels) => labels.map(label=>values.get(label)).find(Boolean) || '';
    const yes = label => get(label) === 'Sim';
    const [cidade,estado] = get('Cidade/Estado').split(/\s+-\s+/);
    const employees = get('Número de funcionários');
    if (employees && !/^\d+$/.test(employees)) notes.push('Número de funcionários — ' + employees);
    if (get('Ação') === 'Dossiê atualizado') notes.push('Última movimentação no sistema de origem — ' + get('Data/hora da movimentação'));
    const dossier = {
      dataInicio:get('Data de início').split('/').reverse().join('-'), grupo:get('Grupo pertencente','Grupo'),
      empresa:{nome:get('Empresa'),regimeTributario:get('Regime tributário'),cnpj:get('CNPJ'),cidade,estado},
      retificacao:yes('Terá retificação?'), mesesRetificacao:get('Meses de retificação','Meses da retificação'),
      possuiFiliais:filiais.length > 0, filiais, contatos, negociacaoCom:get('Negociação realizada com'), origem:get('Origem'),
      indicacao:{temIndicacao:yes('Indicação?'),nomeIndicador:get('Nome do indicador')},
      informacoesGerais:{faturamentoMedioMensal:get('Faturamento médio mensal'),setorAtuacao:get('Setor de atuação'),atuacaoEstados:get('Atuação em quais estados'),possuiEcommerce:yes('Possui e-commerce?'),licitacoesContratosPublicos:yes('Atua com licitações/contratos públicos?'),auditoriasRecorrentes:yes('Há auditorias recorrentes?')},
      informacoesOperacionais:{sistemasUtilizados:get('Sistemas utilizados'),periodicidadeBalanco:get('Periodicidade de entrega do balanço'),numeroFuncionarios:/^\d+$/.test(employees)?employees:'',separacaoCentroCusto:yes('Separação por centro de custo?'),contasBancarias:get('Contas bancárias / bancos'),regimeEspecial:yes('Regime especial?'),parcelamentosEmprestimos:get('Parcelamentos e empréstimos ativos?')},
      motivoTrocaContabilidade:get('Motivo da troca de contabilidade'),promessasRealizadas:promises,
      consideracoesSetores:Object.fromEntries(Object.entries({societario:'Societário',pessoal:'Pessoal',fiscal:'Fiscal',contabil:'Contábil',sucessoCliente:'Sucesso do Cliente',programacao:'Programação',diretoria:'Diretoria'}).map(([key,label])=>[key,get(label)])),
      demaisObservacoes:[get('Demais observações'),...notes].filter(Boolean).join('\n')
    };
    if (!dossier.empresa.nome || !estado || !get('Data de início') || Number(get('Quantidade')) !== filiais.length) throw new Error('Confira as tabelas de ' + protocolo);
    return {protocolo,createdAt:y+'-'+m+'-'+d+'T'+h+':'+min+':'+s+'Z',dossier};
  });
}

export function mountDossierAdmin(root, {
  request, canCreate = false, canLink = false, canFeesRead = false, canFees = false,
  allowUnboundLinks = false, companies = [], sector, sectorLabel = 'Sucesso do Cliente', onAuthError,
}) {
  let active = true;
  let currentPage = 1;
  let listVersion = 0;
  let panelVersion = 0;
  let filterTimer;
  let panelCleanup;
  let returnFocus;
  let busy = false;
  let feeStep = false;
  const app = el('div', 'dossier-admin');
  const header = el('header', 'dossier-page-head');
  const headTitle = el('div');
  headTitle.append(el('p', 'eyebrow', sectorLabel), el('h2', '', 'Dossiês'),
    el('p', '', 'Consulte o histórico de entrada e atendimento das empresas.'));
  const headActions = el('div', 'dossier-actions');
  const create = button('Novo dossiê', true);
  const links = button('Links de preenchimento');
  if (canCreate) headActions.append(create);
  if (canLink) headActions.append(links);
  if (allowUnboundLinks) {
    const opener = button('Importar histórico');
    headActions.append(opener);
    opener.addEventListener('click', () => {
      showPanel('Importar dossiês históricos', opener);
      const source = input('E-mails em formato de tabela Markdown', { type: 'textarea', rows: 12 });
      const preview = button('Conferir protocolos');
      const save = button('Importar dossiês', true);
      save.hidden = true;
      let items = [];
      source.control.addEventListener('input', () => { save.hidden = true; setNotice(panelStatus, ''); });
      preview.addEventListener('click', () => {
        try {
          items = historicalEmails(source.control.value);
          setNotice(panelStatus, items.map(item => item.protocolo + ' · ' + item.dossier.empresa.nome).join(' / '));
          save.hidden = false;
        } catch (error) { showFailure(panelStatus, error); }
      });
      save.addEventListener('click', async () => {
        save.disabled = true;
        changeBusy(true);
        try {
          const response = await request('/dossiers/import', { method:'POST', body:{items} });
          const total = response.items.filter(item => item.imported).length;
          setNotice(panelStatus, total + ' importados · ' + (items.length-total) + ' já cadastrados.');
          save.hidden = true;
          await loadList(1);
        } catch (error) { showFailure(panelStatus,error); }
        finally { changeBusy(false); save.disabled = false; }
      });
      panel.append(source.wrapper, preview, save);
    });
  }
  header.append(headTitle, headActions);

  const card = el('section', 'dossier-card');
  const searchForm = el('form', 'dossier-toolbar');
  searchForm.setAttribute('role', 'search');
  const search = input('Buscar dossiês', { type: 'search', placeholder: 'Empresa, CNPJ ou protocolo', maxLength: 100 });
  const go = button('Buscar', false, true);
  const archived = input('Situação', { type: 'select', name: 'archived' });
  archived.control.append(new Option('Ativos', ''), new Option('Arquivados', '1'));
  searchForm.append(search.wrapper, archived.wrapper, go);
  const listStatus = notice('Carregando dossiês…');
  const rows = el('div', 'dossier-admin-list');
  const footer = el('footer', 'dossier-list-footer');
  const prev = button('Anterior');
  const next = button('Próxima');
  const pageText = el('span', 'dossier-muted');
  footer.append(prev, pageText, next);
  card.append(searchForm, listStatus, rows, footer);

  const dialog = el('dialog', 'dossier-dialog');
  dialog.setAttribute('aria-label', 'Dossiê');
  const panelHeader = el('header', 'dossier-panel-head');
  const panelTitle = el('h2');
  panelTitle.tabIndex = -1;
  const close = button('Fechar');
  const panel = el('div', 'dossier-panel-body');
  const panelStatus = notice();
  panelHeader.append(panelTitle, close);
  dialog.append(panelHeader, panelStatus, panel);
  app.append(header, card, dialog);
  root.replaceChildren(app);

  function showFailure(target, failure) {
    if (failure.status === 401) onAuthError?.(failure);
    if (!active) return;
    setNotice(target, failure.message || 'Não foi possível concluir esta ação.', true);
  }

  function wipePanel() {
    panelVersion++;
    panelCleanup?.();
    panelCleanup = null;
    panel.replaceChildren();
    setNotice(panelStatus, '');
  }

  function showPanel(title, opener, { fees = false, preview = false } = {}) {
    const alreadyOpen = dialog.open;
    if (!alreadyOpen) returnFocus = opener || document.activeElement;
    wipePanel();
    feeStep = fees;
    dialog.classList.toggle('dossier-dialog-preview', preview);
    panelTitle.textContent = title;
    dialog.setAttribute('aria-label', title);
    if (!alreadyOpen) dialog.showModal();
    panel.scrollTop = 0;
    panelTitle.focus();
    return panelVersion;
  }

  const present = (version) => active && dialog.open && panelVersion === version;
  function changeBusy(value) {
    busy = value;
    close.disabled = value;
    dialog.setAttribute('aria-busy', String(value));
  }

  close.addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    wipePanel();
    if (returnFocus?.isConnected) returnFocus.focus();
  });

  function renderRow(dossier) {
    const item = el('article', 'dossier-list-item');
    const title = el('div');
    const origin = [dossier.empresa?.cnpj && documentLabel(dossier.empresa.cnpj), dossier.protocolo, dossier.empresa?.regimeTributario]
      .filter(Boolean).join(' · ');
    title.append(el('h3', '', dossier.empresa?.nome || 'Empresa'), el('p', 'dossier-muted', origin));
    const meta = el('div', 'dossier-list-meta');
    if (canFeesRead && dossier.feesStatus) meta.append(badge(dossier.feesStatus));
    meta.append(el('span', 'dossier-muted', dateLabel(dossier.createdAt)));
    const open = button('Abrir dossiê');
    open.setAttribute('aria-label', 'Abrir dossiê de ' + (dossier.empresa?.nome || dossier.protocolo || 'empresa'));
    open.addEventListener('click', () => { void openDetail(dossier.id, open); });
    item.append(title, meta, open);
    return item;
  }

  async function loadList(page = currentPage) {
    const version = ++listVersion;
    prev.disabled = next.disabled = true;
    rows.replaceChildren();
    rows.setAttribute('aria-busy', 'true');
    setNotice(listStatus, 'Carregando dossiês…');
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      if (sector) params.set('sector', sector);
      if (search.control.value.trim()) params.set('q', search.control.value.trim());
      if (archived.control.value) params.set('archived', '1');
      const result = await request('/dossiers?' + params);
      if (!active || version !== listVersion) return;
      const { items = [], total, hasMore } = result;
      currentPage = result.page ?? page;
      rows.append(...items.map(renderRow));
      setNotice(listStatus, items.length ? '' : 'Nenhum dossiê encontrado.');
      footer.hidden = !items.length && currentPage === 1;
      prev.disabled = currentPage <= 1;
      next.disabled = !(hasMore ?? (Number.isFinite(total) ? total > currentPage * pageSize : items.length === pageSize));
      pageText.textContent = 'Página ' + currentPage + (Number.isFinite(total) ? ' · ' + total + (total === 1 ? ' dossiê' : ' dossiês') : '');
    } catch (failure) {
      if (active && version === listVersion) showFailure(listStatus, failure);
    } finally {
      if (active && version === listVersion) rows.setAttribute('aria-busy', 'false');
    }
  }

  searchForm.addEventListener('submit', (event) => { event.preventDefault(); clearTimeout(filterTimer); void loadList(1); });
  search.control.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { void loadList(1); }, 350);
  });
  archived.control.addEventListener('change', () => { clearTimeout(filterTimer); void loadList(1); });
  prev.addEventListener('click', () => { void loadList(Math.max(currentPage - 1, 1)); });
  next.addEventListener('click', () => { void loadList(currentPage + 1); });

  function inWorkspace(path) {
    return sector ? path + '?sector=' + encodeURIComponent(sector) : path;
  }

  function openForm(dossier, opener) {
    const title = dossier ? 'Editar dossiê' : 'Novo dossiê';
    const version = showPanel(title, opener);
    panelCleanup = mountDossierForm(panel, {
      initial: dossier,
      lockCompany: Boolean(dossier),
      submit: async (data) => {
        changeBusy(true);
        try {
          const path = dossier ? '/dossiers/' + encodeURIComponent(dossier.id) : '/dossiers';
          const body = { dossier: data };
          if (dossier) body.revision = dossier.revision;
          return await request(inWorkspace(path), { method: dossier ? 'PUT' : 'POST', body });
        } catch (failure) {
          if (failure.status === 401) onAuthError?.(failure);
          throw failure;
        } finally {
          if (present(version)) changeBusy(false);
        }
      },
      onSuccess(result) {
        void loadList(dossier ? currentPage : 1);
        const next = { fees: !dossier && canFees };
        const message = dossier ? 'Alterações salvas.'
          : next.fees ? 'Dossiê salvo. Cadastre os honorários quando estiver pronto.' : 'Dossiê salvo.';
        if (result.dossier?.id) {
          showPanel('Dossiê', opener, { ...next, preview: true });
          drawDetail(result.dossier, message);
        } else if (result.id || dossier?.id) {
          void openDetail(result.id || dossier.id, opener, { ...next, message });
        } else dialog.close();
      },
    });
  }

  create.addEventListener('click', () => openForm(undefined, create));

  function recipientStatus(recipient) {
    return (recipient.status === 'sent' ? 'Aceito pelo SMTP' : statusLabels[recipient.status] || 'Pendente')
      + (recipient.sentAt ? ' · ' + dateLabel(recipient.sentAt) : '');
  }

  function renderFees(dossier) {
    const fees = dossier.honorarios || {};
    const status = dossier.feesStatus;
    const section = el('section', 'dossier-fees');
    const heading = el('div', 'dossier-section-head');
    const title = el('h3', '', 'Honorários');
    title.tabIndex = -1;
    heading.append(title, badge(status));
    section.append(heading);
    if (fees.version) {
      const table = el('dl', 'dossier-values dossier-fee-values');
      const money = cents => Number.isSafeInteger(cents) ? currency.format(cents / 100) : '—';
      const start = fees.inicioCobranca ? fees.inicioCobranca.split('-').reverse().join('/') : '—';
      const values = [
        ['Mensalidade', money(fees.valorMensalCentavos)],
        ['Implantação', money(fees.valorImplantacaoCentavos)],
        ['Dia de vencimento', fees.vencimentoDia || '—'],
        ['Início da cobrança', start],
        ['Versão', fees.version],
        ['Condições e observações', fees.observacoes || '—'],
      ];
      for (const [label, value] of values) {
        const row = el('div', label === 'Condições e observações' ? 'dossier-value-wide' : '');
        row.append(el('dt', '', label), el('dd', '', String(value)));
        table.append(row);
      }
      section.append(table);
    }
    const recipients = dossier.feeRecipients || [];
    if (recipients.length) {
      section.append(el('p', 'dossier-muted', 'Destinatários autorizados'));
      const list = el('ul', 'dossier-recipients');
      for (const recipient of recipients) {
        const row = el('li');
        row.append(el('strong', '', recipient.name), el('span', '', recipient.email), el('small', '', recipientStatus(recipient)));
        list.append(row);
      }
      section.append(list);
    }
    const canSend = canFees && !dossier.archivedAt && ['saved', 'failed'].includes(status) && recipients.length > 0;
    const label = ['queued', 'sending'].includes(status) ? 'Envio em andamento.'
      : status === 'uncertain' ? 'O último envio está sem confirmação. Verifique o recebimento antes de iniciar outra versão.'
        : status === 'sent' ? 'O SMTP aceitou a mensagem dos destinatários. Consulte o resultado individual acima.'
          : status === 'review' ? 'O dossiê mudou. Confira e salve uma nova versão dos honorários antes de enviar.' : '';
    if (label) section.append(el('p', 'dossier-message', label));
    if (canFees && !dossier.archivedAt && ['saved', 'failed'].includes(status) && !recipients.length) {
      section.append(el('p', 'dossier-muted', 'Nenhum destinatário autorizado da Diretoria para o envio.'));
    }
    if (canSend) {
      const send = button(status === 'failed' ? 'Tentar destinatários pendentes' : 'Enviar honorários', true);
      send.addEventListener('click', () => {
        if (send.dataset.confirm !== 'yes') {
          send.dataset.confirm = 'yes';
          send.textContent = 'Confirmar envio';
          setNotice(panelStatus, 'Confira os destinatários acima e confirme para iniciar o envio.');
          return;
        }
        void feeAction(dossier, '/fees/send', 'POST', { revision: dossier.revision }, send);
      });
      section.append(send);
    }
    if (['queued', 'sending', 'uncertain', 'sent', 'failed'].includes(status)) {
      const refresh = button('Atualizar situação');
      refresh.addEventListener('click', () => {
        void openDetail(dossier.id, undefined, { fees: feeStep });
      });
      section.append(refresh);
    }
    if (dossier.feeHistory?.length) {
      const history = el('details', 'dossier-summary-section');
      const entries = el('ul', 'dossier-history');
      entries.append(...dossier.feeHistory.map(record => el('li', '', 'Versão ' + record.version + ' · ' + dateLabel(record.savedAt))));
      history.append(el('summary', '', 'Histórico dos honorários'), entries);
      section.append(history);
    }
    if (!canFees || dossier.archivedAt || ['queued', 'sending'].includes(status)) return section;
    const editor = el('details', 'dossier-summary-section');
    editor.open = !fees.version || status === 'review';
    editor.append(el('summary', '', fees.version ? 'Alterar honorários' : 'Cadastrar honorários'));
    const amounts = (key, legacy) => Number.isSafeInteger(fees[key]) ? (fees[key] / 100).toFixed(2) : (fees[legacy] ?? '');
    const form = el('form', 'dossier-fee-form');
    const fields = el('div', 'dossier-fields');
    const monthly = input('Honorário mensal (R$)', {
      type: 'number', name: 'valorMensal', value: amounts('valorMensalCentavos', 'valorMensal'), required: true,
      min: '0.01', max: '100000000', step: '0.01', inputMode: 'decimal',
    });
    const setup = input('Implantação (R$)', {
      type: 'number', name: 'valorImplantacao', value: amounts('valorImplantacaoCentavos', 'valorImplantacao'),
      min: '0', max: '100000000', step: '0.01', inputMode: 'decimal',
    });
    const due = input('Dia de vencimento', { type: 'number', name: 'vencimentoDia', value: fees.vencimentoDia || '', required: true, min: '1', max: '31' });
    const start = input('Início da cobrança', { type: 'date', name: 'inicioCobranca', value: fees.inicioCobranca || '' });
    const observations = input('Condições e observações', {
      type: 'textarea', name: 'observacoes', value: fees.observacoes || '', maxLength: 2000, rows: 3,
    });
    observations.wrapper.classList.add('dossier-field-wide');
    fields.append(monthly.wrapper, setup.wrapper, due.wrapper, start.wrapper, observations.wrapper);
    const submit = button('Salvar sem enviar', true, true);
    form.append(fields, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      data.revision = dossier.revision;
      void feeAction(dossier, '/fees', 'PUT', data, submit);
    });
    editor.append(form);
    section.append(editor);
    return section;
  }

  function drawDetail(dossier, message = '') {
    const headings = el('header', 'dossier-detail-head');
    const description = el('p', 'dossier-muted dossier-detail-protocol', dossier.protocolo);
    if (dossier.archivedAt) description.append(' · Arquivado em ' + dateLabel(dossier.archivedAt));
    const actions = el('div', 'dossier-actions');
    const documentUrl = '/v1/platform/dossiers/' + encodeURIComponent(dossier.id) + '/document?view=1';
    const print = printButton();
    print.disabled = true;
    actions.append(print);
    const newTab = el('a', 'dossier-button', 'Abrir em nova aba');
    newTab.href = documentUrl;
    newTab.target = '_blank';
    newTab.rel = 'noopener noreferrer';
    actions.append(newTab);
    if (canCreate) {
      if (!dossier.archivedAt) {
        const edit = button('Editar dados');
        edit.addEventListener('click', () => openForm(dossier));
        actions.append(edit);
      }
      const archive = button(dossier.archivedAt ? 'Restaurar dossiê' : 'Arquivar dossiê');
      archive.addEventListener('click', () => {
        if (archive.dataset.confirm !== 'yes') {
          archive.dataset.confirm = 'yes';
          archive.textContent = dossier.archivedAt ? 'Confirmar restauração' : 'Confirmar arquivamento';
          return;
        }
        void recordAction(dossier, dossier.archivedAt ? '/restore' : '/archive', 'POST', { revision: dossier.revision }, archive,
          dossier.archivedAt ? 'Dossiê restaurado.' : 'Dossiê arquivado.');
      });
      actions.append(archive);
    }
    headings.append(description, actions);
    panelTitle.textContent = dossier.empresa?.nome || 'Dossiê';
    dialog.setAttribute('aria-label', 'Dossiê de ' + panelTitle.textContent);
    const preview = el('div', 'dossier-preview');
    const status = notice('Preparando o documento…');
    const frame = el('iframe', 'dossier-document');
    frame.title = 'Documento do dossiê';
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.hidden = true;
    frame.addEventListener('load', () => {
      if (!frame.isConnected) return;
      const available = Boolean(frame.contentDocument?.querySelector('main.sheet'));
      print.disabled = !available;
      frame.hidden = !available;
      setNotice(status, available ? '' : 'Não foi possível carregar a ficha. Tente abrir em nova aba.', !available);
    });
    print.addEventListener('click', () => {
      const documentWindow = frame.contentWindow;
      try {
        documentWindow.focus();
        documentWindow.print();
      } catch {
        newTab.click();
      }
    });
    frame.src = documentUrl;
    preview.append(status, frame);
    panel.replaceChildren(headings);
    const fees = canFeesRead && dossier.feesStatus ? renderFees(dossier) : null;
    if (fees) {
      const controls = el('div', 'dossier-preview-tabs');
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', 'Seções do dossiê');
      const documentTab = button('Documento');
      const feesTab = button('Honorários');
      controls.append(documentTab, feesTab);
      fees.classList.add('dossier-preview-fees');
      const selectFees = (value, focus = false) => {
        feeStep = value;
        preview.hidden = value;
        fees.hidden = !value;
        print.hidden = newTab.hidden = value;
        documentTab.setAttribute('aria-pressed', String(!value));
        feesTab.setAttribute('aria-pressed', String(value));
        if (focus && value) fees.querySelector('h3').focus();
      };
      documentTab.addEventListener('click', () => selectFees(false));
      feesTab.addEventListener('click', () => selectFees(true, true));
      panel.append(controls, fees);
      selectFees(feeStep, feeStep);
    }
    panel.append(preview);
    setNotice(panelStatus, message);
  }

  function feeAction(dossier, suffix, method, body, action) {
    return recordAction(dossier, suffix, method, body, action, method === 'PUT' ? 'Honorários salvos.' : 'Envio solicitado. Atualize para acompanhar.');
  }

  async function recordAction(dossier, suffix, method, body, action, success) {
    if (busy) return;
    const version = panelVersion;
    const text = action.textContent;
    changeBusy(true);
    action.disabled = true;
    action.textContent = 'Processando…';
    setNotice(panelStatus, '');
    try {
      const result = await request(inWorkspace('/dossiers/' + encodeURIComponent(dossier.id) + suffix), { method, body });
      if (!present(version)) return;
      drawDetail(result.dossier, success);
      void loadList();
    } catch (failure) {
      if (present(version)) showFailure(panelStatus, failure);
    } finally {
      if (present(version)) {
        changeBusy(false);
        action.disabled = false;
        action.textContent = text;
      }
    }
  }

  async function openDetail(id, opener, { message = '', fees = false } = {}) {
    const version = showPanel('Dossiê', opener, { fees, preview: true });
    setNotice(panelStatus, 'Carregando dossiê…');
    try {
      const { dossier } = await request(inWorkspace('/dossiers/' + encodeURIComponent(id)));
      if (present(version)) drawDetail(dossier, message);
    } catch (failure) {
      if (present(version)) showFailure(panelStatus, failure);
    }
  }

  function renderLink(link, version, refresh) {
    const item = el('article', 'dossier-list-item');
    const title = el('div');
    const expired = Date.parse(link.expiresAt) <= Date.now();
    const reusable = link.mode === 'reusable';
    const state = link.revokedAt ? 'Revogado' : !reusable && link.usedAt ? 'Utilizado' : expired ? 'Expirado' : 'Ativo';
    title.append(el('h3', '', link.label || 'Link de preenchimento'),
      el('p', 'dossier-muted', link.companyCnpj ? 'CNPJ vinculado · ' + documentLabel(link.companyCnpj) : 'Sem empresa vinculada'));
    const count = link.submissionCount ?? (link.usedAt ? 1 : 0);
    const meta = el('div', 'dossier-link-meta');
    meta.append(el('p', 'dossier-muted', reusable ? 'Vários preenchimentos' : 'Uso único'),
      el('p', 'dossier-muted', state + ' · Validade ' + dateLabel(link.expiresAt)));
    if (count) meta.append(el('p', 'dossier-muted', count === 1 ? '1 dossiê enviado' : count + ' dossiês enviados'));
    item.append(title, meta);
    if (state === 'Ativo') {
      const revoke = button('Revogar link');
      revoke.addEventListener('click', async () => {
        if (busy || !present(version)) return;
        if (revoke.dataset.confirm !== 'yes') {
          revoke.dataset.confirm = 'yes';
          revoke.textContent = 'Confirmar revogação';
          return;
        }
        changeBusy(true);
        revoke.disabled = true;
        try {
          await request('/dossiers/links/' + encodeURIComponent(link.id), { method: 'DELETE' });
          if (present(version)) {
            setNotice(panelStatus, 'Link revogado.');
            await refresh();
          }
        } catch (failure) {
          if (present(version)) showFailure(panelStatus, failure);
        } finally {
          if (present(version)) {
            changeBusy(false);
            revoke.disabled = false;
          }
        }
      });
      item.append(revoke);
    }
    return item;
  }

  function openLinks() {
    const version = showPanel('Links de preenchimento', links);
    const form = el('form', 'dossier-link-form');
    const title = input('Identificação do link', { name: 'label', maxLength: 100, placeholder: 'Ex.: onboarding da empresa' });
    const company = input('Empresa vinculada', { type: 'select', name: 'companyCnpj', required: !allowUnboundLinks });
    const options = typeof companies === 'function' ? companies() : companies;
    company.control.append(new Option(allowUnboundLinks ? 'Sem empresa vinculada' : 'Selecione uma empresa', ''));
    for (const item of options || []) {
      company.control.append(new Option(item.name + ' · ' + documentLabel(item.cnpj), item.cnpj));
    }
    const mode = input('Tipo de link', { type: 'select', name: 'mode' });
    mode.control.append(new Option('Uso único', 'single'), new Option('Vários preenchimentos', 'reusable'));
    const expiration = input('Validade (horas)', { type: 'number', name: 'expiresInHours', min: 1, max: 168, value: '24', required: true });
    const createLink = button('Gerar link', true, true);
    const fieldList = el('div', 'dossier-fields');
    fieldList.append(title.wrapper, company.wrapper, mode.wrapper, expiration.wrapper);
    form.append(fieldList, createLink);
    const secretZone = el('div', 'dossier-link-secret');
    const historyTitle = el('h3', '', 'Links gerados');
    const linkList = el('div', 'dossier-admin-list');
    panel.append(el('p', 'dossier-muted',
      'Compartilhe o link pelo celular para receber novos dossiês. O acesso é exclusivo para preenchimento e expira no prazo selecionado.'),
    form, secretZone, historyTitle, linkList);

    async function refresh() {
      try {
        const { items = [] } = await request('/dossiers/links');
        if (!present(version)) return;
        linkList.replaceChildren(...items.map(item => renderLink(item, version, refresh)));
        if (!items.length) linkList.append(notice('Nenhum link gerado.'));
      } catch (failure) {
        if (present(version)) showFailure(panelStatus, failure);
      }
    }
    void refresh();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const body = { mode: mode.control.value, expiresInHours: Number(expiration.control.value) };
      if (title.control.value.trim()) body.label = title.control.value.trim();
      if (company.control.value) body.companyCnpj = company.control.value;
      changeBusy(true);
      createLink.disabled = true;
      setNotice(panelStatus, '');
      try {
        const { path } = await request('/dossiers/links', { method: 'POST', body });
        if (!present(version)) return;
        const link = new URL(path, location.origin);
        if (link.origin !== location.origin || !/^\/dossie\/?$/.test(link.pathname) || !link.hash) throw new Error('O servidor não devolveu um link válido.');
        const secret = input('Link para compartilhar', { type: 'url', readOnly: true, value: link.href });
        const copy = button('Copiar link', true);
        copy.addEventListener('click', () => { void copyLink(secret.control, panelStatus); });
        secretZone.replaceChildren(secret.wrapper, copy);
        secret.control.focus();
        secret.control.select();
        await refresh();
      } catch (failure) {
        if (present(version)) showFailure(panelStatus, failure);
      } finally {
        if (present(version)) {
          changeBusy(false);
          createLink.disabled = false;
        }
      }
    });
  }

  links.addEventListener('click', openLinks);
  void loadList(1);
  return () => {
    active = false;
    clearTimeout(filterTimer);
    wipePanel();
    returnFocus = null;
    if (dialog.open) dialog.close();
    root.replaceChildren();
  };
}
