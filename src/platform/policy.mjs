const MODULE_ACTIONS = Object.freeze({
  workItemRead: 'view',
  workItemCreate: 'edit',
  workItemUpdate: 'edit',
  sectorTalkRead: 'view',
  sectorTalkSend: 'view',
  whatsappRead: 'view',
  whatsappReply: 'edit',
  whatsappTicketUpdate: 'edit'
});
const FISCAL_ACTIONS = Object.freeze({ ...MODULE_ACTIONS, fiscalDocumentsRead: 'view' });
const ACTION_PREREQUISITES = new Map([
  ['workItemCreate', 'workItemRead'],
  ['workItemUpdate', 'workItemRead'],
  ['sectorTalkSend', 'sectorTalkRead'],
  ['whatsappReply', 'whatsappRead'],
  ['whatsappTicketUpdate', 'whatsappRead']
]);

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
  return module === 'fiscal' ? FISCAL_ACTIONS : MODULE_ACTIONS;
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
  return !blocked.includes(action) && !blocked.includes(ACTION_PREREQUISITES.get(action));
}

export function capabilitiesFor(user) {
  return Object.fromEntries(MODULES.filter(module => canAccess(user, module.id)).map(({ id, actions }) =>
    [id, Object.fromEntries(actions.map(action => [action, canPerform(user, id, action)]))]));
}

export function canAccessCompany(user, cnpj) {
  return Boolean(user?.active && (user.role === 'admin' || user.companyCnpjs?.includes(cnpj)));
}

export const INTERNAL_WORK_ITEM_MODULES = Object.freeze(['tecnologia', 'marketing']);

export function canAccessWorkItemCompany(user, module, cnpj) {
  if (cnpj === null) return Boolean(user?.active && INTERNAL_WORK_ITEM_MODULES.includes(module));
  return canAccessCompany(user, cnpj);
}

export function publicUser(user) {
  if (!user) return null;
  const { _id, name, username, email, role, active, companyCnpjs, moduleGrants, createdAt } = user;
  return { id: _id, name, ...(username ? { username } : {}), email, role, active, companyCnpjs: companyCnpjs || [], moduleGrants: moduleGrants || {}, createdAt };
}
