const number = new Intl.NumberFormat('pt-BR');
const timelineDate = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});
const sectorNames = {
  dp: 'Departamento Pessoal', rh: 'Recursos Humanos', tecnologia: 'Tecnologia', marketing: 'Marketing',
  'sucesso-do-cliente': 'Sucesso do Cliente', societario: 'Societário', contabil: 'Contábil', fiscal: 'Fiscal',
  diretoria: 'Diretoria', financeiro: 'Financeiro', gestao: 'Gestão',
};
const feedKinds = {
  post: { label: 'Publicação', icon: 'chat-dots' },
  celebration: { label: 'Celebração', icon: 'gift' },
  announcement: { label: 'Comunicado', icon: 'megaphone' },
};
const feedSections = {
  home: { title: 'Feed da equipe', empty: 'Ainda não há publicações no seu feed.' },
  celebrations: { title: 'Celebrações', kind: 'celebration', empty: 'As celebrações da equipe vão aparecer aqui.' },
  announcements: { title: 'Comunicados', kind: 'announcement', empty: 'Ainda não há comunicados para você.' },
};
const API = '/v1/platform/maxhub';

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function icon(name) {
  const element = el('i', `bi bi-${name}`);
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function btn(label, { glyph, primary = false, type = 'button' } = {}) {
  const element = el('button', `hub-btn${primary ? ' hub-btn-primary' : ''}`);
  element.type = type;
  if (glyph) element.append(icon(glyph));
  element.append(document.createTextNode(label));
  return element;
}

function field(label, input) {
  const wrapper = el('label', 'hub-field');
  wrapper.append(el('span', '', label), input);
  return wrapper;
}

function panelHeading(title, glyph, level = 'h2') {
  const head = el('div', 'hub-heading');
  if (glyph) {
    const mark = el('span', 'hub-heading-icon');
    mark.append(icon(glyph));
    head.append(mark);
  }
  head.append(el(level, '', title));
  return head;
}

function info(text, { error = false, retry } = {}) {
  const box = el('div', `hub-info${error ? ' hub-info-error' : ''}`);
  box.setAttribute('role', 'status');
  box.append(el('p', '', text));
  if (retry) {
    const action = btn('Tentar novamente');
    action.addEventListener('click', retry);
    box.append(action);
  }
  return box;
}

function status() {
  const line = el('p', 'hub-status');
  line.hidden = true;
  line.setAttribute('role', 'status');
  return {
    line,
    set(message = '', error = false) {
      line.textContent = message;
      line.hidden = !message;
      line.dataset.error = String(error);
    },
  };
}

function stamp(value) {
  const date = new Date(value);
  const time = el('time', '', Number.isNaN(date.getTime()) ? 'Data indisponível' : timelineDate.format(date));
  if (!Number.isNaN(date.getTime())) time.dateTime = date.toISOString();
  return time;
}

function initials(name) {
  return String(name || 'Equipe').trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase('pt-BR');
}

function avatar(person, { large = false, source } = {}) {
  const frame = el('span', large ? 'hub-avatar hub-avatar-large' : 'hub-avatar');
  frame.setAttribute('aria-hidden', 'true');
  frame.append(el('span', '', initials(person.name)));
  const url = source === undefined && person.hasAvatar ? `${API}/avatar/${encodeURIComponent(person.id)}` : source;
  if (url) {
    const image = el('img');
    image.alt = '';
    image.decoding = 'async';
    image.addEventListener('error', () => image.remove(), { once: true });
    image.src = url;
    frame.append(image);
  }
  return frame;
}

function readImage(file, limit) {
  if (!file) return Promise.resolve(undefined);
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return Promise.reject(new Error('Escolha uma imagem PNG, JPG ou WebP.'));
  }
  if (file.size > limit || file.size === 0) {
    return Promise.reject(new Error(`Escolha uma imagem de até ${limit === 1048576 ? '1 MB' : '450 KB'}.`));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)), { once: true });
    reader.addEventListener('error', () => reject(new Error('Não foi possível abrir a imagem.')), { once: true });
    reader.readAsDataURL(file);
  });
}

function editedRange(previous, current, selection) {
  const delta = current.length - previous.length;
  if (selection) {
    let { start, end } = selection;
    if (start === end && delta < 0) {
      if (selection.type.endsWith('Backward')) start += delta;
      if (selection.type.endsWith('Forward')) end -= delta;
    }
    if (start >= 0 && end <= previous.length && end + delta >= start
      && previous.slice(0, start) === current.slice(0, start)
      && previous.slice(end) === current.slice(end + delta)) return { start, end, delta };
  }
  let start = 0;
  let end = previous.length;
  let currentEnd = current.length;
  while (start < end && start < currentEnd && previous[start] === current[start]) start += 1;
  while (start < end && start < currentEnd && previous[end - 1] === current[currentEnd - 1]) {
    end -= 1;
    currentEnd -= 1;
  }
  return { start, end, delta };
}

