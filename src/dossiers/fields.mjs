import { ApiError } from '../api/validation.mjs';
import { CLIENT_STATES } from '../clients/profile-fields.mjs';
import { validCnpj } from '../platform/brazilian-documents.mjs';

const states = new Set(CLIENT_STATES);
const longText = 4_000;
const sectorKeys = ['societario', 'pessoal', 'fiscal', 'contabil', 'sucessoCliente', 'programacao', 'diretoria'];

function invalid(message, code = 'DOSSIER_INPUT') {
  throw new ApiError(400, code, message);
}

function entry(value, label, optional = false) {
  if (optional && value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Revise ' + label + '.');
  return value;
}

function field(value, label, { max = 160, required = false, multiline = false } = {}) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') invalid('Revise o campo ' + label + '.');
  const trimmed = value.replace(/\r\n?/g, '\n').trim();
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (required && !trimmed) invalid('Preencha o campo ' + label + '.');
  if (trimmed.length > max || controls.test(trimmed)) invalid('Revise o campo ' + label + '.');
  return trimmed;
}

function multiline(value, label, required = false) {
  return field(value, label, { max: longText, multiline: true, required });
}

function yesNo(value, label) {
  if (value === true || value === 'sim') return 'sim';
  if (value === false || value == null || value === '' || value === 'nao') return 'nao';
  invalid('Revise o campo ' + label + '.');
}

function dateField(value, label, { required = false, code } = {}) {
  if (!required && (value == null || value === '')) return '';
  if (typeof value !== 'string') invalid('Informe uma data válida para ' + label + '.', code);
  const trimmed = value.trim();
  const date = new Date(trimmed + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || trimmed < '1000-01-01'
      || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) {
    invalid('Informe uma data válida para ' + label + '.', code);
  }
  return trimmed;
}

function cnpjField(value, label, required) {
  const raw = field(value, label, { required, max: 24 }).toUpperCase();
  const clean = raw.replace(/[.\s/-]/g, '');
  if ((required || clean) && !validCnpj(clean)) invalid('Informe um ' + label + ' válido.');
  return clean;
}

function company(input, required = false) {
  const data = entry(input, required ? 'os dados da empresa' : 'os dados da filial ou coligada');
  const estado = field(data.estado, 'Estado', { required, max: 2 }).toUpperCase();
  if (estado && !states.has(estado)) invalid('Selecione um estado brasileiro.');
  return {
    nome: field(data.nome, 'Nome da empresa', { required }),
    regimeTributario: field(data.regimeTributario, 'Regime tributário', { required, max: 80 }),
    cnpj: cnpjField(data.cnpj, 'CNPJ', required),
    cidade: field(data.cidade, 'Cidade', { required, max: 100 }),
    estado,
  };
}

function list(input, label, maximum, normalize) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > maximum) invalid('Revise os registros de ' + label + '.');
  return input.map(normalize).filter(Boolean);
}

function affiliate(input, index) {
  const data = company(input);
  if (!Object.values(data).some(Boolean)) return null;
  if (!data.regimeTributario) invalid('Informe o regime tributário da filial ou coligada ' + (index + 1) + '.');
  if (input.tipo != null && !['', 'filial', 'coligada'].includes(input.tipo)) invalid('Revise o tipo da filial ou coligada.');
  return { tipo: input.tipo === 'coligada' || input.agregada === true ? 'coligada' : 'filial', ...data };
}

function contact(input) {
  const data = entry(input, 'os dados de contato');
  const email = field(data.email, 'E-mail de contato', { max: 254 });
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) invalid('Informe um e-mail de contato válido.');
  const result = {
    nome: field(data.nome, 'Nome de contato'),
    papel: field(data.papel, 'Função de contato'),
    telefone: field(data.telefone, 'Telefone de contato', { max: 40 }),
    email,
    setor: field(data.setor, 'Setor de contato'),
  };
  return Object.values(result).some(Boolean) ? result : null;
}

function sectorTopic(input) {
  const topic = entry(input, 'o tópico por setor');
  const setor = field(topic.setor, 'Setor do tópico', { max: 80 });
  const descricao = multiline(topic.descricao, 'Descrição do tópico');
  return setor || descricao ? { setor, descricao } : null;
}

function count(value, label, fallback = 0, preserveString = false) {
  if (value == null || value === '') return fallback;
  if (!['number', 'string'].includes(typeof value) || !/^\d{1,7}$/.test(String(value))) {
    invalid('Revise o campo ' + label + '.');
  }
  return preserveString ? String(value) : Number(value);
}

