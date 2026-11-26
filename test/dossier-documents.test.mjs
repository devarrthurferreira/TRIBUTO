import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDossier, normalizeFees, renderDossierHtml, renderFeesMessage } from '../src/dossiers/documents.mjs';

function example() {
  return {
    dataInicio: '2026-12-01',
    empresa: { nome: ' Comércio A & B <script> ', regimeTributario: 'Simples Nacional',
      cnpj: '12.abc.345/01de-35', cidade: 'Juiz de Fora', estado: ' mg ' },
    grupo: 'Grupo de teste',
    retificacao: 'sim',
    mesesRetificacao: 'Janeiro e fevereiro de 2026',
    possuiFiliais: 'sim',
    filiais: [{ agregada: true, nome: 'Unidade 2', regimeTributario: 'Lucro Real',
      cnpj: '11.222.333/0001-81', cidade: 'Petrópolis', estado: 'rj' }, {}],
    contatos: [{ nome: 'Contato teste', email: 'contato@example.invalid', telefone: '(32) 99999-0000', papel: 'Sócio', setor: 'Financeiro' }, {}],
    negociacaoCom: 'Contato teste',
    indicacao: { temIndicacao: 'sim', nomeIndicador: 'Pessoa de teste' },
    origem: 'Indicação',
    informacoesGerais: { faturamentoMedioMensal: 'R$ 100.000,00', setorAtuacao: 'Varejo', atuacaoEstados: 'MG e RJ', possuiEcommerce: true,
      licitacoesContratosPublicos: 'nao', auditoriasRecorrentes: 'nao' },
    informacoesOperacionais: { sistemasUtilizados: 'ERP de teste', periodicidadeBalanco: 'Trimestral', numeroFuncionarios: '12',
      separacaoCentroCusto: 'sim', contasBancarias: 'Banco de teste', regimeEspecial: 'nao', parcelamentosEmprestimos: 'Dado restrito da operação' },
    motivoTrocaContabilidade: 'Razão de teste',
    promessasRealizadas: ['', 'Planejamento fiscal'],
    consideracoesSetores: { fiscal: 'Revisar escriturações', sucessoCliente: 'Acompanhar transição' },
    topicosConsideracoesSetores: [{ setor: 'Tecnologia', descricao: 'Integração de teste' }, {}],
    demaisObservacoes: '<img onerror="alert(1)">\nNova linha',
    honorarios: { valorMensal: '999.99' },
    approval: { status: 'approved' },
  };
}

test('cadastro mantém os campos do formulário de referência e aceita CNPJ alfanumérico', () => {
  const normalized = normalizeDossier(example());
  assert.equal(normalized.empresa.nome, 'Comércio A & B <script>');
  assert.equal(normalized.empresa.cnpj, '12ABC34501DE35');
  assert.equal(normalized.empresa.estado, 'MG');
  assert.equal(normalized.filiais[0].tipo, 'coligada');
  assert.equal(normalized.filiais[0].cnpj, '11222333000181');
  assert.equal(normalized.quantidadeFiliais, 1);
  assert.equal(normalized.contatos.length, 1);
  assert.equal(normalized.informacoesGerais.possuiEcommerce, 'sim');
  assert.equal(normalized.informacoesOperacionais.numeroFuncionarios, '12');
  assert.deepEqual(normalized.promessasRealizadas, ['Planejamento fiscal']);
  assert.equal(normalized.topicosConsideracoesSetores.length, 1);
  assert.equal(normalized.honorarios, undefined);
  assert.equal(normalized.approval, undefined);
  assert.deepEqual(normalizeDossier(normalized), normalized);
});

