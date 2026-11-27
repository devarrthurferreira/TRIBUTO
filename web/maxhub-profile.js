import { appendPersonName, tenureBadge } from './person-name.js';

const number = new Intl.NumberFormat('pt-BR');
const month = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const primaryLinks = [
  ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['tiktok', 'TikTok'],
];
const socialNetworks = [
  ...primaryLinks,
  ['facebook', 'Facebook'], ['whatsapp', 'WhatsApp'], ['youtube', 'YouTube'], ['x', 'X (Twitter)'],
  ['threads', 'Threads'], ['telegram', 'Telegram'], ['pinterest', 'Pinterest'], ['snapchat', 'Snapchat'],
  ['reddit', 'Reddit'], ['discord', 'Discord'], ['twitch', 'Twitch'], ['bluesky', 'Bluesky'], ['mastodon', 'Mastodon'],
  ['github', 'GitHub'], ['gitlab', 'GitLab'], ['bitbucket', 'Bitbucket'], ['stack-overflow', 'Stack Overflow'],
  ['behance', 'Behance'], ['dribbble', 'Dribbble'], ['medium', 'Medium'], ['substack', 'Substack'],
  ['spotify', 'Spotify'], ['soundcloud', 'SoundCloud'], ['deezer', 'Deezer'], ['vimeo', 'Vimeo'],
  ['flickr', 'Flickr'], ['linktree', 'Linktree'], ['website', 'Site ou portfólio'], ['other', 'Outra rede ou plataforma'],
];
const educationTypes = new Map([
  ['curso', 'Curso'], ['tecnico', 'Curso técnico'], ['graduacao', 'Graduação / Faculdade'],
  ['pos-graduacao', 'Pós-graduação'], ['mba', 'MBA'], ['mestrado', 'Mestrado'], ['doutorado', 'Doutorado'],
  ['certificacao', 'Certificação'], ['extensao', 'Extensão'], ['workshop', 'Workshop'],
]);
const maxSkills = 24;
const maxLinks = 30;
const maxEducation = 30;

