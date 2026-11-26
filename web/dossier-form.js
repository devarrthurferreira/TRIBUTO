const regimes = ['Simples Nacional', 'Lucro Presumido', 'Lucro Real', 'MEI', 'Imune/Isenta', 'Outro'];
const origins = ['Giants', 'Indicação', 'Ex-Cliente', 'Whatsapp', 'Instagram', 'Outros'];
const states = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const sectors = [
  ['societario', 'Societário'], ['pessoal', 'Pessoal'], ['fiscal', 'Fiscal'], ['contabil', 'Contábil'],
  ['sucessoCliente', 'Sucesso do Cliente'], ['programacao', 'Programação'], ['diretoria', 'Diretoria'],
];
const yesNo = ['nao', 'sim'];

export function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function button(label, primary = false, submit = false) {
  const node = el('button', 'dossier-button' + (primary ? ' dossier-button-primary' : ''), label);
  node.type = submit ? 'submit' : 'button';
  return node;
}

export function documentLabel(value) {
  const text = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return text.length === 14 ? text.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5') : value || '—';
}

function progressiveCnpj(value) {
  const text = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
  return text.replace(/^(.{2})(?=.)/, '$1.').replace(/^(\S{6})(?=.)/, '$1.')
    .replace(/^(\S{10})(?=.)/, '$1/').replace(/^(\S{15})(?=.)/, '$1-');
}

const field = (key, label, properties) => ({ key, label, ...properties });
const select = (key, label, options, properties) => field(key, label, { type: 'select', options, ...properties });
const area = (key, label, properties) => field(key, label, { type: 'textarea', max: 4000, wide: true, ...properties });
const choice = (key, label, { required = false, labels = ['Não', 'Sim'] } = {}) =>
  field(key, label, { type: 'choice', options: yesNo.map((value, index) => [value, labels[index]]),
    defaultValue: required ? '' : 'nao', required });
const cnpj = (key, label, properties) => field(key, label, { type: 'cnpj', max: 18, placeholder: '00.000.000/0000-00', ...properties });
const federal = (key, label, required = false) => select(key, label, states, { required });
const repeater = (key, label, singular, fields, options) => ({ key, label, type: 'repeater', singular, fields, ...options });