test('cadastro valida dependências, limites, documentos, UFs e data de calendário', () => {
  for (const updates of [
    { dataInicio: '2026-02-30' }, { grupo: ' ' }, { mesesRetificacao: '' }, { filiais: [] },
    { filiais: [{ nome: 'Teste' }] }, { indicacao: { temIndicacao: 'sim' } },
    { contatos: [{ email: 'inválido' }] }, { topicosConsideracoesSetores: Array(61).fill({}) },
    { origem: 'Indicação\r\nOutro' }, { empresa: { ...example().empresa, cnpj: '12ABC34501DE00' } },
    { empresa: { ...example().empresa, cnpj: '...' } }, { empresa: { ...example().empresa, estado: 'XX' } },
  ]) {
    assert.throws(() => normalizeDossier({ ...example(), ...updates }), { status: 400, code: 'DOSSIER_INPUT' });
  }
  const normalized = normalizeDossier({ ...example(), possuiFiliais: 'nao', retificacao: false,
    indicacao: { temIndicacao: false, nomeIndicador: 'Oculto' } });
  assert.equal(normalized.quantidadeFiliais, 0);
  assert.deepEqual(normalized.filiais, []);
  assert.equal(normalized.mesesRetificacao, '');
  assert.equal(normalized.indicacao.nomeIndicador, '');
});

test('cálculo de honorários persiste centavos inteiros e recusa valores ou campos indevidos', () => {
  const input = { valorMensal: '1750.50', valorImplantacao: '0.07', vencimentoDia: '31', inicioCobranca: '2028-02-29', observacoes: '  Texto  ' };
  assert.deepEqual(normalizeFees(input), {
    valorMensalCentavos: 175050, valorImplantacaoCentavos: 7, vencimentoDia: 31, inicioCobranca: '2028-02-29', observacoes: 'Texto',
  });
  assert.equal(normalizeFees({ ...input, valorImplantacao: '' }).valorImplantacaoCentavos, 0);
  assert.equal(normalizeFees({ ...input, valorMensal: '100000000.00' }).valorMensalCentavos, 10_000_000_000);
  for (const updates of [
    { valorMensal: '0' }, { valorMensal: '1,5' }, { valorMensal: '1.005' }, { valorMensal: '100000000.01' },
    { valorImplantacao: '-0.01' }, { vencimentoDia: 32 }, { vencimentoDia: '1e1' },
    { inicioCobranca: '2027-02-29' }, { to: 'intruso@example.invalid' }, { envelope: {} }, { observacoes: 'a'.repeat(2001) },
  ]) {
    assert.throws(() => normalizeFees({ ...input, ...updates }), { status: 400 });
  }
});

test('documento ao imprimir tem dados completos e e-mail contém somente identificação e honorários', () => {
  const dossier = { ...normalizeDossier(example()), protocolo: 'DOS-123 & TESTE',
    honorarios: { ...normalizeFees({ valorMensal: '1750.50', vencimentoDia: '30', observacoes: 'Termo <img onerror=teste>' }), version: 2 } };
  const html = renderDossierHtml(dossier);
  for (const copy of ['Maximum Assessoria Contábil', 'DOS-123 &amp; TESTE', '12.ABC.345/01DE-35', '01/12/2026', 'Janeiro e fevereiro',
    'Coligada / agregada', 'contato@example.invalid', 'ERP de teste', 'Planejamento fiscal', 'Revisar escriturações',
    'Integração de teste', '&lt;img onerror=&quot;alert(1)&quot;&gt;', '@media print', 'data:image/png;base64,']) {
    assert.ok(html.includes(copy), copy);
  }
  assert.ok(!html.includes('<script>') && !html.includes('Termo') && !html.includes('1.750,50'));
  const email = renderFeesMessage(dossier);
  assert.match(email.subject, /Honorários.*v2/);
  assert.match(email.text, /1\.750,50/);
  assert.match(email.html, /&lt;img onerror=teste&gt;/);
  assert.doesNotMatch(email.html, /contato@example.invalid|ERP de teste|Planejamento fiscal|Dado restrito|<img|<script>/);
  assert.doesNotMatch(email.text, /contato@example.invalid|Revisar escriturações|Dado restrito/);
});