const markup = `
  <section class="hub-profile" aria-labelledby="maxHubProfileTitle">
    <header class="hub-card hub-profile-overview">
      <button class="hub-profile-avatar-button" type="button" aria-label="Editar foto do perfil" data-profile="avatar" hidden>
        <span data-profile="avatarImage"></span>
        <span class="hub-profile-camera"><i class="bi bi-camera" aria-hidden="true"></i></span>
      </button>
      <div class="hub-profile-name">
        <h2 id="maxHubProfileTitle">Meu perfil</h2>
        <strong data-profile="name"></strong>
        <p data-profile="sector" hidden></p><small>Perfil comportamental · Em breve</small>
      </div>
      <aside class="profile-pet"><i class="bi bi-stars"></i> Pet Maximum <small>Em breve</small></aside>
      <button type="button" class="hub-btn" data-profile="share" hidden>Compartilhar perfil</button>
    </header>

    <div class="hub-info" role="status" data-profile="loadStatus">
      <p data-profile="loadText">Carregando perfil…</p>
      <button type="button" class="hub-btn" data-profile="retry" hidden>Tentar novamente</button>
    </div>

    <section class="hub-profile-edit" aria-labelledby="maxHubEditProfileTitle" data-profile="content" hidden>
      <h3 id="maxHubEditProfileTitle">Editar Perfil</h3>
      <div class="hub-profile-grid">
        <form class="hub-card hub-profile-form" data-profile="detailsForm">
          <div class="hub-heading">
            <span class="hub-heading-icon"><i class="bi bi-person-badge" aria-hidden="true"></i></span>
            <h4>Informações</h4>
          </div>
          <label class="hub-field">
            <span>Biografia</span>
            <textarea class="hub-input" data-profile="bio" rows="4" maxlength="600" placeholder="Conte um pouco sobre você…"></textarea>
          </label>
          <div class="hub-profile-field-stack">
            <label class="hub-field" for="maxHubSkillInput">Habilidades</label>
            <div class="hub-profile-inline">
              <input id="maxHubSkillInput" class="hub-input" data-profile="skillText" maxlength="60" placeholder="Digite uma habilidade" autocomplete="off">
              <button class="hub-btn" type="button" data-profile="addSkill"><i class="bi bi-plus-lg" aria-hidden="true"></i>Adicionar</button>
            </div>
            <ul class="hub-profile-skills" aria-label="Habilidades adicionadas" data-profile="skills"></ul>
          </div>
          <fieldset class="hub-profile-links">
            <legend>Links pessoais</legend>
            <div class="hub-profile-primary-links" data-profile="primaryLinks"></div>
            <div class="hub-profile-custom-links" data-profile="customLinks"></div>
            <button class="hub-btn" type="button" data-profile="addLink"><i class="bi bi-plus-lg" aria-hidden="true"></i>Adicionar link pessoal</button>
          </fieldset>
          <div class="hub-profile-actions">
            <button class="hub-btn hub-btn-primary" type="submit" data-profile="saveDetails"><i class="bi bi-check2" aria-hidden="true"></i>Salvar informações</button>
            <p class="hub-status" role="status" data-profile="detailsStatus" hidden></p>
          </div>
        </form>

        <section class="hub-card hub-profile-education" aria-labelledby="maxHubEducationTitle">
          <div class="hub-heading">
            <span class="hub-heading-icon"><i class="bi bi-mortarboard" aria-hidden="true"></i></span>
            <h4 id="maxHubEducationTitle">Educação</h4>
          </div>
          <p class="hub-profile-note" data-profile="educationEmpty">Adicione suas formações, cursos e certificações.</p>
          <ul class="hub-profile-education-list" data-profile="educationList"></ul>
          <button class="hub-btn" type="button" data-profile="addEducation"><i class="bi bi-plus-lg" aria-hidden="true"></i>Adicionar formação</button>
          <p class="hub-status" role="status" data-profile="educationStatus" hidden></p>
        </section>
      </div>

      <section class="hub-card hub-profile-badges" aria-labelledby="maxHubBadgesTitle">
        <div class="hub-heading">
          <span class="hub-heading-icon"><i class="bi bi-award" aria-hidden="true"></i></span>
          <h4 id="maxHubBadgesTitle">Meus emblemas</h4>
        </div>
        <div class="hub-profile-tenure" data-profile="tenure" hidden>
          <h5>Emblemas por tempo de empresa</h5>
          <ul class="hub-profile-tenure-list" data-profile="tenureList"></ul>
        </div>
        <ul class="hub-profile-badge-list" data-profile="badges"></ul>
      </section>
    </section>

    <dialog class="hub-profile-dialog hub-profile-photo-dialog" aria-labelledby="maxHubPhotoTitle" data-profile="photoDialog">
      <form class="hub-profile-dialog-form" data-profile="photoForm">
        <header class="hub-profile-dialog-header">
          <h3 id="maxHubPhotoTitle">Editar foto do perfil</h3>
          <button type="button" class="hub-btn hub-profile-icon-button" aria-label="Fechar edição de foto" data-profile="closePhoto"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        </header>
        <div class="hub-profile-dialog-body hub-profile-photo-body">
          <div data-profile="photoPreview"></div>
          <div class="hub-profile-actions">
            <input type="file" accept="image/png,image/jpeg,image/webp" data-profile="photoFile" hidden>
            <button type="button" class="hub-btn" data-profile="choosePhoto"><i class="bi bi-camera" aria-hidden="true"></i>Escolher foto</button>
            <button type="button" class="hub-btn" data-profile="removePhoto"><i class="bi bi-trash" aria-hidden="true"></i>Remover foto</button>
          </div>
          <p class="hub-profile-note">PNG, JPG ou WebP até 450 KB.</p>
          <p class="hub-status" role="status" data-profile="photoStatus" hidden></p>
        </div>
        <footer class="hub-profile-dialog-footer">
          <button type="button" class="hub-btn" data-profile="cancelPhoto">Cancelar</button>
          <button type="submit" class="hub-btn hub-btn-primary" data-profile="savePhoto">Salvar foto</button>
        </footer>
      </form>
    </dialog>

    <dialog class="hub-profile-dialog hub-profile-education-drawer" aria-labelledby="maxHubEducationDialogTitle" data-profile="educationDialog">
      <form class="hub-profile-dialog-form" data-profile="educationForm">
        <header class="hub-profile-dialog-header">
          <h3 id="maxHubEducationDialogTitle" data-profile="educationHeading">Adicionar formação</h3>
          <button type="button" class="hub-btn hub-profile-icon-button" aria-label="Fechar formação" data-profile="closeEducation"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        </header>
        <div class="hub-profile-dialog-body">
          <div class="hub-profile-education-fields">
            <label class="hub-field">
              <span>Tipo de formação</span>
              <select class="hub-input" aria-label="Tipo de formação" data-profile="educationType" required></select>
            </label>
            <label class="hub-field" data-profile="customTypeField" hidden>
              <span>Qual tipo de formação?</span>
              <input class="hub-input" data-profile="customType" maxlength="60" disabled>
            </label>
            <label class="hub-field">
              <span>Nome da formação</span>
              <input class="hub-input" data-profile="educationName" maxlength="120" required>
            </label>
            <label class="hub-field">
              <span>Instituição de ensino</span>
              <input class="hub-input" data-profile="educationInstitution" maxlength="120">
            </label>
            <label class="hub-field">
              <span>Início</span>
              <input class="hub-input" type="month" data-profile="educationStart">
            </label>
            <label class="hub-field">
              <span>Conclusão</span>
              <input class="hub-input" type="month" data-profile="educationEnd">
            </label>
            <label class="hub-profile-check">
              <input type="checkbox" data-profile="educationOngoing">Em andamento
            </label>
            <label class="hub-field hub-profile-full-field">
              <span>Link do certificado ou diploma</span>
              <input class="hub-input" type="url" data-profile="educationUrl" maxlength="2048" placeholder="https://…">
            </label>
            <label class="hub-field hub-profile-full-field">
              <span>Descrição da formação</span>
              <textarea class="hub-input" data-profile="educationDescription" rows="4" maxlength="800"></textarea>
            </label>
            <p class="hub-status hub-profile-full-field" role="status" data-profile="educationDialogStatus" hidden></p>
          </div>
        </div>
        <footer class="hub-profile-dialog-footer">
          <button type="button" class="hub-btn hub-profile-remove" data-profile="removeEducation">Remover formação</button>
          <button type="button" class="hub-btn" data-profile="cancelEducation">Cancelar</button>
          <button type="submit" class="hub-btn hub-btn-primary" data-profile="saveEducation">Salvar formação</button>
        </footer>
      </form>
    </dialog>
  </section>
`;

