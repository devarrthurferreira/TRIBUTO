const WORK_ITEM_ACTIONS = Object.freeze({
  workItemRead: 'view',
  workItemCreate: 'edit',
  workItemUpdate: 'edit'
});

export const MODULES = Object.freeze([
  { id: 'dp', label: 'Departamento Pessoal', description: 'Rotinas trabalhistas e acompanhamento das empresas' },
  { id: 'rh', label: 'Recursos Humanos', description: 'Pessoas, talentos e desenvolvimento da equipe' },
  { id: 'tecnologia', label: 'Tecnologia', description: 'Demandas internas, suporte e evolução dos sistemas' },
  { id: 'marketing', label: 'Marketing', description: 'Campanhas, comunicação e presença digital' },
  { id: 'societario', label: 'Societário', description: 'Aberturas, alterações e regularização de empresas' },
  { id: 'contabil', label: 'Contábil', description: 'Rotinas contábeis e acompanhamento das empresas' },
  { id: 'fiscal', label: 'Fiscal', description: 'Notas, eventos e acompanhamento tributário' },
  { id: 'diretoria', label: 'Diretoria', description: 'Gestão e acompanhamento da operação' },
  { id: 'financeiro', label: 'Financeiro', description: 'Tarefas por empresa e responsável', legacy: true },
  { id: 'gestao', label: 'Gestão', description: 'Tarefas e acompanhamento da carteira', legacy: true }
].map((entry) => Object.freeze({ ...entry, available: true, actions: Object.freeze(Object.keys(actionLevels(entry.id))) })));
export const LEVELS = Object.freeze(['view', 'edit', 'manage']);

function actionLevels(module) {
  return module === 'fiscal' ? { ...WORK_ITEM_ACTIONS, fiscalDocumentsRead: 'view' } : WORK_ITEM_ACTIONS;
}

export function grantLevel(grant) {
  return typeof grant === 'string' ? grant : grant?.level;
}

export function permissionsFor(user) {
  if (!user?.active) return {};
  if (user.role === 'admin') return Object.fromEntries(MODULES.map(item => [item.id, 'manage']));
  const grants = Object.entries(user.moduleGrants || {}).map(([module, grant]) => [module, grantLevel(grant)]);
  return Object.fromEntries(grants.filter(([module, level]) => MODULES.some(x => x.id === module) && LEVELS.includes(level)));
}

export function canAccess(user, module, level = 'view') {
  const granted = permissionsFor(user)[module];
  return LEVELS.includes(granted) && LEVELS.includes(level) && LEVELS.indexOf(granted) >= LEVELS.indexOf(level);
}

export function canPerform(user, module, action) {
  const rules = actionLevels(module);
  if (!Object.hasOwn(rules, action) || !canAccess(user, module, rules[action])) return false;
  if (user.role === 'admin') return true;
  const blocked = user.moduleGrants[module]?.blockedActions;
  if (!Array.isArray(blocked)) return true;
  if (blocked.includes(action)) return false;
  return !['workItemCreate', 'workItemUpdate'].includes(action) || !blocked.includes('workItemRead');
}

export function capabilitiesFor(user) {
  return Object.fromEntries(MODULES.filter(module => canAccess(user, module.id)).map(({ id, actions }) =>
    [id, Object.fromEntries(actions.map(action => [action, canPerform(user, id, action)]))]));
}

export function canAccessCompany(user, cnpj) {
  return Boolean(user?.active && (user.role === 'admin' || user.companyCnpjs?.includes(cnpj)));
}

export function canAccessWorkItemCompany(user, module, cnpj) {
  if (cnpj === null) return Boolean(user?.active && module === 'tecnologia');
  return canAccessCompany(user, cnpj);
}

export function publicUser(user) {
  if (!user) return null;
  const { _id, name, email, role, active, companyCnpjs, moduleGrants, createdAt } = user;
  return { id: _id, name, email, role, active, companyCnpjs: companyCnpjs || [], moduleGrants: moduleGrants || {}, createdAt };
}
