export const MODULES = Object.freeze([
  { id: 'fiscal', label: 'Fiscal', description: 'Notas, eventos e acompanhamento tributário', available: true },
  { id: 'dp', label: 'Departamento Pessoal', description: 'Tarefas por empresa e responsável', available: true },
  { id: 'contabil', label: 'Contábil', description: 'Tarefas por empresa e responsável', available: true },
  { id: 'societario', label: 'Societário', description: 'Tarefas por empresa e responsável', available: true },
  { id: 'financeiro', label: 'Financeiro', description: 'Tarefas por empresa e responsável', available: true },
  { id: 'gestao', label: 'Gestão', description: 'Tarefas e acompanhamento da carteira', available: true }
]);
export const LEVELS = ['view', 'edit', 'manage'];

export function permissionsFor(user) {
  if (!user) return {};
  if (user.role === 'admin') return Object.fromEntries(MODULES.map(item => [item.id, 'manage']));
  return Object.fromEntries(Object.entries(user.moduleGrants || {}).filter(([module, level]) => MODULES.some(x => x.id === module) && LEVELS.includes(level)));
}

export function canAccess(user, module, level = 'view') {
  if (!user?.active) return false;
  const granted = permissionsFor(user)[module];
  return granted !== undefined && LEVELS.indexOf(granted) >= LEVELS.indexOf(level);
}

export function canAccessCompany(user, cnpj) {
  return Boolean(user?.active && (user.role === 'admin' || user.companyCnpjs?.includes(cnpj)));
}

export function publicUser(user) {
  if (!user) return null;
  const { _id, name, email, role, active, companyCnpjs, moduleGrants, createdAt } = user;
  return { id: _id, name, email, role, active, companyCnpjs: companyCnpjs || [], moduleGrants: moduleGrants || {}, createdAt };
}
