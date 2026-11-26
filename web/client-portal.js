const $ = id => document.getElementById(id);
const login = $('clientLogin');
const change = $('clientChange');
const username = $('clientUsername');
const current = $('clientCurrentPassword');
const password = $('clientNewPassword');
const confirmation = $('clientConfirmPassword');
const logout = $('clientLogout');
let session;

async function request(path, body) {
  const response = await fetch(`/v1/client/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(session?.csrfToken ? { 'x-csrf-token': session.csrfToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error(data?.message || 'Não foi possível concluir a solicitação. Tente novamente.');
    error.status = response.status;
    error.code = data?.error;
    throw error;
  }
  return data;
}

function feedback(id, value) {
  const target = $(id);
  target.textContent = value;
  target.hidden = !value;
}

function show(view, { focus = true, notice = '', error = '' } = {}) {
  const isChanging = view === 'activate' || view === 'change';
  const isActive = view === 'account';
  const copy = {
    loading: ['Portal do Cliente', 'Verificando seu acesso…'],
    retry: ['Portal do Cliente', ''],
    login: ['Entrar no portal', 'Use o CPF ou CNPJ do cadastro e sua senha ou código de primeiro acesso.'],
    activate: ['Definir sua primeira senha', 'Crie uma senha pessoal para acessar o portal.'],
    change: ['Alterar senha', 'Confirme sua senha atual e escolha uma nova senha.'],
    account: ['Seu acesso está ativo', 'Você está no Portal do Cliente Maximum.'],
  };
  const [title, description] = copy[view];
  $('clientTitle').textContent = title;
  $('clientDescription').textContent = description;
  $('clientDescription').hidden = !description;
  login.hidden = view !== 'login';
  change.hidden = !isChanging;
  $('clientRetry').hidden = view !== 'retry';
  $('clientAccount').hidden = !isActive;
  $('clientActions').hidden = !(isActive || isChanging);
  $('clientEditPassword').hidden = !isActive;
  $('clientCurrentField').hidden = view !== 'change';
  current.required = view === 'change';
  $('clientName').textContent = isActive ? session.client.name : '';
  $('clientDocument').textContent = isActive ? session.client.username : '';
  feedback('clientNotice', notice);
  feedback('clientError', error);
  if (focus) $('clientTitle').focus();
}

function showSession(data, focus = true) {
  session = data.client ? data : null;
  show(session ? (session.mustChangePassword ? 'activate' : 'account') : 'login', { focus });
}

async function restoreSession() {
  show('loading', { focus: false });
  try {
    showSession(await request('session'), false);
  } catch {
    show('retry', { error: 'Não foi possível verificar seu acesso.' });
  }
}

function present(error) {
  if (error.status === 401 && error.code === 'UNAUTHORIZED') {
    session = null;
    change.reset();
    show('login', { error: error.message });
  } else {
    feedback('clientError', error.message || 'Não foi possível concluir. Tente novamente.');
  }
}

function busy(form, value) {
  form.setAttribute('aria-busy', value ? 'true' : 'false');
  form.querySelector('button[type="submit"]').disabled = value;
  logout.disabled = value;
}

login.addEventListener('submit', async event => {
  event.preventDefault();
  feedback('clientError', '');
  feedback('clientNotice', '');
  busy(login, true);
  const field = $('clientPassword');
  try {
    const data = await request('login', { username: username.value, password: field.value });
    username.value = data.client.username;
    showSession(data);
  } catch (error) {
    present(error);
  } finally {
    field.value = '';
    busy(login, false);
  }
});

change.addEventListener('submit', async event => {
  event.preventDefault();
  feedback('clientError', '');
  if (password.value !== confirmation.value) {
    feedback('clientError', 'As duas senhas precisam ser iguais.');
    confirmation.focus();
    return;
  }
  busy(change, true);
  try {
    await request('change-password', {
      newPassword: password.value,
      ...(session.mustChangePassword ? {} : { currentPassword: current.value }),
    });
    username.value = session.client.username;
    session = null;
    change.reset();
    show('login', { notice: 'Senha definida. Entre com sua nova senha.' });
  } catch (error) {
    present(error);
  } finally {
    busy(change, false);
  }
});

$('clientEditPassword').addEventListener('click', () => {
  change.reset();
  show('change');
  current.focus();
});
$('clientRetry').addEventListener('click', restoreSession);
logout.addEventListener('click', async () => {
  logout.disabled = true;
  try {
    await request('logout', {});
    session = null;
    change.reset();
    show('login');
  } catch (error) {
    present(error);
  } finally {
    logout.disabled = false;
  }
});

restoreSession();