function el(tag, className = '', text = '') {
  const item = document.createElement(tag);
  item.className = className;
  item.textContent = text;
  return item;
}

function icon(name) {
  const item = el('i', `bi bi-${name}`);
  item.setAttribute('aria-hidden', 'true');
  return item;
}

function button(label, glyph) {
  const item = el('button', 'hub-btn');
  item.type = 'button';
  if (glyph) item.append(icon(glyph));
  item.append(label);
  return item;
}

function inputLabel(label, control) {
  const item = el('label', 'hub-field');
  item.append(el('span', '', label), control);
  return item;
}

function message(target, text = '', error = false) {
  target.textContent = text;
  target.hidden = !text;
  target.dataset.error = String(error);
}

function webUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function urlInput(value = '') {
  const input = el('input', 'hub-input');
  input.type = 'url';
  input.placeholder = 'https://…';
  input.maxLength = 2048;
  input.value = value;
  return input;
}

function employmentTenure(years, list) {
  const rows = document.createDocumentFragment();
  for (let year = 1; year <= years; year += 1) {
    const item = el('li', 'hub-profile-tenure-entry');
    item.append(tenureBadge(year), el('span', '', year === 1 ? '1 ano' : `${year} anos`));
    rows.append(item);
  }
  list.replaceChildren(rows);
}

