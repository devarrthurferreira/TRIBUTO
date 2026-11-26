import { button, el, mountDossierForm } from './dossier-form.js';

const status = document.getElementById('dossierPublicStatus');
const mount = document.getElementById('dossierPublicForm');
const retry = document.getElementById('dossierPublicRetry');
let finish;
let opening = 0;

async function request(method, token, body) {
  const headers = { Accept: 'application/json', Authorization: 'Bearer ' + token };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch('/v1/dossier-link', {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = new Error(data.message || 'Não foi possível acessar o formulário.');
    failure.status = response.status;
    throw failure;
  }
  return data;
}

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('dossier-error', error);
  status.hidden = !message;
}

function unavailable(message) {
  finish?.();
  finish = null;
  mount.hidden = true;
  retry.hidden = true;
  setStatus(message || 'Este link não está disponível. Solicite um novo à equipe de Sucesso do Cliente.', true);
}

async function start({ focusForm = false } = {}) {
  const version = ++opening;
  const token = location.hash.slice(1);
  finish?.();
  finish = null;
  mount.hidden = true;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { unavailable(); return; }
  setStatus('Validando o link…');
  retry.hidden = true;
  let link;
  try {
    link = await request('GET', token);
  } catch (failure) {
    if (opening !== version) return;
    if ([400, 401, 403, 404, 409, 410].includes(failure.status)) unavailable(failure.message);
    else {
      setStatus('Não foi possível validar o link. Confira sua conexão e tente novamente.', true);
      retry.hidden = false;
    }
    return;
  }
  if (opening !== version) return;
  const reusable = link.mode === 'reusable';
  const submissionId = reusable ? crypto.randomUUID() : undefined;
  setStatus('');
  mount.hidden = false;
  finish = mountDossierForm(mount, {
    submitLabel: 'Enviar dossiê à Maximum',
    async submit(dossier) {
      try { return await request('POST', token, reusable ? { dossier, submissionId } : { dossier }); }
      catch (failure) {
        if (opening === version && [401, 403, 404, 410].includes(failure.status)) {
          unavailable(failure.message);
        }
        throw failure;
      }
    },
    onSuccess(result) {
      if (opening !== version) return;
      finish?.();
      finish = null;
      mount.hidden = true;
      const title = el('h2', '', 'Dossiê recebido');
      title.tabIndex = -1;
      const confirmation = el('div', 'dossier-received');
      confirmation.append(title, el('p', '', 'As informações foram salvas no módulo de Sucesso do Cliente.'));
      if (result.protocolo) {
        const protocol = el('p', 'dossier-protocol', result.protocolo);
        protocol.prepend(el('strong', '', 'Protocolo '));
        confirmation.append(protocol);
      }
      if (reusable) {
        const next = button('Preencher outro dossiê', true);
        next.addEventListener('click', () => { void start({ focusForm: true }); });
        confirmation.append(next);
      }
      status.replaceChildren(confirmation);
      status.classList.remove('dossier-error');
      status.hidden = false;
      if (!reusable) history.replaceState(null, '', location.pathname);
      title.focus();
    },
  });
  if (focusForm) mount.querySelector('.dossier-step-heading h2')?.focus();
}

document.querySelector('.skip-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  document.getElementById('dossierMain').focus();
});
retry.addEventListener('click', () => void start());
window.addEventListener('hashchange', () => void start());
void start();
