const digits = value => value.replace(/\D/g, '');
const searchText = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const usernamePart = value => searchText(value).replace(/[^a-z0-9]/g, '').slice(0, 35);
const formatCep = value => digits(value).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
const localDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

export function latestAdmissionDate() {
  return localDate.format(new Date());
}

export function showRoleGrantOptions(container, administrator) {
  for (const row of container.querySelectorAll('.grant-module')) {
    row.hidden = administrator && row.dataset.module !== 'diretoria';
  }
}

function formatCpf(value) {
  return digits(value).slice(0, 11).replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3}\.\d{3})(\d)/, '$1.$2').replace(/(\d{3}\.\d{3}\.\d{3})(\d)/, '$1-$2');
}

function cpfIsValid(value) {
  const cpf = digits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const checkDigit = length => {
    const sum = [...cpf.slice(0, length)].reduce((total, number, index) => total + Number(number) * (length + 1 - index), 0);
    return (sum * 10 % 11) % 10;
  };
  return checkDigit(9) === Number(cpf[9]) && checkDigit(10) === Number(cpf[10]);
}

function latestBirthDate(today) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function mountUserWizard({ request, renderGrants, readGrants, renderCompanies, onCreated }) {
  const id = value => document.getElementById(value);
  const dialog = id('userWizardDialog');
  const form = id('userWizardForm');
  const content = form.querySelector('.user-wizard-content');
  const panels = [...content.querySelectorAll('.user-wizard-step')];
  const indicators = [...form.querySelectorAll('.user-wizard-steps li')];
  const primary = id('userWizardContinue');
  const back = id('userWizardBack');
  const error = id('newUserError');
  const fields = Object.fromEntries(['FirstName', 'LastName', 'Cpf', 'BirthDate', 'AdmissionDate', 'Email', 'Phone', 'HasChildren', 'ChildrenCount', 'Cep', 'Street', 'Neighborhood', 'AddressNumber', 'Role', 'Username', 'AccessEmail', 'Password'].map(name => [name, id(`newUser${name}`)]));
  const cepStatus = id('newUserCepStatus');
  const cepButton = id('newUserSearchCep');
  const companySearch = id('newUserCompanySearch');
  const companyOptions = id('newUserCompanyOptions');
  const accessPending = id('newUserAccessPending');
  const addressFields = [['street', fields.Street], ['neighborhood', fields.Neighborhood]];
  let step = 0, saving = false, cepRequest = 0, resolvedCep = '', editedAccessEmail = false;
  let filledAddress = new Map();

  function showError(message = '') {
    error.textContent = message;
    error.hidden = !message;
  }

  function showStep(index, focusHeading = true) {
    step = index;
    panels.forEach((panel, i) => { panel.hidden = i !== step; });
    indicators.forEach((indicator, i) => {
      if (i === step) indicator.setAttribute('aria-current', 'step');
      else indicator.removeAttribute('aria-current');
      indicator.classList.toggle('step-complete', i < step);
    });
    if (step === 3) {
      const parts = [fields.FirstName.value, fields.LastName.value].map(usernamePart);
      fields.Username.value = parts.every(Boolean) ? parts.join('.') : '';
      if (!editedAccessEmail) fields.AccessEmail.value = fields.Email.value.trim().toLowerCase();
      updateAccessState();
    } else primary.textContent = 'Continuar';
    back.hidden = step === 0;
    content.scrollTop = 0;
    showError();
    if (focusHeading) panels[step].querySelector('h3').focus({ preventScroll: true });
  }

  function updateChildren() {
    const hasChildren = fields.HasChildren.value === 'yes';
    id('newUserChildrenRow').hidden = !hasChildren;
    fields.ChildrenCount.disabled = !hasChildren;
  }

  function updateAccessState() {
    if (step !== 3) return;
    const canSignIn = fields.Password.value.length >= 12 && Boolean(fields.Username.value || fields.AccessEmail.value.trim());
    accessPending.hidden = canSignIn;
    primary.textContent = saving ? 'Salvando…' : canSignIn ? 'Criar acesso' : 'Salvar cadastro';
  }

  function updateRole() {
    const administrator = fields.Role.value === 'admin';
    id('newUserRoleNote').hidden = !administrator;
    showRoleGrantOptions(id('newUserGrantOptions'), administrator);
    id('newUserPortfolioNote').hidden = !administrator;
    id('newUserPortfolio').hidden = administrator;
  }

  function filterCompanies() {
    const query = searchText(companySearch.value.trim());
    const numericQuery = /^[\d./\s-]+$/.test(query) ? digits(query) : '';
    const choices = [...companyOptions.querySelectorAll('label')];
    let visible = 0, selected = 0;
    for (const label of choices) {
      const checkbox = label.querySelector('input');
      const match = searchText(label.textContent).includes(query) || (numericQuery && checkbox.value.includes(numericQuery));
      label.hidden = !match;
      if (match) visible++;
      if (checkbox.checked) selected++;
    }
    const empty = id('newUserNoCompanies');
    empty.hidden = visible > 0;
    empty.textContent = choices.length ? 'Nenhuma empresa corresponde à busca.' : 'Nenhuma empresa cadastrada.';
    id('newUserCompanyCount').textContent = selected === 1 ? '1 selecionada' : `${selected} selecionadas`;
  }

  async function lookupCep() {
    const cep = digits(fields.Cep.value);
    if (cep.length !== 8) {
      fields.Cep.setCustomValidity('Digite os 8 dígitos do CEP.');
      fields.Cep.reportValidity();
      return;
    }
    const current = ++cepRequest;
    const beforeLookup = new Map(addressFields.map(([, input]) => [input, input.value]));
    cepStatus.textContent = 'Consultando CEP…';
    cepButton.disabled = true;
    try {
      const address = await request(`/cep?cep=${cep}`);
      if (current !== cepRequest || !dialog.open) return;
      resolvedCep = cep;
      for (const [key, input] of addressFields) {
        if (address[key] && input.value === beforeLookup.get(input) && (!input.value || input.value === filledAddress.get(input))) {
          input.value = address[key];
          filledAddress.set(input, input.value);
        }
      }
      cepStatus.textContent = address.street && address.neighborhood ? 'CEP localizado.' : 'CEP localizado. Complete o endereço manualmente.';
    } catch (failure) {
      if (current !== cepRequest || !dialog.open) return;
      cepStatus.textContent = failure.status === 404 ? 'CEP não localizado. Preencha o endereço manualmente.' : 'Consulta indisponível. Preencha o endereço manualmente.';
    } finally {
      if (current === cepRequest) cepButton.disabled = false;
    }
  }

  function checkStep() {
    if (step === 0) {
      fields.Cpf.setCustomValidity(!fields.Cpf.value || cpfIsValid(fields.Cpf.value) ? '' : 'Informe um CPF válido.');
      const phone = fields.Phone.value.trim().replace(/[().\s-]/g, '');
      fields.Phone.setCustomValidity(!fields.Phone.value.trim() || /^(?:\+?55)?[1-9]\d{9,10}$/.test(phone) ? '' : 'Informe um telefone com DDD.');
      fields.Cep.setCustomValidity(!fields.Cep.value || digits(fields.Cep.value).length === 8 ? '' : 'Digite os 8 dígitos do CEP.');
      fields.Street.setCustomValidity(fields.Street.value.trim().length === 1 ? 'Informe um logradouro com pelo menos 2 caracteres.' : '');
    }
    if (step === 3) fields.Password.setCustomValidity(fields.Password.value && fields.Password.value.length < 12 ? 'Digite pelo menos 12 caracteres.' : '');
    for (const input of panels[step].querySelectorAll('input, select')) {
      if (input.willValidate && !input.reportValidity()) return false;
    }
    return true;
  }

  function buildProfile() {
    const includeProvided = entries => Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== '' && value !== undefined));
    const children = fields.HasChildren.value;
    const address = includeProvided({ cep: digits(fields.Cep.value), street: fields.Street.value.trim(), neighborhood: fields.Neighborhood.value.trim(), number: fields.AddressNumber.value.trim() });
    return includeProvided({
      firstName: fields.FirstName.value.trim(), lastName: fields.LastName.value.trim(), cpf: digits(fields.Cpf.value),
      birthDate: fields.BirthDate.value, admissionDate: fields.AdmissionDate.value, email: fields.Email.value.trim(), phone: digits(fields.Phone.value),
      hasChildren: children ? children === 'yes' : undefined,
      childrenCount: children === 'yes' && fields.ChildrenCount.value ? Number(fields.ChildrenCount.value) : undefined,
      address: Object.keys(address).length ? address : undefined,
    });
  }

  function toggleSaving(busy) {
    saving = busy;
    for (const button of [primary, back, ...form.querySelectorAll('[data-wizard-dismiss]')]) button.disabled = busy;
    updateAccessState();
  }

  async function submit(event) {
    event.preventDefault();
    if (saving || !checkStep()) return;
    if (step < 3) return showStep(step + 1);
    const profile = buildProfile();
    const role = fields.Role.value;
    const selections = readGrants(id('newUserGrantOptions'));
    const moduleGrants = role === 'admin'
      ? (selections.diretoria ? { diretoria: selections.diretoria } : {})
      : selections;
    const companyCnpjs = role === 'admin' ? [] : [...companyOptions.querySelectorAll('input:checked')].map(input => input.value);
    showError();
    toggleSaving(true);
    let created;
    const email = fields.AccessEmail.value.trim().toLowerCase();
    const password = fields.Password.value;
    const body = { ...(email ? { email } : {}), ...(password ? { password } : {}), role, companyCnpjs, moduleGrants, profile };
    try { created = await request('/users', { method: 'POST', body }); }
    catch (failure) { showError(failure.message); }
    finally { toggleSaving(false); }
    if (created) {
      dialog.close();
      onCreated(created.user);
    }
  }

  fields.HasChildren.addEventListener('change', updateChildren);
  fields.Role.addEventListener('change', updateRole);
  fields.AccessEmail.addEventListener('input', () => { editedAccessEmail = true; updateAccessState(); });
  fields.Password.addEventListener('input', updateAccessState);
  fields.Cpf.addEventListener('input', () => { fields.Cpf.value = formatCpf(fields.Cpf.value); });
  fields.Cep.addEventListener('input', () => {
    fields.Cep.value = formatCep(fields.Cep.value);
    if (resolvedCep && digits(fields.Cep.value) === resolvedCep) return;
    cepRequest++;
    cepStatus.textContent = '';
    cepButton.disabled = false;
    for (const [, input] of addressFields) if (input.value === filledAddress.get(input)) input.value = '';
    filledAddress = new Map();
    resolvedCep = '';
    if (digits(fields.Cep.value).length === 8) void lookupCep();
  });
  cepButton.addEventListener('click', () => void lookupCep());
  companySearch.addEventListener('input', filterCompanies);
  companyOptions.addEventListener('change', filterCompanies);
  for (const input of Object.values(fields)) input.addEventListener('input', () => input.setCustomValidity(''));
  back.addEventListener('click', () => showStep(step - 1));
  form.addEventListener('submit', submit);
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    cepRequest++;
    resolvedCep = '';
    editedAccessEmail = false;
    filledAddress.clear();
    form.reset();
    companyOptions.replaceChildren();
    for (const input of Object.values(fields)) input.setCustomValidity('');
    cepStatus.textContent = '';
    cepButton.disabled = false;
  });

  return function open() {
    const today = latestAdmissionDate();
    fields.BirthDate.min = '1900-01-01';
    fields.BirthDate.max = latestBirthDate(today);
    fields.AdmissionDate.max = today;
    renderGrants(id('newUserGrantOptions'));
    renderCompanies(companyOptions);
    updateChildren();
    updateRole();
    filterCompanies();
    showStep(0, false);
    dialog.showModal();
    fields.FirstName.focus();
  };
}