function educationDate(value) {
  const date = new Date(`${value}-01T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : month.format(date).replace('.', '');
}

export function mountMaxHubProfile(root, ctx, { avatar, readImage, sectorNames }) {
  root.insertAdjacentHTML('beforeend', markup);
  const ui = Object.fromEntries([...root.querySelectorAll('[data-profile]')].map(node => [node.dataset.profile, node]));
  let current;
  let skills = [];
  let primary = [];
  let custom = [];
  let editingEducation;
  let confirmingRemoval = false;
  let photoDraft;
  let photoVersion = 0;
  let reading = false;
  let saving = false;

  for (const [value, label] of educationTypes) ui.educationType.append(new Option(label, value));
  ui.educationType.append(new Option('Outro tipo', 'other'));

  function renderIdentity() {
    ui.avatarImage.replaceChildren(avatar(current, { large: true }));
    ui.name.replaceChildren();
    appendPersonName(ui.name, current.name, current.tenureYears);
    ui.sector.textContent = sectorNames[current.sector] || '';
    ui.sector.hidden = !ui.sector.textContent;
    ui.avatar.hidden = false;
    ui.share.hidden = false;
  }

  function renderBadges() {
    const years = Number.isInteger(current.tenureYears) ? current.tenureYears : 0;
    ui.tenure.hidden = years < 1;
    employmentTenure(years, ui.tenureList);
    const glyphs = ['check2', 'gift', 'graph-up', 'people', 'clock-history', 'broadcast', 'person-badge'];
    ui.badges.replaceChildren(...(current.badges || []).map(badge => {
      const item = el('li', 'hub-profile-badge');
      const mark = el('span', 'hub-profile-badge-mark');
      mark.append(icon(glyphs.includes(badge.icon) ? badge.icon : 'award'));
      const content = el('div');
      content.append(el('strong', '', badge.label), el('p', '', badge.description));
      item.append(mark, content);
      return item;
    }));
  }

  function renderSkills() {
    ui.skills.replaceChildren(...skills.map(skill => {
      const item = el('li', 'hub-profile-skill');
      const remove = button('', 'x-lg');
      remove.setAttribute('aria-label', `Remover habilidade: ${skill}`);
      remove.addEventListener('click', () => {
        skills = skills.filter(value => value !== skill);
        renderSkills();
        ui.skillText.focus();
      });
      item.append(el('span', '', skill), remove);
      return item;
    }));
    ui.addSkill.disabled = saving || skills.length >= maxSkills;
    ui.skillText.disabled = saving || skills.length >= maxSkills;
  }

  function addSkill() {
    const skill = ui.skillText.value.trim();
    if (!skill) return true;
    if (skills.length >= maxSkills) {
      message(ui.detailsStatus, `Você pode adicionar até ${maxSkills} habilidades.`, true);
      return false;
    }
    if (!skills.some(value => value.toLocaleLowerCase('pt-BR') === skill.toLocaleLowerCase('pt-BR'))) skills.push(skill);
    ui.skillText.value = '';
    renderSkills();
    return true;
  }

  function updateLinkLimit() {
    const completed = primary.filter(row => row.url.value.trim()).length;
    ui.addLink.disabled = saving || completed + custom.length >= maxLinks;
  }

  function addCustomLink(link = {}) {
    const fieldset = el('fieldset', 'hub-profile-custom-link');
    fieldset.append(el('legend', 'sr-only', 'Link pessoal adicional'));
    const kind = el('select', 'hub-input');
    kind.setAttribute('aria-label', 'Rede ou plataforma');
    for (const [value, label] of socialNetworks) kind.append(new Option(label, value));
    const platform = link.platform || 'website';
    if (!socialNetworks.some(([id]) => id === platform)) kind.append(new Option(platform, platform));
    kind.value = platform;
    const label = el('input', 'hub-input');
    label.maxLength = 100;
    label.placeholder = 'Ex.: Meu portfólio';
    label.value = link.label || '';
    const url = urlInput(link.url);
    const remove = button('', 'trash');
    remove.classList.add('hub-profile-icon-button');
    remove.setAttribute('aria-label', 'Remover link pessoal');
    const row = { id: link.id, kind, label, url };
    custom.push(row);
    remove.addEventListener('click', () => {
      custom = custom.filter(item => item !== row);
      fieldset.remove();
      updateLinkLimit();
      (ui.addLink.disabled ? ui.saveDetails : ui.addLink).focus();
    });
    fieldset.append(inputLabel('Rede ou plataforma', kind), inputLabel('Nome do link', label), inputLabel('URL', url), remove);
    ui.customLinks.append(fieldset);
    updateLinkLimit();
    return kind;
  }

  function renderInformation() {
    ui.bio.value = current.bio || '';
    skills = [...(current.skills || [])];
    renderSkills();
    const links = [...(current.personalLinks || [])];
    primary = primaryLinks.map(([platform, label]) => {
      const found = links.findIndex(link => link.platform === platform);
      const previous = found < 0 ? {} : links.splice(found, 1)[0];
      const url = urlInput(previous.url);
      url.addEventListener('input', updateLinkLimit);
      return { platform, label, previous, url };
    });
    ui.primaryLinks.replaceChildren(...primary.map(row => {
      const field = inputLabel(row.label, row.url);
      field.firstElementChild.prepend(icon(row.platform));
      return field;
    }));
    ui.customLinks.replaceChildren();
    custom = [];
    links.forEach(addCustomLink);
    updateLinkLimit();
  }

  function collectLinks() {
    const links = [
      ...primary.map(({ platform, previous, url }) => ({ id: previous.id, platform, label: previous.label, url })),
      ...custom.map(({ id, kind, label, url }) => ({ id, platform: kind.value, label: label.value.trim(), url })),
    ];
    const result = [];
    for (const link of links) {
      const value = link.url.value.trim();
      if (!value && (!link.label || primary.some(row => row.url === link.url))) continue;
      const url = webUrl(value);
      if (!url) {
        message(ui.detailsStatus, 'Digite um endereço completo que comece com https:// ou http://.', true);
        link.url.focus();
        return null;
      }
      result.push({ id: link.id, platform: link.platform, label: link.label || undefined, url });
    }
    if (result.length > maxLinks) {
      message(ui.detailsStatus, `Você pode salvar até ${maxLinks} links pessoais.`, true);
      return null;
    }
    return result;
  }

  function setBusy(value) {
    saving = value;
    for (const control of root.querySelectorAll('button, input, select, textarea')) {
      control.disabled = value;
    }
    ui.addEducation.disabled = value || (current?.education?.length || 0) >= maxEducation;
    ui.addSkill.disabled = ui.skillText.disabled = value || skills.length >= maxSkills;
    updateLinkLimit();
    syncPhoto();
    syncEducation();
  }

  async function save(body, status, changed) {
    if (saving) return;
    let focus = document.activeElement;
    setBusy(true);
    message(status, 'Salvando…');
    try {
      current = await ctx.request('/maxhub/profile', { method: 'PUT', body });
      if (!ctx.active()) return;
      focus = changed() || focus;
    } catch (error) {
      if (ctx.handle(error)) message(status, error.message || 'Não foi possível salvar a alteração.', true);
    } finally {
      if (ctx.active()) {
        setBusy(false);
        focus?.focus({ preventScroll: true });
      }
    }
  }

  function renderEducation() {
    const entries = current.education || [];
    ui.educationEmpty.hidden = entries.length > 0;
    ui.educationList.replaceChildren(...entries.map(entry => {
      const item = el('li', 'hub-profile-education-entry');
      const kind = el('span', 'hub-profile-education-type', educationTypes.get(entry.type) || entry.type);
      const title = el('strong', '', entry.title);
      const edit = button('', 'pencil');
      edit.classList.add('hub-profile-icon-button');
      edit.setAttribute('aria-label', `Editar formação: ${entry.title}`);
      edit.addEventListener('click', () => openEducation(entry));
      const heading = el('div', 'hub-profile-education-entry-heading');
      const names = el('div');
      names.append(kind, title);
      heading.append(names, edit);
      item.append(heading);
      const period = [educationDate(entry.startMonth), entry.ongoing ? 'Em andamento' : educationDate(entry.endMonth)].filter(Boolean).join(' – ');
      if (entry.institution || period) item.append(el('p', 'hub-profile-note', [entry.institution, period].filter(Boolean).join(' · ')));
      if (entry.description) item.append(el('p', 'hub-profile-education-description', entry.description));
      const url = webUrl(entry.credentialUrl || '');
      if (url) {
        const link = el('a', 'hub-profile-credential', 'Abrir comprovante');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        link.append(icon('arrow-up-right'));
        item.append(link);
      }
      return item;
    }));
    ui.addEducation.disabled = saving || entries.length >= maxEducation;
  }

  function renderPhotoPreview() {
    ui.photoPreview.replaceChildren(avatar(current, { large: true, source: photoDraft === null ? '' : photoDraft }));
    ui.removePhoto.hidden = photoDraft === null || (!photoDraft && !current.hasAvatar);
  }

  function syncPhoto() {
    ui.choosePhoto.disabled = ui.removePhoto.disabled = saving;
    ui.savePhoto.disabled = saving || reading || photoDraft === undefined;
  }

  function openPhoto() {
    photoDraft = undefined;
    reading = false;
    ui.photoFile.value = '';
    message(ui.photoStatus);
    renderPhotoPreview();
    syncPhoto();
    ui.photoDialog.showModal();
    ui.choosePhoto.focus();
  }

  function syncEducation() {
    const custom = ui.educationType.value === 'other';
    ui.customTypeField.hidden = !custom;
    ui.customType.disabled = saving || !custom;
    ui.customType.required = custom;
    ui.educationEnd.disabled = saving || ui.educationOngoing.checked;
  }

  function openEducation(entry) {
    editingEducation = entry;
    confirmingRemoval = false;
    message(ui.educationDialogStatus);
    ui.educationHeading.textContent = entry ? 'Editar formação' : 'Adicionar formação';
    ui.removeEducation.hidden = !entry;
    ui.removeEducation.textContent = 'Remover formação';
    ui.educationType.value = !entry ? 'curso' : educationTypes.has(entry.type) ? entry.type : 'other';
    ui.customType.value = ui.educationType.value === 'other' ? entry.type : '';
    ui.educationName.value = entry?.title || '';
    ui.educationInstitution.value = entry?.institution || '';
    ui.educationStart.value = entry?.startMonth || '';
    ui.educationEnd.value = entry?.endMonth || '';
    ui.educationOngoing.checked = Boolean(entry?.ongoing);
    ui.educationUrl.value = entry?.credentialUrl || '';
    ui.educationDescription.value = entry?.description || '';
    syncEducation();
    ui.educationDialog.showModal();
    ui.educationName.focus();
  }

  function saveEducation(entries, result) {
    return save({ education: entries }, ui.educationDialogStatus, () => {
      ui.educationDialog.close();
      renderEducation();
      message(ui.educationStatus, result);
      ui.educationStatus.tabIndex = -1;
      return ui.educationStatus;
    });
  }

  ui.addSkill.addEventListener('click', () => {
    if (addSkill()) ui.skillText.focus();
  });
  ui.skillText.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    addSkill();
  });
  ui.addLink.addEventListener('click', () => addCustomLink().focus());
  ui.detailsForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!addSkill()) return;
    const personalLinks = collectLinks();
    if (!personalLinks) return;
    void save({ bio: ui.bio.value.trim(), skills, personalLinks }, ui.detailsStatus, () => {
      renderInformation();
      message(ui.detailsStatus, 'Informações salvas.');
      return ui.saveDetails;
    });
  });

  ui.avatar.addEventListener('click', openPhoto);
  ui.choosePhoto.addEventListener('click', () => ui.photoFile.click());
  ui.removePhoto.addEventListener('click', () => {
    photoVersion += 1;
    reading = false;
    photoDraft = null;
    ui.photoFile.value = '';
    renderPhotoPreview();
    syncPhoto();
    message(ui.photoStatus);
    ui.choosePhoto.focus();
  });
  ui.photoFile.addEventListener('change', async () => {
    const version = ++photoVersion;
    reading = true;
    syncPhoto();
    try {
      const image = await readImage(ui.photoFile.files[0], 450 * 1024);
      if (!ctx.active() || version !== photoVersion || !ui.photoDialog.open || !image) return;
      photoDraft = image;
      renderPhotoPreview();
      message(ui.photoStatus);
    } catch (error) {
      if (ctx.active() && version === photoVersion) message(ui.photoStatus, error.message, true);
    } finally {
      if (ctx.active() && version === photoVersion) {
        reading = false;
        ui.photoFile.value = '';
        syncPhoto();
      }
    }
  });
  ui.photoForm.addEventListener('submit', event => {
    event.preventDefault();
    if (photoDraft === undefined || reading) return;
    void save({ photo: photoDraft }, ui.photoStatus, () => {
      renderIdentity();
      ui.photoDialog.close();
      ctx.onProfileChange?.(current);
      return ui.avatar;
    });
  });
  ui.photoDialog.addEventListener('close', () => { photoVersion += 1; });

  ui.addEducation.addEventListener('click', () => openEducation());
  ui.educationType.addEventListener('change', syncEducation);
  ui.educationOngoing.addEventListener('change', syncEducation);
  ui.removeEducation.addEventListener('click', () => {
    if (!confirmingRemoval) {
      confirmingRemoval = true;
      ui.removeEducation.textContent = 'Confirmar remoção';
      message(ui.educationDialogStatus, 'Clique novamente para remover esta formação.');
      return;
    }
    void saveEducation(current.education.filter(row => row.id !== editingEducation.id), 'Formação removida.');
  });
  ui.educationForm.addEventListener('submit', event => {
    event.preventDefault();
    const title = ui.educationName.value.trim();
    const type = ui.educationType.value === 'other' ? ui.customType.value.trim() : ui.educationType.value;
    const startMonth = ui.educationStart.value;
    const endMonth = ui.educationOngoing.checked ? '' : ui.educationEnd.value;
    const url = ui.educationUrl.value.trim();
    const credentialUrl = webUrl(url);
    if (!title || !type) {
      message(ui.educationDialogStatus, 'Informe o nome e o tipo da formação.', true);
      (title ? ui.customType : ui.educationName).focus();
      return;
    }
    if (startMonth && endMonth && endMonth < startMonth) {
      message(ui.educationDialogStatus, 'A conclusão deve ser posterior ou igual ao início.', true);
      ui.educationEnd.focus();
      return;
    }
    if (url && !credentialUrl) {
      message(ui.educationDialogStatus, 'Digite um link que comece com https:// ou http://.', true);
      ui.educationUrl.focus();
      return;
    }
    const education = {
      id: editingEducation?.id, type, title, institution: ui.educationInstitution.value.trim(), startMonth, endMonth,
      ongoing: ui.educationOngoing.checked, credentialUrl, description: ui.educationDescription.value.trim(),
    };
    const entries = current.education || [];
    void saveEducation(editingEducation ? entries.map(row => row.id === education.id ? education : row) : [...entries, education], 'Formação salva.');
  });

  for (const [dialog, close, cancel] of [[ui.photoDialog, ui.closePhoto, ui.cancelPhoto], [ui.educationDialog, ui.closeEducation, ui.cancelEducation]]) {
    close.addEventListener('click', () => dialog.close());
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  }

  async function load() {
    ui.loadText.textContent = 'Carregando perfil…';
    ui.retry.hidden = true;
    ui.loadStatus.classList.remove('hub-info-error');
    try {
      const id = new URLSearchParams(location.search).get('usuario');
      if (id && id !== (ctx.session.user.id || ctx.session.user._id)) {
        current = await ctx.request('/maxhub/directory/'+encodeURIComponent(id));
        if (!ctx.active()) return;
        ui.avatar.replaceWith(avatar(current,{large:true}));
        root.querySelector('#maxHubProfileTitle').textContent = 'Perfil da equipe';
        appendPersonName(ui.name,current.name,current.tenureYears);
        ui.sector.textContent = current.sector || '';
        ui.sector.hidden = !current.sector;
        ui.loadStatus.hidden = true;
        ui.content.hidden = false;
        ui.content.replaceChildren();
        for (const [title,values] of [
          ['Biografia',[current.bio]],['Habilidades',current.skills],
          ['Educação',current.education.map(e=>[e.title,e.institution,e.startMonth,e.ongoing?'Em andamento':e.endMonth,e.description].filter(Boolean).join(' · '))],
          ['Redes sociais',current.personalLinks.map(link=>{const a=el('a','',link.label || link.platform);a.href=link.url;return a;})]
        ]) {
          const section=el('section','hub-card profile-section'); section.append(el('h3','',title));
          const items=values.filter(Boolean);
          for(const value of items.length ? items : ['Ainda não informado.']) {const line=el('p');line.append(value);section.append(line);}
          ui.content.append(section);
        }
        return;
      }
      current = await ctx.request('/maxhub/profile');
      if (!ctx.active()) return;
      renderIdentity();
      renderInformation();
      renderEducation();
      renderBadges();
      ui.loadStatus.hidden = true;
      ui.content.hidden = false;
    } catch (error) {
      if (!ctx.handle(error)) return;
      ui.loadText.textContent = 'Não foi possível abrir o perfil.';
      ui.loadStatus.classList.add('hub-info-error');
      ui.retry.hidden = false;
    }
  }
  ui.share.onclick = () => {
    const panel=el('dialog','hub-profile-dialog');
    panel.setAttribute('aria-label','Compartilhar link-bio');
    panel.innerHTML=`<form class="hub-profile-dialog-form"><header class="hub-profile-dialog-header"><h3>Compartilhar link-bio</h3></header>
      <div class="hub-profile-dialog-body"><p>Sua foto, seu nome e as redes salvas no perfil ficarão disponíveis para quem tiver o link.</p>
      <label class="hub-field">E-mail público (opcional)<input class="hub-input" name="email" type="email" maxlength="254"></label>
      <label class="hub-field">Telefone público (opcional)<input class="hub-input" name="phone" type="tel" maxlength="32"></label>
      <output aria-live="polite"></output></div><footer class="hub-profile-dialog-footer"><button type="button" class="hub-btn">Fechar</button>
      <button class="hub-btn hub-btn-primary">Gerar e copiar link</button></footer></form>`;
    const form=panel.querySelector('form');
    const out=form.querySelector('output');
    form.querySelector('[type=button]').onclick=()=>panel.close();
    panel.onclose=()=>panel.remove();
    root.append(panel);panel.showModal();
    form.onsubmit=async event=>{
      event.preventDefault();
      const submit=form.querySelector('.hub-btn-primary');
      submit.disabled=true;
      try {
        const {path}=await ctx.request('/maxhub/share-bio',{method:'POST',body:Object.fromEntries(new FormData(form))});
        const link=el('a','',new URL(path,location.origin).href);
        link.href=path;link.target='_blank';link.rel='noopener';
        out.replaceChildren(link);
        try {await navigator.clipboard.writeText(link.href);submit.textContent='Link copiado';} catch {submit.textContent='Copiar link';}
      } catch(error){out.textContent=error.message;} finally{submit.disabled=false;}
    };
  };
  ui.retry.addEventListener('click', load);
  void load();
  return () => {
    for (const dialog of [ui.photoDialog, ui.educationDialog]) if (dialog.open) dialog.close();
  };
}
