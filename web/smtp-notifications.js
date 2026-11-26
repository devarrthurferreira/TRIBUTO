const screens = `
  <section class="smtp-panel" aria-labelledby="smtpTitle">
    <header class="smtp-heading">
      <span class="smtp-heading-icon"><i class="bi bi-envelope" aria-hidden="true"></i></span>
      <div><h2 id="smtpTitle">Notificações e envios</h2><p>Configure a conta SMTP usada nos envios de honorários.</p></div>
    </header>
    <div data-smtp="loading" class="smtp-loading" role="status">Carregando configuração SMTP…</div>
    <p data-smtp="error" class="smtp-feedback" role="alert" hidden></p>
    <button type="button" data-smtp="retry" class="button button-quiet" hidden>Tentar novamente</button>
    <div data-smtp="content" class="smtp-content" hidden>
      <form data-smtp="form" class="surface smtp-card" autocomplete="off">
        <h3>Conta SMTP</h3>
        <div class="smtp-fields">
          <label class="field"><span>Servidor SMTP</span><input data-smtp="host" required maxlength="253" placeholder="smtp.exemplo.com" spellcheck="false" inputmode="url"></label>
          <label class="field"><span>Porta e segurança</span><select data-smtp="port" required>
            <option value="465">465 · TLS</option><option value="587">587 · STARTTLS</option>
          </select></label>
          <label class="field"><span>Usuário SMTP</span><input data-smtp="username" required maxlength="254" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span>Senha SMTP</span><input type="password" data-smtp="password" maxlength="512" autocomplete="new-password">
            <small data-smtp="passwordHelp"></small>
          </label>
          <label class="field"><span>E-mail remetente</span><input data-smtp="senderEmail" type="email" required maxlength="254" placeholder="envios@exemplo.com"></label>
          <label class="field"><span>Nome do remetente</span><input data-smtp="senderName" maxlength="120" placeholder="Maximum Contábil"></label>
        </div>
        <label class="smtp-toggle"><input data-smtp="enabled" type="checkbox"><span>Ativar os envios de honorários</span></label>
        <p data-smtp="unavailable" class="smtp-feedback" hidden>O cofre de credenciais precisa estar disponível no servidor para salvar a conta SMTP.</p>
        <div class="smtp-actions">
          <button data-smtp="save" class="button button-primary" type="submit">Salvar configuração</button>
          <button data-smtp="verify" class="button button-quiet" type="button">Testar conexão</button>
        </div>
        <p data-smtp="feedback" class="smtp-feedback" role="status" hidden></p>
      </form>
      <div class="smtp-side">
        <section class="surface smtp-card" aria-labelledby="smtpRecipientsTitle">
          <h3 id="smtpRecipientsTitle">Destinatários dos honorários</h3>
          <ul class="smtp-recipients" data-smtp="recipients"></ul>
        </section>
        <section class="surface smtp-card" aria-labelledby="smtpQueueTitle">
          <div class="smtp-queue-head"><h3 id="smtpQueueTitle">Fila de envios</h3>
            <button data-smtp="refresh" class="button button-quiet" type="button">Atualizar</button>
          </div>
          <dl data-smtp="queue" class="smtp-queue"></dl>
        </section>
      </div>
    </div>
  </section>`;
const labels = {
  queued: 'Na fila', sending: 'Em envio', sent: 'Aceitos pelo SMTP', failed: 'Com falha', uncertain: 'A confirmar',
};
const number = new Intl.NumberFormat('pt-BR');

