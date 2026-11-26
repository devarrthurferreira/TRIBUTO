import { mountClubCheckIn } from './club-check-in.js';
import { mountMaxHubSocial } from './maxhub-social.js';
import { mountMaxHubPeople } from './maxhub-people.js';

export const MAXHUB_PATH = '/maxhub';

const areas = {
  inicio: { label: 'Início', icon: 'house-door', view: 'home' },
  desempenho: { label: 'Desempenho e Desenvolvimento', icon: 'graph-up', sections: [
    { id: 'avaliacoes', label: 'Avaliação', icon: 'list-task', view: 'reviews' },
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
  const menuButton = document.getElementById('maxHubMenuButton');
  const subnav = document.getElementById('maxHubSubnav');
  const narrowViewport = matchMedia('(max-width: 700px)');
  let selectedUrl;
  let activeSession;
  let reviewsAvailable;
  let reviewsRequest = 0;
  let reviewLink;
  const groups = new Map();
  let cleanupMood;
  let cleanupWorkspace;

  function showMenu(expanded) {
    if (!expanded && subnav.contains(document.activeElement)) menuButton.focus({ preventScroll: true });
    subnav.hidden = !expanded;
    menuButton.setAttribute('aria-expanded', String(expanded));
  }

  menuButton.addEventListener('click', () => {
    showMenu(subnav.hidden);
    if (!subnav.hidden && narrowViewport.matches) {
      (subnav.querySelector('[aria-current="page"]') || subnav.querySelector('a'))?.focus({ preventScroll: true });
    }
  });

  function dismissOnEscape(event) {
    if (event.key !== 'Escape' || subnav.hidden) return;
    event.preventDefault();
    showMenu(false);
  }

  menuButton.addEventListener('keydown', dismissOnEscape);
  subnav.addEventListener('keydown', dismissOnEscape);

  function dismissOnOutside(event) {
    if (narrowViewport.matches && !subnav.hidden && !subnav.contains(event.target) && !menuButton.contains(event.target)) showMenu(false);
  }

  document.addEventListener('click', dismissOnOutside);
  document.addEventListener('focusin', dismissOnOutside);
  narrowViewport.addEventListener('change', ({ matches }) => {
    if (activeSession) showMenu(!matches);
  });

  function setGroup(id, expanded) {
    const { button, panel } = groups.get(id);
    button.setAttribute('aria-expanded', String(expanded));
    panel.inert = !expanded;
    panel.dataset.expanded = String(expanded);
  }

  function renderMenu() {
    const links = Object.entries(areas).filter(([id]) => id !== 'perfil').map(([id, { label, icon, sections }]) => {
      const caption = `<i class="bi bi-${icon}" aria-hidden="true"></i><span>${label}</span>`;
      if (!sections) return `<a class="sector-subnav-link" href="${MAXHUB_PATH}">${caption}</a>`;
      return `<button type="button" class="sector-subnav-link maxhub-menu-group" data-maxhub-group="${id}" aria-expanded="false" aria-controls="maxHubMenu-${id}">${caption}<i class="bi bi-chevron-down" aria-hidden="true"></i></button>
        <div class="maxhub-menu-panel" id="maxHubMenu-${id}" inert data-expanded="false">
          <div class="maxhub-menu-panel-body"><div class="sector-subnav-children" role="group" aria-label="${label}">
            ${sections.map(item => `<a class="sector-subnav-link sector-subnav-child" href="${areaUrl(id, item.id)}"${item.id === 'avaliacoes' ? ' data-maxhub-review hidden' : ''}>
              <i class="bi bi-${item.icon}" aria-hidden="true"></i><span>${item.label}</span></a>`).join('')}
          </div></div>
        </div>`;
    });
    subnav.innerHTML = `<h2>MaxHub</h2><div class="sector-subnav-list">${links.join('')}</div>`;
    reviewLink = subnav.querySelector('[data-maxhub-review]');
    for (const button of subnav.querySelectorAll('[data-maxhub-group]')) {
      const id = button.dataset.maxhubGroup;
      groups.set(id, { button, panel: document.getElementById(button.getAttribute('aria-controls')) });
      button.addEventListener('click', () => {
        const expanding = button.getAttribute('aria-expanded') === 'false';
        setGroup(id, expanding);
        if (expanding && id === 'desempenho') void refreshReviews();
      });
    }
  }

  function selectMenu(area, url) {
    if (groups.has(area)) setGroup(area, true);
    for (const [id, { button }] of groups) button.classList.toggle('sector-subnav-parent', id === area);
    for (const link of subnav.querySelectorAll('a')) {
      if (link.getAttribute('href') === url) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  async function refreshReviews() {
    if (!activeSession) return;
    const current = ++reviewsRequest;
    try {
      const { items } = await request('/people/reviews/available');
      if (current !== reviewsRequest) return;
      reviewsAvailable = items.length > 0;
      if (!reviewsAvailable && document.activeElement === reviewLink) groups.get('desempenho').button.focus({ preventScroll: true });
      reviewLink.hidden = !reviewsAvailable;
    } catch (error) {
      if (current !== reviewsRequest) return;
      if (error.status === 401) { onAuthError(error); return; }
      reviewsAvailable = false;
      reviewLink.hidden = true;
    }
    if (!selectedUrl) renderLocation();
  }

  function unmountWorkspace() {
    cleanupMood?.();
    cleanupWorkspace?.();
    cleanupMood = cleanupWorkspace = undefined;
  }

  function close() {
    if (!activeSession) return;
    unmountWorkspace();
    selectedUrl = activeSession = undefined;
    reviewsAvailable = undefined;
    ++reviewsRequest;
    showMenu(false);
    menuButton.hidden = true;
    reviewLink.hidden = true;
    for (const id of groups.keys()) setGroup(id, false);
    root.replaceChildren();
  }

  function renderLocation() {
    if (!activeSession) return;
    const params = new URLSearchParams(location.search);
    const candidate = params.get('area');
    const area = Object.hasOwn(areas, candidate) ? candidate : 'inicio';
    const { sections, view } = areas[area];
    const requested = params.get('secao');
    if (area === 'desempenho' && requested === 'avaliacoes' && reviewsAvailable === undefined) {
      unmountWorkspace();
      selectedUrl = undefined;
      root.innerHTML = '<div class="maxhub-loading" role="status"><span class="portal-startup-progress" aria-hidden="true"></span><p>Verificando avaliações disponíveis…</p></div>';
      return;
    }
    const visibleSections = sections?.filter(item => item.view !== 'reviews' || reviewsAvailable);
    const section = visibleSections?.find(item => item.id === requested) || visibleSections?.[0];
    const workspace = section?.view || view;
    const url = areaUrl(area, section?.id);
    if (`${location.pathname}${location.search}` !== url) history.replaceState(null, '', url);
    if (selectedUrl === url) return;
    unmountWorkspace();
    selectedUrl = url;
    document.title = `${section?.label ?? areas[area].label} | MaxHub`;
    selectMenu(area, url);
    root.innerHTML = `
      <div class="maxhub">
        <h1 class="sr-only">MaxHub</h1>
        ${workspace === 'home' ? '<div id="maxHubMood" class="maxhub-mood"></div>' : ''}
        <div id="maxHubWorkspace" class="maxhub-workspace"></div>
      </div>`;
    if (workspace === 'home') {
      cleanupMood = mountClubCheckIn(root.querySelector('#maxHubMood'), {
        request, onAuthError, onSubmitted: () => window.dispatchEvent(new Event('maxhub:points-change')),
      });
    }
    const mount = peopleViews.has(workspace) ? mountMaxHubPeople : mountMaxHubSocial;
    cleanupWorkspace = mount(root.querySelector('#maxHubWorkspace'), { area: workspace, request, onAuthError, session: activeSession, onProfileChange });
  }

  function open(session) {
    if (activeSession !== session) {
      close();
      activeSession = session;
      menuButton.hidden = false;
      showMenu(!narrowViewport.matches);
      void refreshReviews();
    }
    renderLocation();
  }

  subnav.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
    if (!activeSession) return;
    event.preventDefault();
    const target = `${link.pathname}${link.search}`;
    if (`${location.pathname}${location.search}` !== target) history.pushState(null, '', target);
    renderLocation();
    if (narrowViewport.matches) showMenu(false);
    root.closest('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  });

  window.addEventListener('popstate', () => { if (isMaxHubPath(location.pathname)) renderLocation(); });
  window.addEventListener('maxhub:reviews-change', () => void refreshReviews());
  window.addEventListener('pageshow', event => { if (event.persisted) void refreshReviews(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshReviews(); });
  renderMenu();

  return { open, close };
}
