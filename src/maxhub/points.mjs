import { createHash } from 'node:crypto';

export const MAXCOIN_RULES = Object.freeze([
  { action: 'visit', label: 'Acesso diário à plataforma', points: 200 },
  { action: 'objective', label: 'Realizar check-in em um objetivo', points: 500 },
  { action: 'celebrate', label: 'Celebrar', points: 200 },
  { action: 'engagement', label: 'Responder pesquisa de engajamento', points: 100 },
  { action: 'feedback', label: 'Enviar feedback', points: 500 },
  { action: 'satisfaction', label: 'Responder pesquisa de satisfação', points: 500 },
  { action: 'one_on_one', label: 'Finalizar reunião 1:1', points: 100 },
  { action: 'quick_survey', label: 'Responder pesquisa rápida', points: 500 },
  { action: 'pdi_active', label: 'Plano de Desenvolvimento (PDI) vigente', points: 500 },
  { action: 'mood', label: 'Responder termômetro de humor', points: 200 },
  { action: 'pdi_complete', label: 'Concluir Plano de Desenvolvimento (PDI)', points: 500 },
  { action: 'super_survey', label: 'Responder uma super pesquisa', points: 500 },
].map(Object.freeze));

const rulesByAction = new Map(MAXCOIN_RULES.map(rule => [rule.action, rule]));
const localDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function maxHubDay(date = new Date()) {
  return localDate.format(date);
}

export function maxcoinLabel(action) {
  return rulesByAction.get(action)?.label ?? action;
}

function eventHash(action, eventKey) {
  if (!rulesByAction.has(action)) throw new TypeError('Ação de Maxcoin desconhecida.');
  if (typeof eventKey !== 'string' || !eventKey.length || eventKey.length > 512) {
    throw new TypeError('O registro de Maxcoin requer um identificador de evento válido.');
  }
  return createHash('sha256').update(eventKey).digest();
}

export async function awardMaxcoin(connection, userId, action, eventKey) {
  const key = eventHash(action, eventKey);
  const { points } = rulesByAction.get(action);
  try {
    await connection.execute(`INSERT INTO platform_maxhub_points (user_id, action, event_hash, points, created_at)
      VALUES (?, ?, ?, ?, ?)`, [userId, action, key, points, new Date()]);
    return true;
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return false;
    throw error;
  }
}

export async function revokeMaxcoin(connection, userId, action, eventKey) {
  const key = eventHash(action, eventKey);
  const [result] = await connection.execute(
    'DELETE FROM platform_maxhub_points WHERE user_id = ? AND action = ? AND event_hash = ?',
    [userId, action, key],
  );
  return result.affectedRows === 1;
}