function mentionAtCursor(editor, mentions) {
  const caret = editor.selectionStart;
  if (caret !== editor.selectionEnd || caret === 0) return null;
  const start = editor.value.lastIndexOf('@', caret - 1);
  if (start < 0 || (start && !/[\s([{'".,;:!?]/u.test(editor.value[start - 1]))
    || mentions.some(mention => mention.start === start)) return null;
  const raw = editor.value.slice(start + 1, caret);
  if (!/^[\p{L}\p{M}\p{N}_ .’'-]{0,80}$/u.test(raw)) return null;
  const suffix = editor.value.slice(caret).match(/^[\p{L}\p{M}\p{N}_’'-]*/u)[0];
  return { start, end: caret + suffix.length, query: raw.trim() };
}

function mountComposer(root, { kind, ctx, onPost }) {
  const form = el('form', 'hub-card hub-composer');
  const top = el('div', 'hub-composer-top');
  const signedIn = ctx.session?.user || {};
  const identity = el('div', 'hub-composer-identity');
  identity.append(avatar(signedIn), el('h3', '', kind === 'announcement' ? 'Novo comunicado' : kind === 'celebration' ? 'Nova celebração' : 'Compartilhe com a equipe'));
  top.append(identity);
  const kindSelect = el('select', 'hub-input');
  kindSelect.append(new Option('Publicação', 'post'), new Option('Celebração', 'celebration'));
  kindSelect.value = kind || 'post';
  if (!kind) top.append(field('Tipo de publicação', kindSelect));

  const editor = el('div', 'hub-composer-editor');
  const message = el('textarea', 'hub-input hub-composer-text');
  message.rows = 3;
  message.maxLength = 2000;
  message.setAttribute('aria-label', 'Mensagem da publicação');
  message.setAttribute('aria-autocomplete', 'list');
  message.setAttribute('aria-controls', 'maxhub-mention-list');
  message.setAttribute('aria-describedby', 'maxhub-mention-hint');

  const suggestions = el('div', 'hub-mention-popup');
  suggestions.hidden = true;
  const suggestionStatus = el('div', 'hub-mention-status');
  suggestionStatus.setAttribute('role', 'status');
  const suggestionList = el('ul', 'hub-mention-list');
  suggestionList.id = 'maxhub-mention-list';
  suggestionList.setAttribute('role', 'listbox');
  suggestionList.setAttribute('aria-label', 'Pessoas para mencionar');
  suggestions.append(suggestionStatus, suggestionList);
  editor.append(message, suggestions);

  const toolbar = el('div', 'hub-composer-toolbar');
  const audienceSelect = el('select', 'hub-input');
  audienceSelect.append(new Option('Todos', 'all'), new Option('Um setor', 'sector'));
  const sectorSelect = el('select', 'hub-input');
  sectorSelect.required = true;
  sectorSelect.append(new Option('Selecione um setor', ''));
  const sectorField = field('Setor', sectorSelect);
  const toolbarFields = el('div', 'hub-composer-fields');
  toolbarFields.append(field('Quem pode ver', audienceSelect), sectorField);
  const tools = el('div', 'hub-composer-tools');
  const attach = btn('', { glyph: 'paperclip' });
  attach.classList.add('hub-composer-attach');
  attach.setAttribute('aria-label', 'Anexar imagem');
  attach.title = 'Anexar imagem';
  const hint = el('span', 'hub-composer-hint', 'Use @ para mencionar alguém');
  hint.id = 'maxhub-mention-hint';
  const count = el('span', 'hub-composer-count');
  count.hidden = true;
  const file = el('input');
  file.hidden = true;
  file.type = 'file';
  file.accept = 'image/png,image/jpeg,image/webp';
  const send = btn(kind === 'celebration' ? 'Celebrar' : 'Publicar', { glyph: 'send', type: 'submit', primary: true });
  tools.append(attach, hint, count);
  toolbar.append(tools, send);
  const feedback = status();
  const preview = el('div', 'hub-image-preview');
  preview.hidden = true;
  form.append(top, editor, toolbarFields, preview, file, toolbar, feedback.line);
  root.append(form);

  let marks = [];
  let previousText = '';
  let beforeEdit;
  let composing = false;
  let activeMention;
  let dismissedMention;
  let matches = [];
  let activeOption = -1;
  let directoryTimer;
  let directoryVersion = 0;
  let imageData;
  let fileVersion = 0;
  let reading = false;
  let submitting = false;
  let retryDraft;

  function syncKind() {
    const value = kind || kindSelect.value;
    send.lastChild.textContent = value === 'celebration' ? 'Celebrar' : 'Publicar';
    message.placeholder = value === 'celebration' ? 'O que vamos celebrar hoje?' : 'O que você quer compartilhar?';
  }

  function trackEdit({ start, end, delta }) {
    marks = marks.flatMap(mark => {
      if (mark.end <= start) return [mark];
      if (mark.start >= end) return [{ ...mark, start: mark.start + delta, end: mark.end + delta }];
      return [];
    }).filter(mark => message.value.slice(mark.start, mark.end) === `@${mark.name}`
      && !/[\p{L}\p{M}\p{N}_@]/u.test(message.value[mark.start - 1] || '')
      && !/[\p{L}\p{M}\p{N}_@]/u.test(message.value[mark.end] || ''));
    previousText = message.value;
    updateCount();
  }

  function updateCount() {
    const length = message.value.length;
    count.hidden = length < 1800;
    if (!count.hidden) count.textContent = `${number.format(length)} / ${number.format(message.maxLength)}`;
  }

  function closeSuggestions() {
    clearTimeout(directoryTimer);
    directoryVersion += 1;
    activeMention = null;
    matches = [];
    activeOption = -1;
    suggestions.hidden = true;
    suggestionList.replaceChildren();
    message.removeAttribute('aria-activedescendant');
  }

  function activateOption(index, scroll = false) {
    activeOption = index;
    for (const [position, option] of [...suggestionList.children].entries()) {
      option.setAttribute('aria-selected', String(position === index));
    }
    if (index < 0) { message.removeAttribute('aria-activedescendant'); return; }
    const option = suggestionList.children[index];
    message.setAttribute('aria-activedescendant', option.id);
    if (scroll) option.scrollIntoView({ block: 'nearest' });
  }

  function selectMention(person) {
    if (!activeMention || submitting) return;
    const people = new Set(marks.map(mark => mark.id));
    if (people.size >= 12 && !people.has(person.id)) {
      feedback.set('Marque até 12 pessoas por publicação.', true);
      closeSuggestions();
      message.focus();
      return;
    }
    const { start, end } = activeMention;
    const token = `@${person.name}`;
    const following = message.value[end];
    const insertion = following && /[\s.,!?;:)]/u.test(following) ? token : `${token} `;
    if (message.value.length - (end - start) + insertion.length > message.maxLength) {
      feedback.set('Reduza a mensagem para incluir a menção.', true);
      return;
    }
    message.setRangeText(insertion, start, end, 'end');
    trackEdit({ start, end, delta: insertion.length - (end - start) });
    marks.push({ id: person.id, name: person.name, start, end: start + token.length });
    if (following === ' ') message.setSelectionRange(start + token.length + 1, start + token.length + 1);
    closeSuggestions();
    feedback.set('');
    message.focus();
  }

  async function queryPeople(version, query) {
    try {
      const { people } = await ctx.request(`/maxhub/directory?q=${encodeURIComponent(query)}`);
      if (!ctx.active() || version !== directoryVersion) return;
      matches = people.slice(0, 8);
      suggestionStatus.textContent = matches.length ? 'Pessoas para mencionar' : 'Nenhuma pessoa encontrada.';
      for (const [index, person] of matches.entries()) {
        const option = el('li', 'hub-mention-person');
        option.id = `maxhub-mention-option-${index}`;
        option.setAttribute('role', 'option');
        const name = el('span', 'hub-mention-name', person.name);
        if (sectorNames[person.sector]) name.append(el('small', '', sectorNames[person.sector]));
        option.append(avatar(person), name);
        option.addEventListener('mousedown', event => event.preventDefault());
        option.addEventListener('click', () => selectMention(person));
        suggestionList.append(option);
      }
      activateOption(matches.length ? 0 : -1);
    } catch (error) {
      if (version !== directoryVersion || !ctx.handle(error)) return;
      suggestionStatus.textContent = 'Não foi possível buscar pessoas. Continue digitando para tentar novamente.';
    }
  }

  function syncSuggestions() {
    const mention = !composing && !submitting && mentionAtCursor(message, marks);
    if (!mention) { dismissedMention = undefined; closeSuggestions(); return; }
    const key = `${mention.start}:${mention.end}:${mention.query}`;
    if (key === activeMention?.key || key === dismissedMention) return;
    closeSuggestions();
    activeMention = { ...mention, key };
    suggestions.hidden = false;
    suggestionStatus.textContent = 'Buscando pessoas…';
    const version = directoryVersion;
    directoryTimer = setTimeout(() => void queryPeople(version, mention.query), 130);
  }

  async function getSectors() {
    if (sectorSelect.options.length > 1) return;
    try {
      const { sectors } = await ctx.request('/maxhub/directory?q=');
      if (!ctx.active()) return;
      for (const sector of sectors) {
        if (![...sectorSelect.options].some(option => option.value === sector.id)) sectorSelect.append(new Option(sector.label, sector.id));
      }
    } catch (error) {
      if (ctx.handle(error)) feedback.set('Não foi possível carregar os setores. Selecione a opção novamente.', true);
    }
  }

  function syncAudience() {
    const bySector = audienceSelect.value === 'sector';
    sectorField.hidden = !bySector;
    sectorSelect.disabled = !bySector;
    if (bySector) void getSectors();
  }

  function renderPreview() {
    preview.replaceChildren();
    preview.hidden = !imageData;
    if (!imageData) return;
    const image = el('img');
    image.src = imageData;
    image.alt = 'Prévia da imagem anexada';
    const remove = btn('Remover imagem', { glyph: 'x-lg' });
    remove.addEventListener('click', () => {
      if (submitting) return;
      imageData = undefined;
      file.value = '';
      renderPreview();
      attach.focus();
    });
    preview.append(image, remove);
  }

  async function chooseImage() {
    const current = ++fileVersion;
    reading = true;
    send.disabled = true;
    try {
      const image = await readImage(file.files[0], 1048576);
      if (!ctx.active() || current !== fileVersion || !image) return;
      imageData = image;
      renderPreview();
      feedback.set('');
    } catch (error) {
      if (ctx.active() && current === fileVersion) feedback.set(error.message, true);
    } finally {
      if (ctx.active() && current === fileVersion) {
        reading = false;
        send.disabled = submitting;
        file.value = '';
      }
    }
  }

  async function publish(event) {
    event.preventDefault();
    if (submitting || reading) return;
    const text = message.value.trim();
    if (!text && !imageData) { feedback.set('Escreva uma mensagem ou anexe uma imagem.', true); message.focus(); return; }
    const audience = audienceSelect.value === 'sector' ? { type: 'sector', sector: sectorSelect.value } : { type: 'all' };
    const postKind = kind || kindSelect.value;
    const mentions = [...new Set(marks.map(mark => mark.id))];
    const body = { kind: postKind, text, audience, mentions, ...(imageData ? { image: imageData } : {}) };
    const signature = JSON.stringify(body);
    if (retryDraft?.signature !== signature) retryDraft = { signature, id: crypto.randomUUID?.() };
    if (retryDraft.id) body.clientId = retryDraft.id;
    submitting = true;
    const controls = [kindSelect, message, audienceSelect, sectorSelect, attach, send];
    controls.forEach(control => { control.disabled = true; });
    closeSuggestions();
    feedback.set('Publicando…');
    try {
      const { post } = await ctx.request('/maxhub/feed', { method: 'POST', body });
      if (!ctx.active()) return;
      form.reset();
      retryDraft = undefined;
      marks = [];
      previousText = '';
      beforeEdit = undefined;
      imageData = undefined;
      renderPreview();
      updateCount();
      syncKind();
      onPost(post);
      feedback.set(postKind === 'celebration' ? 'Celebração publicada.' : 'Publicação enviada.');
    } catch (error) {
      if (ctx.handle(error)) feedback.set(error.message || 'Não foi possível publicar.', true);
    } finally {
      if (ctx.active()) {
        submitting = false;
        controls.forEach(control => { control.disabled = false; });
        syncAudience();
      }
    }
  }

  function closeOnOutside(event) {
    if (!editor.contains(event.target)) closeSuggestions();
  }

  message.addEventListener('beforeinput', event => {
    beforeEdit = { start: message.selectionStart, end: message.selectionEnd, type: event.inputType || '' };
  });
  message.addEventListener('input', () => {
    if (previousText !== message.value) trackEdit(editedRange(previousText, message.value, beforeEdit));
    beforeEdit = dismissedMention = undefined;
    syncSuggestions();
  });
  message.addEventListener('click', syncSuggestions);
  message.addEventListener('compositionstart', () => { composing = true; closeSuggestions(); });
  message.addEventListener('compositionend', () => { composing = false; syncSuggestions(); });
  message.addEventListener('keyup', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) syncSuggestions();
  });
  message.addEventListener('keydown', event => {
    if (!activeMention || event.isComposing) return;
    if (event.key === 'Tab' || event.key === 'Escape') {
      if (event.key === 'Escape') { event.preventDefault(); dismissedMention = activeMention.key; }
      closeSuggestions();
    } else if (matches.length && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Enter') selectMention(matches[activeOption]);
      else activateOption((activeOption + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length, true);
    }
  });
  kindSelect.addEventListener('change', syncKind);
  audienceSelect.addEventListener('change', syncAudience);
  attach.addEventListener('click', () => file.click());
  file.addEventListener('change', chooseImage);
  form.addEventListener('submit', publish);
  document.addEventListener('pointerdown', closeOnOutside);
  document.addEventListener('focusin', closeOnOutside);
  syncKind();
  syncAudience();
  return () => {
    closeSuggestions();
    document.removeEventListener('pointerdown', closeOnOutside);
    document.removeEventListener('focusin', closeOnOutside);
  };
}

function renderPost(post, ctx, onDelete) {
  const card = el('article', 'hub-card hub-post');
  card.dataset.kind = post.kind;
  const head = el('header', 'hub-post-heading');
  const identity = el('div', 'hub-post-identity');
  const names = el('div', 'hub-post-name');
  const meta = el('div', 'hub-post-meta');
  const visibility = el('span', 'hub-post-visibility');
  const audienceText = post.audience.type === 'sector' ? (sectorNames[post.audience.sector] || 'Setor selecionado')
    : post.audience.type === 'people' ? 'Destinatários selecionados' : 'Toda a equipe';
  visibility.append(icon(post.audience.type === 'all' ? 'people' : post.audience.type === 'sector' ? 'buildings' : 'person'), document.createTextNode(audienceText));
  meta.append(stamp(post.createdAt), visibility);
  names.append(el('strong', '', post.author.name), meta);
  identity.append(avatar(post.author), names);
  head.append(identity);
  if (post.kind !== 'post' && Object.hasOwn(feedKinds, post.kind)) {
    const kind = feedKinds[post.kind];
    const badge = el('span', 'hub-post-kind');
    badge.append(icon(kind.icon), document.createTextNode(kind.label));
    head.append(badge);
  }
  card.append(head);
  renderPostContent(card, post);

  const path = `/maxhub/feed/${encodeURIComponent(post.id)}`;
  if (post.hasImage) {
    const media = el('figure', 'hub-post-media');
    const image = el('img', 'hub-post-image');
    const fallback = el('p', 'hub-image-fallback', 'A imagem não está disponível.');
    fallback.hidden = true;
    image.alt = 'Imagem da publicação';
    image.decoding = 'async';
    image.loading = 'lazy';
    image.addEventListener('error', () => { image.remove(); fallback.hidden = false; }, { once: true });
    image.src = `/v1/platform${path}/image`;
    media.append(image, fallback);
    card.append(media);
  }

  const reactions = el('div', 'hub-reactions');
  const like = btn('Curtir', { glyph: 'heart' });
  const openComments = btn('Comentários', { glyph: 'chat-dots' });
  openComments.setAttribute('aria-expanded', 'false');
  const feedback = status();
  reactions.append(like, openComments);
  const comments = el('section', 'hub-comments');
  comments.setAttribute('aria-label', 'Comentários da publicação');
  comments.hidden = true;
  const body = el('div', 'hub-comments-body');
  const form = el('form', 'hub-comment-form');
  const reply = el('textarea', 'hub-input');
  reply.placeholder = 'Escreva um comentário…';
  reply.setAttribute('aria-label', 'Escreva um comentário');
  reply.required = true;
  reply.maxLength = 600;
  reply.rows = 2;
  const send = btn('Comentar', { glyph: 'send', primary: true, type: 'submit' });
  const commentStatus = status();
  form.append(reply, send, commentStatus.line);
  comments.append(body, form);
  let loadingComments = false;
  let receivedComments = false;
  let deleting = false;

  function syncReactions() {
    like.setAttribute('aria-pressed', String(post.liked));
    like.setAttribute('aria-label', post.liked ? 'Remover curtida' : 'Curtir');
    like.lastChild.textContent = post.likeCount ? `Curtir · ${number.format(post.likeCount)}` : 'Curtir';
    openComments.lastChild.textContent = post.commentCount ? `Comentários · ${number.format(post.commentCount)}` : 'Comentários';
  }

  function renderComments(data) {
    post.commentCount = data.commentCount ?? data.comments.length;
    syncReactions();
    body.replaceChildren();
    if (!data.comments.length) { body.append(info('Seja a primeira pessoa a comentar.')); return; }
    const list = el('ul', 'hub-comment-list');
    for (const comment of data.comments) {
      const row = el('li', 'hub-comment');
      const content = el('div', 'hub-comment-content');
      const identity = el('div', 'hub-comment-identity');
      identity.append(el('strong', '', comment.author.name), stamp(comment.createdAt));
      content.append(identity, el('p', '', comment.text));
      row.append(avatar(comment.author), content);
      list.append(row);
    }
    body.append(list);
  }

  async function loadComments() {
    if (loadingComments) return;
    loadingComments = true;
    body.replaceChildren(info('Carregando comentários…'));
    try {
      const result = await ctx.request(`${path}/comments`);
      if (!ctx.active() || !card.isConnected) return;
      receivedComments = true;
      renderComments(result);
    } catch (error) {
      if (ctx.handle(error) && card.isConnected) body.replaceChildren(info('Não foi possível carregar os comentários.', { error: true, retry: loadComments }));
    } finally {
      loadingComments = false;
    }
  }

  like.addEventListener('click', async () => {
    if (like.disabled || deleting) return;
    like.disabled = true;
    feedback.set('');
    try {
      const result = await ctx.request(`${path}/like`, { method: post.liked ? 'DELETE' : 'PUT' });
      if (!ctx.active() || !card.isConnected) return;
      post.liked = result.liked;
      post.likeCount = result.likeCount;
      syncReactions();
    } catch (error) {
      if (ctx.handle(error) && card.isConnected) feedback.set(error.message || 'Não foi possível atualizar a curtida.', true);
    } finally {
      like.disabled = false;
    }
  });

  openComments.addEventListener('click', () => {
    comments.hidden = !comments.hidden;
    openComments.setAttribute('aria-expanded', String(!comments.hidden));
    if (!comments.hidden && !receivedComments) void loadComments();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = reply.value.trim();
    if (send.disabled || deleting || !text) return;
    send.disabled = reply.disabled = true;
    commentStatus.set('Enviando comentário…');
    try {
      const result = await ctx.request(`${path}/comments`, { method: 'POST', body: { text } });
      if (!ctx.active() || !card.isConnected) return;
      renderComments(result);
      receivedComments = true;
      reply.value = '';
      commentStatus.set('Comentário publicado.');
    } catch (error) {
      if (ctx.handle(error) && card.isConnected) commentStatus.set(error.message || 'Não foi possível comentar.', true);
    } finally {
      send.disabled = reply.disabled = false;
    }
  });

  if (post.canDelete) {
    const remove = btn('Excluir');
    remove.classList.add('hub-post-remove');
    const confirm = el('div', 'hub-post-confirm');
    confirm.hidden = true;
    const apply = btn('Confirmar exclusão', { primary: true });
    const cancel = btn('Cancelar');
    confirm.append(el('p', '', 'Excluir esta publicação?'), apply, cancel);
    remove.addEventListener('click', () => { confirm.hidden = false; apply.focus(); });
    cancel.addEventListener('click', () => { confirm.hidden = true; remove.focus(); });
    apply.addEventListener('click', async () => {
      if (deleting) return;
      deleting = true;
      apply.disabled = cancel.disabled = remove.disabled = true;
      feedback.set('');
      try {
        await ctx.request(path, { method: 'DELETE' });
        if (ctx.active()) onDelete();
      } catch (error) {
        if (ctx.handle(error) && card.isConnected) feedback.set(error.message || 'Não foi possível excluir a publicação.', true);
      } finally {
        deleting = false;
        apply.disabled = cancel.disabled = remove.disabled = false;
      }
    });
    reactions.append(remove);
    card.append(reactions, confirm, feedback.line, comments);
  } else {
    card.append(reactions, feedback.line, comments);
  }

  syncReactions();
  return card;
}

function renderPostContent(card, { text, mentions }) {
  const identified = new Set();
  if (text) {
    const content = el('p', 'hub-post-text');
    const names = [...new Set(mentions.map(person => `@${person.name}`))]
      .sort((a, b) => b.length - a.length)
      .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    let start = 0;
    if (names.length) {
      const matchMention = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_@])(?:${names.join('|')})(?![\\p{L}\\p{M}\\p{N}_])`, 'gu');
      for (const match of text.matchAll(matchMention)) {
        const [mention] = match;
        content.append(document.createTextNode(text.slice(start, match.index)), el('span', 'hub-post-mention', mention));
        identified.add(mention);
        start = match.index + mention.length;
      }
    }
    content.append(document.createTextNode(text.slice(start)));
    card.append(content);
  }

  const remaining = mentions.filter(person => !identified.has(`@${person.name}`));
  if (remaining.length) {
    const tags = el('ul', 'hub-mentions');
    tags.setAttribute('aria-label', 'Pessoas marcadas');
    for (const person of remaining) tags.append(el('li', '', `@${person.name}`));
    card.append(tags);
  }
}

function mountFeed(root, area, ctx) {
  const definition = feedSections[area];
  const layout = el('div', area === 'home' ? 'hub-feed-layout' : 'hub-feed-layout hub-feed-single');
  const column = el('section', 'hub-feed-column');
  layout.append(column);
  root.append(layout);
  const composer = el('div', 'hub-composer-mount');
  const feed = el('section', 'hub-feed');
  const heading = el('div', 'hub-feed-heading');
  const title = panelHeading(definition.title, definition.kind ? feedKinds[definition.kind].icon : 'chat-square-text');
  const refresh = btn('Atualizar', { glyph: 'arrow-clockwise' });
  heading.append(title, refresh);
  const results = el('div', 'hub-feed-posts');
  const eventStatus = status();
  const next = btn('Carregar mais');
  next.hidden = true;
  feed.append(heading, eventStatus.line, results, next);
  column.append(composer, feed);
  const isHrEditor = ['edit', 'manage'].includes(ctx.session?.permissions?.rh);
  const canCompose = definition.kind !== 'announcement' || isHrEditor || ctx.session?.user?.role === 'admin';
  const posts = new Map();
  let cursor = null;
  let version = 0;
  let loading = false;

  function notifyRanking() {
    window.dispatchEvent(new Event('maxhub:points-change'));
  }

  function postCard(post) {
    return renderPost(post, ctx, () => {
      posts.delete(post.id);
      const removed = [...results.querySelectorAll('[data-post-id]')].find(item => item.dataset.postId === post.id);
      const successor = removed?.nextElementSibling || removed?.previousElementSibling;
      removed?.remove();
      if (!posts.size) results.replaceChildren(info(definition.empty));
      const nextControl = successor?.querySelector('button') || refresh;
      nextControl.focus({ preventScroll: true });
      eventStatus.set('Publicação excluída.');
      if (post.kind === 'celebration') notifyRanking();
    });
  }

  function appendPost(post, before = false) {
    if (posts.has(post.id)) return;
    const card = postCard(post);
    card.dataset.postId = post.id;
    if (before) {
      const existing = [...posts.entries()];
      if (!existing.length) results.replaceChildren();
      posts.clear();
      posts.set(post.id, post);
      for (const [id, item] of existing) posts.set(id, item);
      results.prepend(card);
    } else {
      if (!posts.size) results.replaceChildren();
      posts.set(post.id, post);
      results.append(card);
    }
  }

  async function load(append = false) {
    if (append && (!cursor || loading)) return;
    const current = ++version;
    loading = true;
    refresh.disabled = next.disabled = true;
    eventStatus.set('');
    if (!posts.size) results.replaceChildren(info('Carregando publicações…'));
    const filters = new URLSearchParams();
    if (definition.kind) filters.set('kind', definition.kind);
    if (append) filters.set('cursor', cursor);
    try {
      const result = await ctx.request(`/maxhub/feed${filters.size ? `?${filters}` : ''}`);
      if (!ctx.active() || current !== version) return;
      if (!append) { posts.clear(); results.replaceChildren(); }
      for (const post of result.posts) appendPost(post);
      if (!posts.size) results.replaceChildren(info(definition.empty));
      cursor = result.nextCursor;
      next.hidden = !cursor;
    } catch (error) {
      if (current !== version || !ctx.handle(error)) return;
      if (posts.size) eventStatus.set('Não foi possível atualizar o feed. Tente novamente.', true);
      else results.replaceChildren(info('Não foi possível carregar o feed.', { error: true, retry: () => load() }));
    } finally {
      if (current === version) {
        loading = false;
        refresh.disabled = next.disabled = false;
      }
    }
  }

  const disposeComposer = canCompose ? mountComposer(composer, {
    kind: definition.kind,
    ctx,
    onPost(post) {
      if (loading) {
        version += 1;
        loading = false;
        refresh.disabled = next.disabled = false;
      }
      eventStatus.set('');
      appendPost(post, true);
      if (post.kind === 'celebration') notifyRanking();
    },
  }) : undefined;
  const aside = el('aside', 'hub-rank-aside');
  if (area === 'home') layout.append(aside);
  const disposeRanking = area === 'home' ? mountRanking(aside, ctx, true) : undefined;
  refresh.addEventListener('click', () => void load());
  next.addEventListener('click', () => void load(true));
  void load();
  return () => { disposeComposer?.(); disposeRanking?.(); };
}

function mountRanking(root, ctx, compact = false) {
  const panel = el('section', `hub-card hub-ranking${compact ? ' hub-ranking-compact' : ''}`);
  const header = el('div', 'hub-ranking-header');
  const mark = el('span', 'hub-ranking-mark');
  mark.append(icon('graph-up'));
  const headingText = el('div', 'hub-ranking-heading');
  headingText.append(el('h2', '', 'Ranking de Maxcoin'));
  header.append(mark, headingText);
  const results = el('div', 'hub-ranking-results');
  panel.append(header, results);
  root.append(panel);
  let version = 0;

  function render({ entries, my }) {
    const current = el('div', 'hub-ranking-me');
    current.append(el('span', '', 'Sua posição'), el('strong', '', my.rank ? `${my.rank}º` : '—'));
    const list = el('ol', 'hub-ranking-list');
    for (const entry of (compact ? entries.slice(0, 5) : entries)) {
      const item = el('li', 'hub-ranking-entry');
      if (entry.rank >= 1 && entry.rank <= 3) item.dataset.position = entry.rank;
      if (entry.id === ctx.session?.user?.id) item.dataset.me = 'true';
      const position = el('span', 'hub-rank-position', `${entry.rank}º`);
      const person = el('span', 'hub-rank-person', entry.name);
      const points = el('strong', 'hub-rank-points', number.format(entry.points));
      points.setAttribute('aria-label', `${number.format(entry.points)} Maxcoin`);
      item.append(position, avatar(entry), person, points);
      list.append(item);
    }
    results.replaceChildren(current, list.childElementCount ? list : info('O ranking será preenchido conforme a equipe acumular Maxcoin.'));
  }

  async function load() {
    const current = ++version;
    if (!results.firstElementChild) results.replaceChildren(info('Carregando ranking…'));
    try {
      const data = await ctx.request('/maxhub/leaderboard');
      if (ctx.active() && current === version) render(data);
    } catch (error) {
      if (current === version && ctx.handle(error)) results.replaceChildren(info('Não foi possível carregar o ranking.', { error: true, retry: load }));
    }
  }
  window.addEventListener('maxhub:points-change', load);
  void load();
  return () => window.removeEventListener('maxhub:points-change', load);
}

function mountHistory(root, ctx) {
  const section = el('section', 'hub-card hub-history');
  section.append(panelHeading('Histórico de Maxcoin', 'clock-history'));
  const results = el('div', 'hub-history-results');
  section.append(results);
  root.append(section);
  let version = 0;

  function entriesList(entries) {
    if (!entries.length) return info('Seu histórico de pontuação começa com a primeira atividade registrada.');
    const list = el('ul', 'hub-history-list');
    for (const entry of entries) {
      const row = el('li', 'hub-history-row');
      const event = el('div', 'hub-history-event');
      event.append(el('strong', '', entry.label), stamp(entry.createdAt));
      row.append(event, el('span', 'hub-history-amount', `+${number.format(entry.points)} Maxcoin`));
      list.append(row);
    }
    return list;
  }

  function render({ total, rules, entries }) {
    const layout = el('div', 'hub-history-grid');
    const history = el('div', 'hub-history-entries');
    history.append(el('h3', '', 'Minhas atividades'), entriesList(entries));
    const guide = el('div', 'hub-history-rules');
    const table = el('dl', 'hub-rules');
    for (const rule of rules) {
      const row = el('div', 'hub-rule-row');
      row.append(el('dt', '', rule.label), el('dd', '', `${number.format(rule.points)} Maxcoin`));
      table.append(row);
    }
    guide.append(el('h3', '', 'Como ganhar Maxcoin'), table);
    layout.append(history, guide);
    const balance = el('div', 'hub-history-balance');
    balance.append(el('span', '', 'Meu saldo'), el('strong', '', `${number.format(total)} Maxcoin`));
    results.replaceChildren(balance, layout);
  }

  async function load() {
    const seq = ++version;
    results.replaceChildren(info('Carregando histórico…'));
    try {
      const data = await ctx.request('/maxhub/points');
      if (ctx.active() && seq === version) render(data);
    } catch (error) {
      if (seq === version && ctx.handle(error)) results.replaceChildren(info('Não foi possível carregar o histórico.', { error: true, retry: load }));
    }
  }
  void load();
}

function mountProfile(root, ctx) {
  const section = el('section', 'hub-profile');
  const overview = el('div', 'hub-card hub-profile-overview');
  const form = el('form', 'hub-card hub-profile-form');
  form.hidden = true;
  const formHeading = panelHeading('Editar perfil', 'person-badge', 'h3');
  const biography = el('textarea', 'hub-input');
  biography.rows = 5;
  biography.maxLength = 600;
  biography.placeholder = 'Conte um pouco sobre você…';
  const description = field('Descrição', biography);
  const count = el('small', 'hub-profile-count');
  const photoActions = el('div', 'hub-profile-actions');
  const file = el('input');
  file.type = 'file';
  file.accept = 'image/png,image/jpeg,image/webp';
  file.hidden = true;
  const choose = btn('Trocar foto', { glyph: 'paperclip' });
  const remove = btn('Remover foto', { glyph: 'x-lg' });
  const save = btn('Salvar perfil', { glyph: 'check2', type: 'submit', primary: true });
  const photoHelp = el('span', 'hub-profile-note', 'PNG, JPG ou WebP até 450 KB.');
  photoActions.append(choose, remove, photoHelp);
  const feedback = status();
  form.append(formHeading, photoActions, file, description, count, save, feedback.line);
  const badges = el('section', 'hub-card hub-profile-badges');
  badges.hidden = true;
  section.append(overview, form, badges);
  root.append(section);

  let current;
  let nextPhoto;
  let photoVersion = 0;
  let reading = false;
  let saving = false;

  function renderOverview() {
    const title = el('div', 'hub-profile-name');
    const source = nextPhoto === null ? '' : nextPhoto;
    title.append(el('h2', '', 'Meu perfil'), el('strong', '', current.name));
    if (current.sector && sectorNames[current.sector]) title.append(el('p', '', sectorNames[current.sector]));
    const points = el('div', 'hub-profile-points');
    points.append(el('strong', '', number.format(current.points)), el('span', '', 'Maxcoin'));
    overview.replaceChildren(avatar(current, { large: true, source }), title, points);
    remove.hidden = nextPhoto === null || (!nextPhoto && !current.hasAvatar);
  }

  function renderBadges() {
    const rows = el('ul', 'hub-profile-badge-list');
    for (const badge of current.badges) {
      const row = el('li', 'hub-profile-badge');
      const mark = el('span', 'hub-profile-badge-mark');
      const content = el('div');
      const glyph = ['check2', 'gift', 'graph-up', 'people', 'clock-history', 'broadcast', 'person-badge'].includes(badge.icon) ? badge.icon : 'gift';
      mark.append(icon(glyph));
      content.append(el('strong', '', badge.label), el('p', '', badge.description));
      row.append(mark, content);
      rows.append(row);
    }
    badges.replaceChildren(
      panelHeading('Meus emblemas', 'gift', 'h3'),
      rows.childElementCount ? rows : info('Seus emblemas vão aparecer aqui conforme você participa do MaxHub.'),
    );
  }

  function renderCount() {
    count.textContent = `${biography.value.length} de ${biography.maxLength} caracteres`;
  }

  async function load() {
    overview.replaceChildren(info('Carregando perfil…'));
    try {
      current = await ctx.request('/maxhub/profile');
      if (!ctx.active()) return;
      biography.value = current.bio || '';
      renderCount();
      renderOverview();
      renderBadges();
      form.hidden = badges.hidden = false;
    } catch (error) {
      if (ctx.handle(error)) overview.replaceChildren(info('Não foi possível abrir o perfil.', { error: true, retry: load }));
    }
  }

  function syncControls() {
    save.disabled = reading || saving;
    remove.disabled = choose.disabled = saving;
    biography.disabled = saving;
  }

  choose.addEventListener('click', () => file.click());
  remove.addEventListener('click', () => {
    photoVersion += 1;
    reading = false;
    nextPhoto = null;
    file.value = '';
    renderOverview();
    syncControls();
    choose.focus();
  });
  file.addEventListener('change', async () => {
    const version = ++photoVersion;
    reading = true;
    syncControls();
    try {
      const data = await readImage(file.files[0], 460800);
      if (!ctx.active() || version !== photoVersion || !data) return;
      nextPhoto = data;
      renderOverview();
      feedback.set('');
    } catch (error) {
      if (ctx.active() && version === photoVersion) feedback.set(error.message, true);
    } finally {
      if (ctx.active() && version === photoVersion) {
        reading = false;
        file.value = '';
        syncControls();
      }
    }
  });
  biography.addEventListener('input', renderCount);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || reading) return;
    saving = true;
    syncControls();
    feedback.set('Salvando perfil…');
    try {
      const body = { bio: biography.value.trim() };
      if (nextPhoto !== undefined) body.photo = nextPhoto;
      const result = await ctx.request('/maxhub/profile', { method: 'PUT', body });
      if (!ctx.active()) return;
      current = result;
      nextPhoto = undefined;
      biography.value = current.bio || '';
      renderCount();
      renderOverview();
      renderBadges();
      feedback.set('Perfil atualizado.');
      ctx.onProfileChange?.(current);
    } catch (error) {
      if (ctx.handle(error)) feedback.set(error.message || 'Não foi possível atualizar o perfil.', true);
    } finally {
      if (ctx.active()) {
        saving = false;
        syncControls();
      }
    }
  });
  void load();
}

export function mountMaxHubSocial(root, { area, request, onAuthError, onProfileChange, session }) {
  let disposed = false;
  const ctx = {
    session,
    request,
    onProfileChange,
    active: () => !disposed,
    handle(error) {
      if (disposed) return false;
      if (error?.status === 401) {
        onAuthError?.(error);
        return false;
      }
      return true;
    },
  };
  root.classList.add('maxhub-social');
  root.replaceChildren();
  let cleanup;
  if (Object.hasOwn(feedSections, area)) cleanup = mountFeed(root, area, ctx);
  else if (area === 'ranking') cleanup = mountRanking(root, ctx);
  else if (area === 'history') mountHistory(root, ctx);
  else if (area === 'profile') mountProfile(root, ctx);
  return () => {
    disposed = true;
    cleanup?.();
    root.replaceChildren();
  };
}
