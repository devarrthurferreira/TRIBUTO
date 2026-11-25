import { setChatSurface } from './chat.js';
import { getSectorWhatsAppUnread, mountSectorWhatsApp } from './sector-whatsapp.js';
import { setWhatsAppNotification } from './portal.js';

const get = (id) => document.getElementById(id);
const areas = ['setor', 'talk', 'whatsapp'];
const titles = { setor: 'Setor', talk: 'Talk', whatsapp: 'WhatsApp' };
const icons = { overview: 'grid', activities: 'list-task', tasks: 'list-task', metrics: 'graph-up', crm: 'envelope', fiscal: 'receipt', users: 'people', agents: 'broadcast' };

function activityPanel(sector) {
  return sector.id === 'marketing' ? 'tasks' : 'activities';
}

function sectionOptions(sector) {
  const options = [{ id: 'overview', label: 'Visão geral' }];
  if (sector.activities) options.push({ id: activityPanel(sector), label: sector.id === 'marketing' ? 'Tarefas' : 'Atividades' });
  if (sector.id === 'marketing') {
    if (sector.activities) options.push({ id: 'metrics', label: 'Métricas' });
    if (sector.crm) options.push({ id: 'crm', label: 'CRM' });
  }
  if (sector.fiscalDocuments) options.push({ id: 'fiscal', label: 'Documentos fiscais' });
  if (sector.admin && sector.id === 'tecnologia') {
    options.push({ id: 'users', label: 'Equipe e acessos', href: '/home#users' });
    options.push({ id: 'agents', label: 'Agentes de coleta', href: '/home#agents' });
  }
  return options;
}

function urlArea() {
  const key = new URLSearchParams(location.search).get('aba');
  return areas.includes(key) ? key : 'setor';
}

function notification(button, dot, base, value) {
  const count = Number(value) || 0;
  dot.hidden = count <= 0;
  button.setAttribute('aria-label', count > 0 ? `${base}, ${count} ${count === 1 ? 'mensagem não lida' : 'mensagens não lidas'}` : base);
}