export function normalizeDossier(input) {
  const data = entry(input, 'os dados do dossiê');
  const retificacao = yesNo(data.retificacao, 'Retificação');
  const possuiFiliais = yesNo(data.possuiFiliais, 'Filiais e coligadas');
  const filiais = possuiFiliais === 'sim' ? list(data.filiais, 'filiais e coligadas', 80, affiliate) : [];
  if (possuiFiliais === 'sim' && !filiais.length) invalid('Informe ao menos uma filial ou coligada.');
  const indicacao = entry(data.indicacao, 'os dados da indicação', true);
  const temIndicacao = yesNo(indicacao.temIndicacao, 'Indicação');
  const geral = entry(data.informacoesGerais, 'as informações gerais', true);
  const operacao = entry(data.informacoesOperacionais, 'as informações operacionais', true);
  const setores = entry(data.consideracoesSetores, 'as considerações por setor', true);

  return {
    dataInicio: dateField(data.dataInicio, 'o início', { required: true }),
    retificacao,
    mesesRetificacao: retificacao === 'sim' ? multiline(data.mesesRetificacao, 'Meses da retificação', true) : '',
    grupo: field(data.grupo, 'Grupo', { required: true }),
    empresa: company(data.empresa, true),
    possuiFiliais,
    quantidadeFiliais: filiais.length ? count(data.quantidadeFiliais, 'Quantidade de filiais', filiais.length) || filiais.length : 0,
    filiais,
    contatos: list(data.contatos, 'contatos', 40, contact),
    negociacaoCom: field(data.negociacaoCom, 'Negociação realizada com'),
    indicacao: {
      temIndicacao,
      nomeIndicador: temIndicacao === 'sim' ? field(indicacao.nomeIndicador, 'Nome do indicador', { required: true }) : '',
    },
    origem: field(data.origem, 'Origem', { required: true, max: 80 }),
    informacoesGerais: {
      faturamentoMedioMensal: field(geral.faturamentoMedioMensal, 'Faturamento médio mensal', { max: 48 }),
      setorAtuacao: field(geral.setorAtuacao, 'Setor de atuação'),
      atuacaoEstados: field(geral.atuacaoEstados, 'Estados de atuação'),
      possuiEcommerce: yesNo(geral.possuiEcommerce, 'E-commerce'),
      licitacoesContratosPublicos: yesNo(geral.licitacoesContratosPublicos, 'Licitações e contratos públicos'),
      auditoriasRecorrentes: yesNo(geral.auditoriasRecorrentes, 'Auditorias recorrentes'),
    },
    informacoesOperacionais: {
      sistemasUtilizados: multiline(operacao.sistemasUtilizados, 'Sistemas utilizados'),
      periodicidadeBalanco: field(operacao.periodicidadeBalanco, 'Periodicidade do balanço'),
      numeroFuncionarios: count(operacao.numeroFuncionarios, 'Número de funcionários', '', true),
      separacaoCentroCusto: yesNo(operacao.separacaoCentroCusto, 'Centro de custo'),
      contasBancarias: multiline(operacao.contasBancarias, 'Contas bancárias'),
      regimeEspecial: yesNo(operacao.regimeEspecial, 'Regime especial'),
      parcelamentosEmprestimos: multiline(operacao.parcelamentosEmprestimos, 'Parcelamentos e empréstimos'),
    },
    motivoTrocaContabilidade: multiline(data.motivoTrocaContabilidade, 'Motivo da troca de contabilidade'),
    promessasRealizadas: list(data.promessasRealizadas, 'promessas', 60, value => field(value, 'Promessa', { max: 1_000 })),
    consideracoesSetores: Object.fromEntries(sectorKeys.map(key => [key, multiline(setores[key], 'Considerações por setor')])),
    topicosConsideracoesSetores: list(data.topicosConsideracoesSetores, 'tópicos por setor', 60, sectorTopic),
    demaisObservacoes: multiline(data.demaisObservacoes, 'Demais observações'),
  };
}

const feeError = 'DOSSIER_FEES';
const feeFields = new Set(['valorMensal', 'valorImplantacao', 'vencimentoDia', 'inicioCobranca', 'observacoes', 'revision', 'policyVersion']);

function money(value, label, optional = false) {
  if (optional && (value == null || value === '')) return 0;
  const match = ['number', 'string'].includes(typeof value) && /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) invalid(label + ': informe um valor com até duas casas decimais.', feeError);
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (cents < (optional ? 0 : 1) || cents > 10_000_000_000) invalid(label + ': informe um valor válido.', feeError);
  return cents;
}

export function normalizeFees(input) {
  const data = entry(input, 'os honorários');
  if (Object.keys(data).some(key => !feeFields.has(key))) invalid('Use somente os campos de honorários.', feeError);
  const { vencimentoDia, observacoes } = data;
  if (!['string', 'number'].includes(typeof vencimentoDia) || !/^\d{1,2}$/.test(String(vencimentoDia))
      || Number(vencimentoDia) < 1 || Number(vencimentoDia) > 31) {
    invalid('Informe um dia de vencimento entre 1 e 31.', feeError);
  }
  return {
    valorMensalCentavos: money(data.valorMensal, 'Honorário mensal'),
    valorImplantacaoCentavos: money(data.valorImplantacao, 'Implantação', true),
    vencimentoDia: Number(vencimentoDia),
    inicioCobranca: dateField(data.inicioCobranca, 'o início da cobrança', { code: feeError }),
    observacoes: field(observacoes, 'Condições e observações dos honorários', { max: 2_000, multiline: true }),
  };
}
