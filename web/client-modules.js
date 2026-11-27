export const CLIENT_MODULES = Object.freeze([
  { id: 'guias', label: 'Guias e impostos', icon: 'receipt', description: 'Consulte guias, vencimentos e arquivos para pagamento.' },
  { id: 'financeiro', label: 'Financeiro', icon: 'calculator', description: 'Acompanhe lançamentos, valores e situação dos pagamentos.' },
  { id: 'documentos', label: 'Documentos', icon: 'file-earmark', description: 'Envie arquivos à Maximum e acompanhe a conferência.' },
  { id: 'cadastro', label: 'Dados cadastrais', icon: 'person-badge', description: 'Dados da empresa ou pessoa e contatos cadastrados.' },
  { id: 'societario', label: 'Inscrições', icon: 'buildings', description: 'Inscrições estaduais e municipais do cadastro.' },
  { id: 'contabil', label: 'Enquadramento tributário', icon: 'calculator', description: 'Regime tributário e CNAE principal cadastrados.' },
  { id: 'fiscal', label: 'Notas fiscais', icon: 'receipt', description: 'Notas fiscais eletrônicas recebidas pela coleta e seu horário.' },
  { id: 'nfse', label: 'Notas de serviço', icon: 'file-earmark', description: 'Notas fiscais de serviço recebidas pela coleta e seu horário.' },
].map(module => Object.freeze(module)));
