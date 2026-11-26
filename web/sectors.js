import { setChatSurface } from './chat.js';
import { getSectorWhatsAppUnread, mountSectorWhatsApp } from './sector-whatsapp.js';
import { setWhatsAppNotification } from './portal.js';

const get = (id) => document.getElementById(id);
const areas = ['setor', 'talk', 'whatsapp'];
const titles = { setor: 'Setor', talk: 'Talk', whatsapp: 'WhatsApp' };
const icons = { overview: 'grid', activities: 'list-task', tasks: 'list-task', metrics: 'graph-up', crm: 'envelope', humor: 'graph-up', fiscal: 'receipt', users: 'people', agents: 'broadcast' };
const crmSections = [
  { key: 'subscribers', slug: 'contatos', label: 'Contatos', icon: 'people' },
  { key: 'campaigns', slug: 'campanhas', label: 'Campanhas', icon: 'envelope' },
  { key: 'landings', slug: 'paginas', label: 'Páginas', icon: 'file-earmark' },
];

export function crmSectionFromQuery(query) {
  const slug = query.get('crm');
  return {
    section: slug === 'historico' ? 'campaigns' : crmSections.find(item => item.slug === slug)?.key || 'subscribers',
    campaignView: slug === 'historico' ? 'history' : 'working',
  };
}

function crmSlug(section, campaignView) {
  if (section === 'campaigns' && campaignView === 'history') return 'historico';
  return crmSections.find(item => item.key === section)?.slug || 'contatos';
}

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
  if (sector.clubMood) options.push({ id: 'humor', label: 'Humor e presença' });
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
  const crmRail = get('sectorCrmRail');
  const talk = get('sectorTalkScreen');
  const talkMount = get('sectorTalkMount');
  const whatsapp = get('sectorWhatsAppScreen');
  const whatsappMount = get('sectorWhatsAppMount');
  const narrowViewport = matchMedia('(max-width: 700px)');
  const buttons = Object.fromEntries([...nav.querySelectorAll('[data-sector-area]')].map(button => [button.dataset.sectorArea, button]));
  let context;
  let activeArea;
  let selectedPanel;
  let selectedCrmSection;
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

  function renderCrmLinks(group, { compact = false } = {}) {
    for (const { key, label, icon: name } of crmSections) {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = compact ? 'sector-rail-button' : 'sector-subnav-link sector-subnav-child';
      control.setAttribute('aria-controls', 'marketingCrm');
      control.dataset.crmSection = key;
      if (selectedPanel === 'crm' && key === selectedCrmSection) control.setAttribute('aria-current', 'page');
      const icon = document.createElement('i');
      icon.className = `bi bi-${name}`;
      icon.setAttribute('aria-hidden', 'true');
      control.append(icon);
      if (compact) {
        control.title = label;
        control.setAttribute('aria-label', label);
      } else control.append(document.createTextNode(label));
      control.addEventListener('click', () => selectCrmSection(key, { fromSubnav: !compact, retainFocus: compact }));
      group.append(control);
    }
  }

  function renderSubnav() {
    const list = get('sectorSubnavList');
    get('sectorSubnavTitle').textContent = context.label;
    list.replaceChildren();
    for (const { id, label, href } of sectionOptions(context)) {
      const control = document.createElement(href ? 'a' : 'button');
      control.className = 'sector-subnav-link';
      const icon = document.createElement('i');
      icon.className = `bi bi-${icons[id]}`;
      icon.setAttribute('aria-hidden', 'true');
      control.append(icon, document.createTextNode(label));
      if (href) control.href = href;
      else {
        control.type = 'button';
        if (id === selectedPanel && id !== 'crm') control.setAttribute('aria-current', 'page');
        control.addEventListener('click', () => selectPanel(id, { fromSubnav: true }));
      }
      list.append(control);
      if (id === 'crm' && selectedPanel === 'crm') {
        const group = document.createElement('div');
        group.className = 'sector-subnav-children';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', 'Áreas do CRM');
        control.classList.add('sector-subnav-parent');
        renderCrmLinks(group);
        list.append(group);
      }
    }
    crmRail.replaceChildren();
    if (selectedPanel === 'crm') renderCrmLinks(crmRail, { compact: true });
  }

  function selectPanel(id, { fromSubnav = false, retainFocus = false, replace = false, crmSection, campaignView } = {}) {
    if (!context || activeArea !== 'setor' || !sectionOptions(context).some(item => item.id === id && !item.href)) return;
    const url = new URL(location.href);
    if (id === 'overview') url.searchParams.delete('painel'); else url.searchParams.set('painel', id);
    if (id !== activityPanel(context)) url.searchParams.delete('atividade');
    if (id === 'crm') url.searchParams.set('crm', crmSlug(crmSection, campaignView));
    else url.searchParams.delete('crm');
    url.searchParams.delete('pagina');
    url.searchParams.delete('tipo');
    if (url.href !== location.href) {
      if (replace) history.replaceState(null, '', url);
      else history.pushState(null, '', url);
    }
    const mobile = narrowViewport.matches;
    const compactFocused = crmRail.contains(document.activeElement);
    if (mobile && !retainFocus) expanded = false;
    syncLocation();
    if (compactFocused) crmRail.querySelector('[aria-current]')?.focus({ preventScroll: true });
    if (retainFocus) return;
    if (mobile || !fromSubnav) get('conteudo').focus({ preventScroll: true });
    if (!mobile && fromSubnav) subnav.querySelector('[aria-current]')?.focus({ preventScroll: true });
    document.querySelector('.portal-header')?.scrollIntoView({ block: 'start' });
  }

  function selectCrmSection(section, options = {}) {
    selectPanel('crm', { ...options, crmSection: section });
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
    crmRail.hidden = area !== 'setor' || selectedPanel !== 'crm' || !subnav.hidden;
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
    const priorPanel = selectedPanel;
    selectedPanel = sectionOptions(context).some(({ id, href }) => id === candidate && !href) ? candidate : 'overview';
    selectedCrmSection = crmSectionFromQuery(query).section;
    const area = urlArea();
    if (['crm', 'humor'].includes(selectedPanel) && area === 'setor' && (priorPanel !== selectedPanel || activeArea !== 'setor')
      && !narrowViewport.matches) expanded = true;
    app.dataset.sectorPanel = selectedPanel;
    renderSubnav();
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
    context = activeArea = selectedPanel = undefined;
    expanded = false;
    setWhatsAppUnread(0);
    nav.hidden = talk.hidden = whatsapp.hidden = subnav.hidden = crmRail.hidden = true;
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
  subnav.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    open('setor', { updateHistory: false });
    buttons.setor.focus();
  });
  narrowViewport.addEventListener('change', ({ matches }) => {
    if (activeArea !== 'setor' || !['crm', 'humor'].includes(selectedPanel)) return;
    expanded = !matches;
    showArea(activeArea);
  });
  window.addEventListener('popstate', syncLocation);
  return {
    activate, leave, open, selectPanel, selectCrmSection,
    setTalkUnread(count) { notification(buttons.talk, get('sectorTalkDot'), 'Talk', count); },
  };
}
