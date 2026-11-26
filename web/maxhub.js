import { mountClubCheckIn } from './club-check-in.js';
import { mountMaxHubSocial } from './maxhub-social.js';
import { mountMaxHubPeople } from './maxhub-people.js';

export const MAXHUB_PATH = '/maxhub';

const areas = {
  inicio: { label: 'Início', icon: 'house-door', view: 'home' },
  desempenho: { label: 'Desempenho e Desenvolvimento', icon: 'graph-up', sections: [
    { id: 'avaliacoes', label: 'Minhas avaliações', icon: 'list-task', view: 'reviews' },
    { id: 'feedbacks', label: 'Feedbacks', icon: 'chat-dots', view: 'feedback' },
    { id: 'pdi', label: 'Planos de Desenvolvimento', icon: 'diagram-3', view: 'pdi' },
    { id: 'reunioes', label: 'Reuniões 1:1', icon: 'people', view: 'meetings' },
    { id: 'objetivos', label: 'Objetivos', icon: 'check2', view: 'objectives' },
  ] },
  clima: { label: 'Clima e Engajamento', icon: 'people', sections: [
    { id: 'comunicados', label: 'Comunicados', icon: 'megaphone', view: 'announcements' },
    { id: 'celebracoes', label: 'Celebrações', icon: 'gift', view: 'celebrations' },
    { id: 'ranking', label: 'Ranking de gamificação', icon: 'graph-up', view: 'ranking' },
    { id: 'historico', label: 'Histórico de gamificação', icon: 'clock-history', view: 'history' },
    { id: 'pesquisas', label: 'Pesquisas', icon: 'journal-text', view: 'surveys' },
  ] },
  perfil: { label: 'Meu perfil', view: 'profile' },
};

const peopleViews = new Set(['reviews', 'feedback', 'pdi', 'meetings', 'objectives', 'surveys']);

export function isMaxHubPath(pathname) {
  const path = pathname.replace(/\/$/, '');
  return path === MAXHUB_PATH || path === '/clube/check-in';
}

function areaUrl(area, section) {
  if (area === 'inicio') return MAXHUB_PATH;
  return `${MAXHUB_PATH}?area=${area}${section ? `&secao=${section}` : ''}`;
}

export function legacyMaxHubUrl(fragment) {
  if (fragment === 'desempenho') return areaUrl('desempenho', 'objetivos');
  if (fragment === 'engajamento') return areaUrl('clima', 'pesquisas');
  return null;
}

export function mountMaxHub(root, { request, onAuthError, onProfileChange }) {
  let selectedUrl;
  let activeSession;
  let cleanupMood;
  let cleanupWorkspace;

  function close() {
    cleanupMood?.();
    cleanupWorkspace?.();
    cleanupMood = cleanupWorkspace = undefined;
    selectedUrl = activeSession = undefined;
    root.replaceChildren();
  }

  function open(session) {
    const params = new URLSearchParams(location.search);
    const candidate = params.get('area');
    const area = Object.hasOwn(areas, candidate) ? candidate : 'inicio';
    const { sections, view } = areas[area];
    const section = sections?.find(item => item.id === params.get('secao')) || sections?.[0];
    const workspace = section?.view || view;
    const url = areaUrl(area, section?.id);
    if (`${location.pathname}${location.search}` !== url) history.replaceState(null, '', url);
    if (activeSession === session && selectedUrl === url) return;
    close();
    activeSession = session;
    selectedUrl = url;
    document.title = `${section?.label ?? areas[area].label} | MaxHub`;
    root.innerHTML = `
      <div class="maxhub">
        <header class="maxhub-heading"><span aria-hidden="true"><i class="bi bi-people"></i></span><h1>MaxHub</h1></header>
        <nav class="maxhub-areas" aria-label="Áreas do MaxHub">
          ${Object.entries(areas).filter(([id]) => id !== 'perfil').map(([id, { label, icon, sections: children }]) => `
            <a href="${areaUrl(id, children?.[0]?.id)}"${id === area ? ' aria-current="page"' : ''}><i class="bi bi-${icon}" aria-hidden="true"></i>${label}</a>`).join('')}
        </nav>
        ${sections ? `<nav class="maxhub-sections" aria-label="${areas[area].label}">
          ${sections.map(({ id, label, icon }) => `<a href="${areaUrl(area, id)}"${id === section.id ? ' aria-current="page"' : ''}><i class="bi bi-${icon}" aria-hidden="true"></i>${label}</a>`).join('')}
        </nav>` : ''}
        ${workspace === 'home' ? '<div id="maxHubMood" class="maxhub-mood"></div>' : ''}
        <div id="maxHubWorkspace" class="maxhub-workspace"></div>
      </div>`;
    if (workspace === 'home') {
      cleanupMood = mountClubCheckIn(root.querySelector('#maxHubMood'), {
        request, onAuthError, onSubmitted: () => window.dispatchEvent(new Event('maxhub:points-change')),
      });
    }
    const mount = peopleViews.has(workspace) ? mountMaxHubPeople : mountMaxHubSocial;
    cleanupWorkspace = mount(root.querySelector('#maxHubWorkspace'), { area: workspace, request, onAuthError, session, onProfileChange });
  }

  return { open, close };
}