function make(tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

export function mountSmtpNotifications(root, { request, onAuthError }) {
  root.innerHTML = screens;
  const ui = Object.fromEntries([...root.querySelectorAll('[data-smtp]')].map(item => [item.dataset.smtp, item]));
  const inputs = ['host', 'port', 'username', 'password', 'senderEmail', 'senderName', 'enabled'];
  let open = false;
  let version = 0;
  let settings;
  let busy = false;
  let edited = false;

  function feedback(text = '', isError = false, target = ui.feedback) {
    target.textContent = text;
    target.dataset.error = String(isError);
    target.hidden = !text;
  }

  function draw(response, updateForm = true) {
    if (updateForm) {
      settings = response.settings;
      edited = false;
      ui.host.value = settings.host;
      ui.port.value = settings.port;
      ui.username.value = settings.username;
      ui.password.value = '';
      ui.passwordHelp.textContent = settings.hasPassword ? 'Senha salva. Preencha apenas para trocar a credencial.' : 'Use a credencial fornecida pelo seu provedor SMTP.';
      ui.senderEmail.value = settings.senderEmail;
      ui.senderName.value = settings.senderName;
      ui.enabled.checked = settings.enabled;
      ui.unavailable.hidden = settings.available;
      ui.recipients.replaceChildren(...response.recipients.map(({ name, email }) => {
        const item = document.createElement('li');
        item.append(make('strong', name), make('span', email));
        return item;
      }));
    }
    ui.queue.replaceChildren(...Object.entries(labels).map(([status, label]) => {
      const item = document.createElement('div');
      item.append(make('dt', label), make('dd', number.format(response.queue[status] || 0)));
      return item;
    }));
    ui.content.hidden = false;
  }

  function updateControls() {
    const editable = !!settings?.available && !busy;
    for (const field of inputs) ui[field].disabled = !editable;
    ui.save.disabled = !editable;
    ui.verify.disabled = !editable || edited || !settings.hasPassword;
    ui.refresh.disabled = busy;
  }

  function report(error, target = ui.feedback) {
    if (error.status === 401) { onAuthError?.(error); return; }
    feedback(error.message || 'Não foi possível concluir a operação.', true, target);
  }

  async function load(updateForm = true) {
    const current = version;
    busy = true;
    updateControls();
    if (updateForm) {
      ui.retry.hidden = true;
      ui.loading.hidden = false;
      feedback('', false, ui.error);
      feedback();
    }
    try {
      const response = await request('/notifications/smtp');
      if (open && current === version) draw(response, updateForm);
    } catch (error) {
      if (open && current === version) {
        report(error, updateForm ? ui.error : ui.feedback);
        if (updateForm && error.status !== 401) ui.retry.hidden = false;
      }
    } finally {
      if (open && current === version) {
        busy = false;
        ui.loading.hidden = true;
        updateControls();
      }
    }
  }

  ui.retry.addEventListener('click', () => { if (!busy) void load(); });
  ui.refresh.addEventListener('click', () => { if (!busy) void load(false); });
  ui.form.addEventListener('input', () => {
    edited = true;
    feedback();
    updateControls();
  });

  ui.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !settings?.available) return;
    const current = version;
    busy = true;
    updateControls();
    feedback('Salvando configuração…');
    const body = {
      enabled: ui.enabled.checked, host: ui.host.value.trim(), port: Number(ui.port.value),
      username: ui.username.value.trim(), senderEmail: ui.senderEmail.value.trim(), senderName: ui.senderName.value.trim(),
      ...(ui.password.value ? { password: ui.password.value } : {}),
    };
    try {
      const response = await request('/notifications/smtp', { method: 'PUT', body });
      if (open && current === version) { draw(response); feedback('Configuração SMTP salva.'); }
    } catch (error) {
      if (open && current === version) report(error);
    } finally {
      if (open && current === version) { busy = false; updateControls(); }
    }
  });

  ui.verify.addEventListener('click', async () => {
    if (busy || edited || !settings?.hasPassword) return;
    const current = version;
    busy = true;
    updateControls();
    feedback('Testando a conexão…');
    try {
      await request('/notifications/smtp/verify', { method: 'POST', body: {} });
      if (open && current === version) feedback('Conexão e autenticação SMTP confirmadas.');
    } catch (error) {
      if (open && current === version) report(error);
    } finally {
      if (open && current === version) { busy = false; updateControls(); }
    }
  });

  return {
    open() {
      if (open) return;
      open = true;
      void load();
    },
    close() {
      if (!open) return;
      open = false;
      version++;
      busy = edited = false;
      settings = undefined;
      ui.form.reset();
      ui.content.hidden = true;
      ui.recipients.replaceChildren();
      ui.queue.replaceChildren();
      feedback();
      feedback('', false, ui.error);
    },
  };
}