export const dossierSections = [
  {
    title: 'Dados da empresa', stepLabel: 'Dados da empresa',
    description: 'Identifique a empresa e informe os dados de início do atendimento.',
    fields: [
      field('empresa.nome', 'Empresa', { required: true }), select('empresa.regimeTributario', 'Regime tributário', regimes, { required: true }),
      cnpj('empresa.cnpj', 'CNPJ', { required: true }), field('empresa.cidade', 'Cidade', { required: true, max: 100 }),
      federal('empresa.estado', 'Estado', true), field('grupo', 'Grupo pertencente', { required: true }),
      field('dataInicio', 'Data de início', { type: 'date', required: true }), choice('retificacao', 'Terá retificação?', { required: true }),
      area('mesesRetificacao', 'Meses da retificação', { required: true, when: 'retificacao', reviewWhenHidden: true,
        placeholder: 'Ex.: Janeiro/2026, fevereiro/2026' }),
    ],
  },
  {
    title: 'Estrutura empresarial', stepLabel: 'Filiais', reviewTitle: 'Filiais e coligadas',
    description: 'Informe se a empresa possui filiais ou coligadas e registre seus dados.',
    fields: [
      choice('possuiFiliais', 'Possui filiais ou coligadas?', { labels: ['Não possui', 'Sim, possui'] }),
      field('quantidadeFiliais', 'Quantidade total informada', { type: 'number', min: 0, max: 9999999, when: 'possuiFiliais', reviewLabel: 'Quantidade' }),
      repeater('filiais', 'Filiais e coligadas', 'Filial ou coligada', [
        field('tipo', 'Coligada / agregada', { type: 'classification', defaultValue: 'filial', wide: true }),
        field('nome', 'Nome da unidade'), cnpj('cnpj', 'CNPJ da unidade', { pendingAllowed: true,
          help: 'Deixe o CNPJ em branco se a empresa estiver em constituição.' }),
        select('regimeTributario', 'Regime tributário', regimes, { required: true }),
        field('cidade', 'Cidade', { max: 100 }), federal('estado', 'Estado'),
      ], { when: 'possuiFiliais', required: true, max: 80, description: 'Indique as filiais ou coligadas abaixo.' }),
    ],
  },
  {
    title: 'Contatos e negociação', stepLabel: 'Contatos', reviewTitle: 'Contatos e origem',
    description: 'Informe os contatos da empresa, a negociação e a origem.',
    fields: [
      repeater('contatos', 'Contatos', 'Contato', [
        field('nome', 'Nome do contato'), field('papel', 'Função na empresa'),
        field('telefone', 'Telefone', { type: 'tel', max: 40 }), field('email', 'E-mail', { type: 'email', max: 254 }),
        field('setor', 'Setor'),
      ], { max: 40, starter: true, description: 'Nome, função, telefone, e-mail e setor.' }),
      field('negociacaoCom', 'Com quem foi feita a negociação?', { wide: true }),
      choice('indicacao.temIndicacao', 'Indicação?'),
      field('indicacao.nomeIndicador', 'Nome do indicador', { required: true, when: 'indicacao.temIndicacao' }),
      select('origem', 'Origem', origins, { required: true }),
    ],
  },
  {
    title: 'Informações gerais', stepLabel: 'Perfil',
    description: 'Contexto comercial, atuação e recorrências.',
    fields: [
      field('informacoesGerais.faturamentoMedioMensal', 'Faturamento médio mensal', { placeholder: 'R$ 0,00', max: 48, inputMode: 'decimal' }),
      field('informacoesGerais.setorAtuacao', 'Setor de atuação'),
      field('informacoesGerais.atuacaoEstados', 'Atuação em quais estados?', { placeholder: 'Ex.: MG, RJ, SP', wide: true }),
      choice('informacoesGerais.possuiEcommerce', 'Possui e-commerce?'),
      choice('informacoesGerais.licitacoesContratosPublicos', 'Atua com licitações ou contratos públicos?'),
      choice('informacoesGerais.auditoriasRecorrentes', 'Há auditorias recorrentes?'),
    ],
  },
  {
    title: 'Informações operacionais', stepLabel: 'Operação',
    description: 'Sistemas, balanço, funcionários, bancos e regimes.',
    fields: [
      area('informacoesOperacionais.sistemasUtilizados', 'Sistemas operacionais e financeiros'),
      field('informacoesOperacionais.periodicidadeBalanco', 'Periodicidade de entrega do balanço'),
      field('informacoesOperacionais.numeroFuncionarios', 'Número de funcionários', { type: 'number', min: 0, max: 9999999 }),
      choice('informacoesOperacionais.separacaoCentroCusto', 'Possui separação por centro de custo?'),
      area('informacoesOperacionais.contasBancarias', 'Quantas contas bancárias possui? Quais bancos?'),
      choice('informacoesOperacionais.regimeEspecial', 'Possui algum regime especial?'),
      area('informacoesOperacionais.parcelamentosEmprestimos', 'Parcelamentos e empréstimos ativos'),
    ],
  },
  {
    title: 'Troca de contabilidade e promessas', stepLabel: 'Contexto', reviewTitle: 'Motivo e promessas',
    description: 'Registre as dores, expectativas e compromissos assumidos.',
    fields: [
      area('motivoTrocaContabilidade', 'Motivo da troca de contabilidade'),
      repeater('promessasRealizadas', 'Promessas realizadas', 'Tópico', [field('text', 'Promessa', { max: 1000, wide: true })], { asText: true, max: 60, starter: true }),
    ],
  },
  {
    title: 'Considerações e dúvidas por setor', stepLabel: 'Setores', reviewTitle: 'Setores',
    description: 'Separe os pontos identificados nas conversas.',
    fields: [
      ...sectors.map(([key, label]) => area('consideracoesSetores.' + key, label)),
      repeater('topicosConsideracoesSetores', 'Tópicos adicionais por setor', 'Tópico', [
        select('setor', 'Setor', [...sectors.map(([, label]) => label), 'Outros']), area('descricao', 'Consideração ou pendência'),
      ], { max: 60, starter: true, description: 'Inclua os pontos e indique o setor responsável.' }),
      area('demaisObservacoes', 'Demais observações e comentários'),
    ],
  },
];

