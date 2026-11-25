const get = (id) => document.getElementById(id);
const themeKey = 'maximum.theme';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function readTheme() {
  try { return localStorage.getItem(themeKey) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

function applyTheme(theme) {
  const dark = theme === 'dark';
  const button = get('portalTheme');
  const label = dark ? 'Ativar tema claro' : 'Ativar tema escuro';
  document.documentElement.dataset.theme = theme;
  button.setAttribute('aria-pressed', String(dark));
  button.setAttribute('aria-label', label);
  button.title = label;
  button.firstElementChild.className = dark ? 'bi bi-sun' : 'bi bi-moon-stars';
}

function startNewsCarousel() {
  const carousel = document.querySelector('.portal-news');
  const slides = [...carousel.querySelectorAll('[data-news-slide]')];
  const pause = get('portalNewsPause');
  const controls = get('portalNewsDots');
  let current = 0;
  let paused = reducedMotion.matches;
  let pointerOver = false;
  let timer;
  const dots = slides.map((slide, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('aria-label', slide.querySelector('h3').textContent);
    dot.addEventListener('click', () => select(index));
    return dot;
  });
  controls.append(...dots);

  function render(index) {
    current = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      slide.hidden = i !== current;
      if (i === current) dots[i].setAttribute('aria-current', 'true');
      else dots[i].removeAttribute('aria-current');
    });
  }

  function restart() {
    clearInterval(timer);
    if (paused) return;
    timer = setInterval(() => {
      if (!document.hidden && !pointerOver && !carousel.contains(document.activeElement) && carousel.getClientRects().length) {
        render(current + 1);
      }
    }, 9000);
  }

  function select(index) {
    render(index);
    restart();
  }

  function renderPause() {
    const label = paused ? 'Reproduzir notícias' : 'Pausar notícias';
    pause.setAttribute('aria-label', label);
    pause.title = label;
    pause.firstElementChild.className = paused ? 'bi bi-play-fill' : 'bi bi-pause-fill';
    restart();
  }

  get('portalNewsPrevious').addEventListener('click', () => select(current - 1));
  get('portalNewsNext').addEventListener('click', () => select(current + 1));
  pause.addEventListener('click', () => { paused = !paused; renderPause(); });
  carousel.addEventListener('pointerenter', () => { pointerOver = true; });
  carousel.addEventListener('pointerleave', () => { pointerOver = false; });
  reducedMotion.addEventListener('change', (event) => { paused = event.matches; renderPause(); });
  render(0);
  renderPause();
}

let talkUnread = 0;
let whatsappUnread = 0;

function renderNotificationBadge() {
  const unread = talkUnread + whatsappUnread;
  const badge = get('portalBadge');
  const title = unread === 1 ? '1 mensagem não lida' : `${unread} mensagens não lidas`;
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.hidden = unread === 0;
  badge.parentElement.setAttribute('aria-label', unread ? `Notificações, ${title}` : 'Notificações');
}

export function setChatNotification({ unread = 0 } = {}) {
  talkUnread = Number(unread) || 0;
  get('portalChatUnread').textContent = talkUnread ? `Talk · ${talkUnread} ${talkUnread === 1 ? 'não lida' : 'não lidas'}` : 'Talk';
  get('portalChatPreview').textContent = talkUnread ? 'Abra o Talk para ler.' : 'Converse com sua equipe na Central.';
  renderNotificationBadge();
}

export function setWhatsAppNotification(unread = 0) {
  whatsappUnread = Number(unread) || 0;
  get('portalWhatsAppNotice').hidden = whatsappUnread <= 0;
  get('portalWhatsAppUnread').textContent = `WhatsApp · ${whatsappUnread} ${whatsappUnread === 1 ? 'não lida' : 'não lidas'}`;
  renderNotificationBadge();
}

export function mountPortal(openChat, openWhatsApp) {
  applyTheme(readTheme());
  get('portalTheme').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    try { localStorage.setItem(themeKey, theme); } catch { /* Theme still applies to this page. */ }
  });

  const popovers = [...document.querySelectorAll('[data-portal-popover]')];
  for (const popover of popovers) {
    popover.addEventListener('toggle', () => {
      if (popover.open) {
        for (const other of popovers) if (other !== popover) other.open = false;
      }
    });
    popover.addEventListener('click', (event) => {
      if (event.target.closest('.portal-popover-panel button')) popover.open = false;
    });
  }
  document.addEventListener('click', (event) => {
    for (const popover of popovers) if (popover.open && !popover.contains(event.target)) popover.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const popover of popovers) {
      if (popover.open) {
        popover.open = false;
        popover.querySelector('summary').focus();
      }
    }
  });

  get('portalChatNotice').addEventListener('click', () => openChat());
  get('portalNewsChat').addEventListener('click', () => openChat());
  get('portalWhatsAppNotice').addEventListener('click', () => openWhatsApp());
  startNewsCarousel();
}
