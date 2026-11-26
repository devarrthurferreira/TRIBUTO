export const CLIENT_MODULES = Object.freeze([
  { id: 'cadastro', label: 'Dados cadastrais', icon: 'person-badge', description: 'Dados da empresa ou pessoa e contatos cadastrados.' },
  { id: 'societario', label: 'Inscrições', icon: 'buildings', description: 'Inscrições estaduais e municipais do cadastro.' },
  { id: 'contabil', label: 'Enquadramento tributário', icon: 'calculator', description: 'Regime tributário e CNAE principal cadastrados.' },
  { id: 'fiscal', label: 'Notas fiscais', icon: 'receipt', description: 'Notas fiscais eletrônicas recebidas pela coleta e seu horário.' },
  { id: 'nfse', label: 'Notas de serviço', icon: 'file-earmark', description: 'Notas fiscais de serviço recebidas pela coleta e seu horário.' },
].map(module => Object.freeze(module)));