function atPath(value, path) {
  return path.split('.').reduce((target, part) => target?.[part], value);
}

function setPath(value, path, entry) {
  const parts = path.split('.');
  const key = parts.pop();
  const parent = parts.reduce((target, part) => target[part] ||= {}, value);
  parent[key] = entry;
}

function formatValue(value, definition) {
  if (value === '' || value == null) return '';
  if (definition.type === 'cnpj') {
    if (definition.pendingAllowed && String(value).replace(/[.\s/-]/g, '') === '00000000000000') return '';
    return documentLabel(value);
  }
  if (definition.type === 'classification') return affiliateLabel(value);
  if (definition.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('/');
  if (definition.type === 'choice') return value === true || value === 'sim' ? 'Sim' : 'Não';
  const match = definition.options?.find(option => Array.isArray(option) && option[0] === value);
  return String(match?.[1] ?? value);
}

function appendDescription(list, label, value, showMissing) {
  if (!value && !showMissing) return;
  const cell = el('div');
  cell.append(el('dt', '', label), el('dd', '', value || 'Não informado'));
  list.append(cell);
}

export function renderDossierData(dossier, { collapsed = false, showMissing = false } = {}) {
  const panel = el('div', 'dossier-summary');
  for (const section of dossierSections) {
    const content = el('dl', 'dossier-values');
    for (const definition of section.fields) {
      const visible = !definition.when || atPath(dossier, definition.when) === 'sim';
      if (!visible && !(showMissing && definition.reviewWhenHidden)) continue;
      const value = visible ? atPath(dossier, definition.key) : '';
      if (definition.type !== 'repeater') {
        appendDescription(content, definition.reviewLabel || definition.label, formatValue(value, definition), showMissing);
        continue;
      }
      if (showMissing && !value?.length) appendDescription(content, definition.label, '', true);
      for (const [index, row] of (value || []).entries()) {
        const group = el('div', 'dossier-value-wide');
        const children = el('dl', 'dossier-values');
        for (const entry of definition.fields) {
          const item = definition.asText ? row : repeatValue(row, entry);
          appendDescription(children, entry.type === 'classification' ? 'Tipo' : entry.label, formatValue(item, entry), showMissing);
        }
        if (!children.childElementCount) continue;
        const description = el('dd');
        description.append(children);
        group.append(el('dt', '', definition.singular + ' ' + (index + 1)), description);
        content.append(group);
      }
    }
    if (!content.childElementCount) continue;
    const block = el(collapsed ? 'details' : 'section', 'dossier-summary-section');
    block.append(el(collapsed ? 'summary' : 'h3', '', section.reviewTitle || section.title), content);
    panel.append(block);
  }
  return panel;
}

function makeChoice(definition, value) {
  const wrapper = el('fieldset', 'dossier-field dossier-choice');
  const legend = el('legend', '', definition.label);
  const options = el('div', 'dossier-choice-options');
  if (definition.required) legend.append(el('span', 'dossier-required', ' *'));
  const initial = value === true ? 'sim' : value === false ? 'nao' : value ?? definition.defaultValue;
  for (const [option, caption] of definition.options) {
    const label = el('label');
    const control = el('input');
    control.type = 'radio';
    control.name = definition.key;
    control.value = option;
    control.checked = option === initial;
    control.required = definition.required;
    label.append(control, el('span', '', caption));
    options.append(label);
  }
  wrapper.append(legend, options);
  return { wrapper, value: () => options.querySelector('input:checked')?.value || '' };
}

function affiliateLabel(value) {
  return value === 'coligada' ? 'Coligada / agregada' : 'Filial';
}

function makeClassification(definition, value) {
  const wrapper = el('div', 'dossier-field dossier-field-wide');
  const label = el('label', 'dossier-check');
  const control = el('input');
  control.type = 'checkbox';
  control.name = definition.key;
  control.value = 'coligada';
  control.checked = value === 'coligada';
  label.append(control, el('span', '', definition.label));
  wrapper.append(label, el('small', 'dossier-field-help', 'Desmarcado indica filial.'));
  return { wrapper, control, value: () => control.checked ? 'coligada' : 'filial' };
}

function repeatValue(data, definition) {
  if (definition.type === 'classification') return data?.[definition.key] || (data?.agregada ? 'coligada' : 'filial');
  return data?.[definition.key];
}

let controlId = 0;
function makeControl(definition, value) {
  if (definition.type === 'choice') return makeChoice(definition, value);
  if (definition.type === 'classification') return makeClassification(definition, value);
  const wrapper = el('div', 'dossier-field' + (definition.wide ? ' dossier-field-wide' : ''));
  const id = 'dossier-input-' + (++controlId);
  const label = el('label', '', definition.label);
  label.htmlFor = id;
  if (definition.required) label.append(el('span', 'dossier-required', ' *'));
  const type = definition.type || 'text';
  const control = el(type === 'select' || type === 'textarea' ? type : 'input');
  control.id = id;
  control.name = definition.key;
  if (type === 'select') {
    if (!definition.defaultValue) control.append(new Option('Selecione', ''));
    for (const option of definition.options) {
      const [key, name] = Array.isArray(option) ? option : [option, option === 'sim' ? 'Sim' : option === 'nao' ? 'Não' : option];
      control.append(new Option(name, key));
    }
  } else if (type === 'textarea') {
    control.rows = 3;
    control.maxLength = definition.max || 2000;
  } else {
    control.type = type === 'cnpj' ? 'text' : type;
    if (type === 'number') {
      control.min = definition.min ?? 0;
      control.max = definition.max ?? 1000000;
      control.step = 1;
    } else if (type === 'date') {
      control.min = '1000-01-01';
      control.max = '9999-12-31';
    } else control.maxLength = definition.max || 160;
    if (type === 'cnpj') {
      control.autocapitalize = 'characters';
      control.addEventListener('input', () => { control.value = progressiveCnpj(control.value); });
    }
  }
  if (definition.inputMode) control.inputMode = definition.inputMode;
  if (definition.placeholder) control.placeholder = definition.placeholder;
  control.required = Boolean(definition.required);
  const initial = value ?? definition.defaultValue ?? '';
  if (type === 'select' && initial && ![...control.options].some(option => option.value === initial)) {
    control.append(new Option(String(initial), initial));
  }
  control.value = type === 'cnpj' ? progressiveCnpj(initial) : initial;
  if (type === 'cnpj') {
    control.pattern = '[0-9A-Z]{2}\\.[0-9A-Z]{3}\\.[0-9A-Z]{3}/[0-9A-Z]{4}\\-[0-9]{2}';
    control.title = 'Informe o CNPJ completo, com os dois últimos caracteres numéricos.';
  }
  wrapper.append(label, control);
  if (definition.help) {
    const help = el('small', 'dossier-field-help', definition.help);
    help.id = id + '-help';
    control.setAttribute('aria-describedby', help.id);
    wrapper.append(help);
  }
  return { wrapper, control, value: () => control.value.trim() };
}

function makeRepeater(definition, initial) {
  const wrapper = el('fieldset', 'dossier-repeater dossier-field-wide');
  wrapper.append(el('legend', '', definition.label));
  if (definition.description) wrapper.append(el('p', 'dossier-field-help', definition.description));
  const list = el('div', 'dossier-repeat-list');
  const add = button('+ ' + definition.singular);
  const rows = [];
  const empty = el('p', 'dossier-muted', 'Nenhum registro adicionado.');
  wrapper.append(list, empty, add);
  const max = definition.max;

  function refresh() {
    empty.hidden = rows.length !== 0;
    add.disabled = rows.length >= max;
    for (const [index, row] of rows.entries()) {
      const type = row.classification?.value();
      const heading = type ? affiliateLabel(type) : definition.singular;
      row.caption.textContent = heading + ' ' + (index + 1);
      row.remove.setAttribute('aria-label', 'Remover ' + row.caption.textContent.toLocaleLowerCase('pt-BR'));
    }
  }

  function addRow(data = undefined, focus = false) {
    const box = el('section', 'dossier-repeat-row');
    const header = el('div', 'dossier-repeat-head');
    const caption = el('h4');
    const remove = button('Remover');
    const grid = el('div', 'dossier-fields');
    const values = definition.fields.map(entry => makeControl(entry, definition.asText ? data : repeatValue(data, entry)));
    const classification = values[definition.fields.findIndex(entry => entry.type === 'classification')];
    const row = { box, caption, remove, values, classification };
    classification?.control.addEventListener('change', refresh);
    remove.addEventListener('click', () => {
      rows.splice(rows.indexOf(row), 1);
      box.remove();
      refresh();
      add.focus();
    });
    header.append(caption, remove);
    grid.append(...values.map(entry => entry.wrapper));
    box.append(header, grid);
    list.append(box);
    rows.push(row);
    refresh();
    if (focus) values.find(entry => entry !== classification)?.control.focus();
  }

  for (const value of (initial || []).slice(0, max)) addRow(value);
  if (!rows.length && definition.starter) addRow();
  refresh();
  add.addEventListener('click', () => { if (rows.length < max) addRow(undefined, true); });
  return {
    wrapper,
    value() {
      return rows.map(({ values }) => {
        if (definition.asText) return values[0].value();
        return Object.fromEntries(definition.fields.map(({ key }, index) => [key, values[index].value()]));
      }).filter(value => typeof value === 'string' ? value : Object.entries(value).some(([key, entry]) => key !== 'tipo' && entry));
    },
    reportMissing() { add.focus(); },
  };
}

export function mountDossierForm(root, { initial = {}, lockCompany = false, submit, submitLabel = 'Salvar dossiê', onSuccess }) {
  let active = true;
  let submitting = false;
  let step = 0;
  let reached = 0;
  const elements = new Map();
  const progress = el('nav', 'dossier-progress');
  progress.setAttribute('aria-label', 'Etapas do dossiê');
  const form = el('form', 'dossier-form');
  form.noValidate = true;
  form.autocomplete = 'off';
  const error = el('p', 'dossier-message dossier-error');
  error.hidden = true;
  error.setAttribute('role', 'alert');
  const foot = el('div', 'dossier-form-actions');
  const back = button('Voltar');
  const next = button('Continuar', true, true);
  foot.append(back, next);
  const review = el('div', 'dossier-review');
  const steps = [...dossierSections, { title: 'Revisão final', stepLabel: 'Revisão',
    description: 'Confira os dados antes de salvar. Os honorários são cadastrados em uma etapa separada.', fields: [] }];
  const tabs = steps.map(({ title }, index) => {
    const tab = button(String(index + 1).padStart(2, '0'));
    tab.title = title;
    tab.setAttribute('aria-label', 'Etapa ' + (index + 1) + ' · ' + title);
    tab.addEventListener('click', () => { if (!submitting && index <= reached) showStep(index); });
    progress.append(tab);
    return tab;
  });
  const pages = steps.map((section, index) => {
    const page = el('section', 'dossier-step');
    const header = el('div', 'dossier-step-heading');
    const title = el('h2', '', section.title);
    title.tabIndex = -1;
    header.append(el('span', 'dossier-step-index', 'Etapa ' + String(index + 1).padStart(2, '0') + ' · ' + section.stepLabel), title,
      el('p', 'dossier-muted', section.description));
    page.append(header);
    if (index === steps.length - 1) {
      page.append(review);
    } else {
      const grid = el('div', 'dossier-fields');
      for (const definition of section.fields) {
        const value = atPath(initial, definition.key);
        const entry = definition.type === 'repeater' ? makeRepeater(definition, value) : makeControl(definition, value);
        if (lockCompany && definition.key === 'empresa.cnpj') entry.control.readOnly = true;
        elements.set(definition.key, { ...entry, definition });
        grid.append(entry.wrapper);
      }
      page.append(grid);
    }
    form.append(page);
    return { page, title };
  });
  form.append(error, foot);
  root.replaceChildren(progress, form);

  function conditionallyShow() {
    for (const { definition, wrapper } of elements.values()) {
      if (!definition.when) continue;
      const visible = elements.get(definition.when).value() === 'sim';
      wrapper.hidden = !visible;
    }
  }

  function collect() {
    const payload = {};
    for (const [key, entry] of elements) {
      if (!entry.wrapper.hidden) setPath(payload, key, entry.value());
    }
    if (payload.possuiFiliais !== 'sim') {
      payload.filiais = [];
      payload.quantidadeFiliais = 0;
    } else if (!payload.quantidadeFiliais) payload.quantidadeFiliais = payload.filiais.length;
    return payload;
  }

  function feedback(message = '') {
    error.textContent = message;
    error.hidden = !message;
  }

  function showStep(index, focus = true) {
    step = index;
    pages.forEach(({ page }, current) => { page.hidden = current !== index; });
    tabs.forEach((tab, current) => {
      tab.disabled = current > reached;
      if (current === index) tab.setAttribute('aria-current', 'step');
      else tab.removeAttribute('aria-current');
    });
    back.hidden = index === 0;
    next.textContent = index === steps.length - 1 ? submitLabel : 'Continuar';
    if (index === steps.length - 1) review.replaceChildren(renderDossierData(collect(), { showMissing: true }));
    feedback();
    if (focus) pages[index].title.focus();
  }

  function validatePage(index) {
    if (index === steps.length - 1) return true;
    for (const definition of steps[index].fields) {
      const entry = elements.get(definition.key);
      if (entry.wrapper.hidden) continue;
      if (definition.type === 'repeater' && definition.required && !entry.value().length) {
        if (index !== step) showStep(index);
        feedback('Adicione pelo menos uma filial ou coligada.');
        entry.reportMissing();
        return false;
      }
      for (const control of entry.wrapper.querySelectorAll('input, select, textarea')) {
        if (!control.validity.valid || (control.required && !control.value.trim())) {
          if (index !== step) showStep(index);
          feedback('Confira os campos obrigatórios e o formato das informações desta etapa.');
          control.focus();
          control.reportValidity();
          return false;
        }
      }
    }
    return true;
  }

  function busy(value) {
    submitting = value;
    form.setAttribute('aria-busy', String(value));
    back.disabled = next.disabled = value;
    for (const [index, tab] of tabs.entries()) tab.disabled = value || index > reached;
    if (value) next.textContent = 'Salvando…';
    else next.textContent = step === steps.length - 1 ? submitLabel : 'Continuar';
  }

  form.addEventListener('change', conditionallyShow);
  back.addEventListener('click', () => { if (!submitting) showStep(step - 1); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || !validatePage(step)) return;
    if (step < steps.length - 1) {
      reached = Math.max(reached, step + 1);
      showStep(step + 1);
      return;
    }
    for (let index = 0; index < steps.length - 1; index++) { if (!validatePage(index)) return; }
    busy(true);
    feedback();
    try {
      const result = await submit(collect());
      if (active) onSuccess?.(result);
    } catch (failure) {
      if (active) feedback(failure.message || 'Não foi possível salvar o dossiê. Tente de novo.');
    } finally {
      if (active) busy(false);
    }
  });

  conditionallyShow();
  showStep(0, false);
  return () => { active = false; root.replaceChildren(); };
}