export function mountSectorNavigation() {
  const app = get('appView');
  const nav = get('sectorNavigation');
  const subnav = get('sectorSubnav');
  const talk = get('sectorTalkScreen');
  const talkMount = get('sectorTalkMount');
  const whatsapp = get('sectorWhatsAppScreen');
  const whatsappMount = get('sectorWhatsAppMount');
  const buttons = Object.fromEntries([...nav.querySelectorAll('[data-sector-area]')].map(button => [button.dataset.sectorArea, button]));
  let context;
  let activeArea;
  let selectedPanel;
  let expanded = false;
  let stopWhatsApp;
  let badgeTimer;
  let badgeRequest;

  function setWhatsAppUnread(count) {
    notification(buttons.whatsapp, get('sectorWhatsAppDot'), 'WhatsApp', count);
    setWhatsAppNotification(count);
  }

  function stopBadgePoll() {
    clearTimeout(badgeTimer);
    badgeRequest?.abort();
    badgeRequest = undefined;
  }

  async function pollWhatsAppBadge() {
    if (!context?.whatsapp || activeArea === 'whatsapp') return;
    const controller = new AbortController();
    badgeRequest = controller;
    const id = context.id;
    if (!document.hidden) {
      try {
        const unread = await getSectorWhatsAppUnread(id, { signal: controller.signal });
        if (badgeRequest === controller) setWhatsAppUnread(unread);
      } catch { /* Transient failures keep the last confirmed count. */ }
    }
    if (badgeRequest === controller) badgeTimer = setTimeout(pollWhatsAppBadge, 25_000);
  }

  function renderSubnav() {
    const list = get('sectorSubnavList');
    get('sectorSubnavTitle').textContent = context.label;
    list.replaceChildren(...sectionOptions(context).map(({ id, label, href }) => {
      const control = document.createElement(href ? 'a' : 'button');
      control.className = 'sector-subnav-link';
      const icon = document.createElement('i');
      icon.className = `bi bi-${icons[id]}`;
      icon.setAttribute('aria-hidden', 'true');
      control.append(icon, document.createTextNode(label));
      if (href) control.href = href;
      else {
        control.type = 'button';
        if (id === selectedPanel) control.setAttribute('aria-current', 'page');
        control.addEventListener('click', () => selectPanel(id, { fromSubnav: true }));
      }
      return control;
    }));
  }

  function selectPanel(id, { fromSubnav = false } = {}) {
    if (!context || activeArea !== 'setor' || !sectionOptions(context).some(item => item.id === id && !item.href)) return;
    const url = new URL(location.href);
    if (id === 'overview') url.searchParams.delete('painel'); else url.searchParams.set('painel', id);
    if (id !== activityPanel(context)) url.searchParams.delete('atividade');
    if (url.href !== location.href) history.pushState(null, '', url);
    const mobile = matchMedia('(max-width: 700px)').matches;
    if (mobile) expanded = false;
    if (mobile || !fromSubnav) get('conteudo').focus({ preventScroll: true });
    syncLocation();
    if (!mobile && fromSubnav) subnav.querySelector('[aria-current]')?.focus({ preventScroll: true });
    document.querySelector('.portal-header')?.scrollIntoView({ block: 'start' });
  }

  function showArea(area) {
    if (!context) return;
    const changed = area !== activeArea;
    activeArea = area;
    app.dataset.sectorArea = area;
    context.content.hidden = area !== 'setor';
    talk.hidden = area !== 'talk';
    whatsapp.hidden = area !== 'whatsapp';
    subnav.hidden = area !== 'setor' || !expanded;
    for (const key of areas) buttons[key].setAttribute('aria-pressed', String(key === area));
    buttons.setor.setAttribute('aria-expanded', String(!subnav.hidden));
    setChatSurface({ mount: talkMount, show: area === 'talk' });
    document.title = area === 'setor' ? `${context.label} | Central Maximum` : `${titles[area]} · ${context.label} | Central Maximum`;
    context.onPanelChange?.(area === 'setor' ? selectedPanel : null);
    if (!changed) return;
    stopBadgePoll();
    stopWhatsApp?.();
    stopWhatsApp = undefined;
    if (area === 'whatsapp') {
      stopWhatsApp = mountSectorWhatsApp(whatsappMount, { sector: context.id, sectorLabel: context.label, session: context.session, onUnread: setWhatsAppUnread });
    } else void pollWhatsAppBadge();
  }

  function open(area, { updateHistory = true } = {}) {
    if (!context || (area !== 'setor' && !context[area])) return false;
    if (area === 'setor') expanded = activeArea !== 'setor' || !expanded;
    if (updateHistory) {
      const url = new URL(location.href);
      if (area === 'setor') url.searchParams.delete('aba'); else url.searchParams.set('aba', area);
      url.hash = '';
      if (url.href !== location.href) history.pushState(null, '', url);
    }
    showArea(area);
    return true;
  }

  function syncLocation() {
    if (!context) return;
    const query = new URLSearchParams(location.search);
    const requested = query.get('painel');
    const candidate = requested === 'activities' || (!requested && query.has('atividade')) ? activityPanel(context) : requested || 'overview';
    selectedPanel = sectionOptions(context).some(({ id, href }) => id === candidate && !href) ? candidate : 'overview';
    app.dataset.sectorPanel = selectedPanel;
    renderSubnav();
    const area = urlArea();
    if (area !== 'setor' && !context[area]) {
      const url = new URL(location.href);
      url.searchParams.delete('aba');
      history.replaceState(null, '', url);
      showArea('setor');
    } else showArea(area);
  }

  function leave() {
    context?.onPanelChange?.(null);
    if (context) stopWhatsApp?.();
    stopWhatsApp = undefined;
    stopBadgePoll();
    context = activeArea = undefined;
    expanded = false;
    setWhatsAppUnread(0);
    nav.hidden = talk.hidden = whatsapp.hidden = subnav.hidden = true;
    for (const button of Object.values(buttons)) {
      button.hidden = true;
      button.setAttribute('aria-pressed', 'false');
    }
    buttons.setor.setAttribute('aria-expanded', 'false');
    delete app.dataset.sectorActive;
    delete app.dataset.sectorArea;
    delete app.dataset.sectorPanel;
  }

  function activate(sector, { home = false } = {}) {
    if (!sector) {
      leave();
      nav.hidden = false;
      const surface = home ? {} : { mount: talkMount, show: false };
      setChatSurface(surface);
      return surface;
    }
    if (context?.id !== sector.id) leave();
    context = sector;
    nav.hidden = false;
    buttons.setor.hidden = false;
    buttons.talk.hidden = !sector.talk;
    buttons.whatsapp.hidden = !sector.whatsapp;
    app.dataset.sectorActive = 'true';
    syncLocation();
    return { mount: talkMount, show: activeArea === 'talk' };
  }

  for (const area of areas) buttons[area].addEventListener('click', () => open(area));
  window.addEventListener('popstate', syncLocation);
  return {
    activate, leave, open, selectPanel,
    setTalkUnread(count) { notification(buttons.talk, get('sectorTalkDot'), 'Talk', count); },
  };
}
