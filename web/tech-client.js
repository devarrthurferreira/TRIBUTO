import { CLIENT_MODULES } from './client-modules.js';

const workModules = {guias:'Guias', financeiro:'Financeiro', documentos:'Documentação'};
const money = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
const statuses = {aberto:'Em aberto', pago:'Pago', cancelado:'Cancelado', disponivel:'Disponível', recebido:'Recebido', 'em-analise':'Em análise', conferido:'Conferido'};
const accessStates = {active:'Acesso ativo', activation_pending:'Aguardando ativação', activation_in_progress:'Ativação em andamento', activation_expired:'Ativação expirada', revoked:'Revogado', unconfigured:'Sem acesso'};

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
function action(label, onClick, primary = false) {
  const button = el('button', 'button ' + (primary ? 'button-primary' : 'button-quiet'), label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}
function field(label, name, type, options = {}) {
  const wrapper = el('label', 'tech-field');
  const control = el(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') control.type = type;
  Object.assign(control, {name}, options);
  wrapper.append(el('span','',label), control);
  return wrapper;
}
function statusMessage(message) {
  const node = el('p','tech-app-note',message);
  node.setAttribute('role','status');
  return node;
}
function searchText(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.onload = () => resolve({name:file.name, base64:reader.result.split(',')[1]});
    reader.readAsDataURL(file);
  });
}
function localDate(value) {
  if (!value) return '';
  return value.slice(0,10).split('-').reverse().join('/');
}

export function mountTechClientApp(root, {request, openAccess}) {
  const shell = el('section','tech-app');
  const heading = el('header','tech-app-head');
  heading.append(el('h1','','APP Cliente'));
  const portal = el('a','button button-quiet','Abrir portal do cliente');
  portal.href = '/cliente'; portal.target = '_blank'; portal.rel = 'noopener';
  heading.append(portal);
  const grid = el('div','tech-app-grid');
  const directory = el('aside','tech-app-directory');
  const search = field('Buscar empresa','search','search',{placeholder:'Nome, código ou documento'});
  const counter = el('small','tech-app-note');
  const companies = el('div','tech-app-companies');
  directory.append(search,counter,companies);
  const content = el('section','tech-app-detail');
  content.setAttribute('aria-label','Empresa selecionada');
  const intro = statusMessage('Selecione uma empresa para gerenciar seu portal.');
  grid.append(directory,content);
  shell.append(heading,grid);
  root.replaceChildren(shell);
  content.append(intro);
  let disposed = false;
  let records = [];
  let selectedId;
  let detail;
  let activeTab = 'access';
  let serial = 0;
  const active = ticket => !disposed && serial === ticket;
  const path = () => '/clients/app/' + encodeURIComponent(selectedId);

  function renderDirectory() {
    const query = searchText(search.lastChild.value.trim());
    const digits = query.replace(/\D/g,'');
    const filtered = records.filter(client => [client.name,client.nickname,client.tradeName,client.document,client.code].some(value => searchText(value).includes(query))
      || (digits.length > 0 && /^[\d.\s/-]+$/.test(query) && client.document.replace(/\D/g,'').includes(digits)));
    counter.textContent = filtered.length === 1 ? '1 empresa' : filtered.length + ' empresas';
    companies.replaceChildren();
    if (!filtered.length) companies.append(statusMessage('Nenhuma empresa encontrada.'));
    for (const client of filtered) {
      const row = el('button','tech-company');
      row.type = 'button';
      row.setAttribute('aria-pressed',String(selectedId === client.id));
      row.append(el('strong','',client.name),el('small','','Cód. ' + (client.code || '999') + ' · ' + client.document + (client.active ? '' : ' · Inativa')));
      row.onclick = () => selectCompany(client.id);
      companies.append(row);
    }
  }

  async function loadDirectory() {
    companies.replaceChildren(statusMessage('Buscando empresas…'));
    try {
      const {clients} = await request('/clients/app');
      if (disposed) return;
      records = clients;
      renderDirectory();
    } catch (err) {
      if (!disposed) companies.replaceChildren(statusMessage(err.message),action('Tentar novamente',loadDirectory));
    }
  }

  async function selectCompany(id) {
    const ticket = ++serial;
    selectedId = id;
    detail = undefined;
    activeTab = 'access';
    renderDirectory();
    content.replaceChildren(statusMessage('Carregando empresa…'));
    try {
      const {client} = await request(path());
      if (!active(ticket)) return;
      detail = client;
      drawTab();
    } catch (err) {
      if (active(ticket)) content.replaceChildren(statusMessage(err.message),action('Tentar novamente',()=>selectCompany(id)));
    }
  }

  function drawTab(page = 1) {
    const ticket = ++serial;
    const title = el('header','tech-app-identity');
    title.append(el('small','tech-app-note',detail.active ? 'Empresa ativa' : 'Empresa inativa'),el('h2','',detail.name),el('p','',detail.document));
    const tabs = el('div','tech-app-tabs');
    tabs.setAttribute('role','group'); tabs.setAttribute('aria-label','Seções da empresa');
    for (const [key,label] of Object.entries({access:'Acesso e módulos',...workModules})) {
      const button = action(label,()=>{activeTab=key;drawTab();});
      button.setAttribute('aria-pressed',String(key===activeTab)); tabs.append(button);
    }
    const panel = el('div','tech-tab-content');
    content.replaceChildren(title,tabs,panel);
    if (activeTab === 'access') drawAccess(panel,ticket);
    else void drawWork(panel,ticket,page);
  }

  function drawAccess(panel,ticket) {
    const access = el('div','tech-access-status');
    const state = statusMessage('Consultando acesso…');
    access.append(state, action('Gerenciar acesso', async () => {
      const opening = openAccess(detail);
      const dialog = document.getElementById('clientWizardDialog');
      if (dialog?.open) dialog.addEventListener('close', () => { if (active(ticket)) loadAccess(); }, {once:true});
      await opening;
    }));
    function loadAccess() {
      request('/clients/'+encodeURIComponent(detail.id)+'/access')
        .then(({access})=>{if (active(ticket)) state.textContent=accessStates[access.status] || 'Sem acesso';})
        .catch(err=>{if (active(ticket)) state.textContent=err.message;});
    }
    loadAccess();
    const form = el('form','tech-modules');
    const heading = el('h3','','Módulos do cliente');
    const options = el('div','tech-module-options');
    const checks = CLIENT_MODULES.map(module=>{
      const label = el('label','tech-module-option');
      const check = el('input');check.type='checkbox';check.value=module.id;check.checked=detail.modules.includes(module.id);
      const copy = el('span');copy.append(el('strong','',module.label),el('small','',module.description));
      label.append(check,copy);options.append(label);return check;
    });
    const feedback = statusMessage('');
    const save = el('button','button button-primary','Salvar módulos');save.type='submit';
    const actions = el('div','tech-app-actions');
    actions.append(action('Selecionar todos',()=>{for (const box of checks) box.checked=true;}),save);
    form.append(heading,options,actions,feedback);
    form.onsubmit = async event => {
      event.preventDefault(); if (save.disabled) return;
      const modules = checks.filter(box=>box.checked).map(box=>box.value);
      save.disabled = true;
      try {
        await request(path()+'/modules',{method:'PUT',body:{modules}});
        if (active(ticket)) {detail.modules=modules;feedback.textContent='Módulos salvos.';}
      } catch (err) { if (active(ticket)) feedback.textContent=err.message; }
      finally {save.disabled=false;}
    };
    panel.append(access,form);
  }

  function publication(panel,ticket,module,collectionPath) {
    const toggle = el('details','tech-publish');
    toggle.append(el('summary','',module === 'documentos' ? 'Enviar documento ao cliente' : module === 'guias' ? 'Publicar guia' : 'Adicionar lançamento'));
    const form = el('form','tech-publish-form');
    form.append(field('Título','title','text',{required:true,maxLength:160}), field('Competência','competence','month'));
    if (module !== 'documentos') form.append(field('Vencimento','dueDate','date'),field('Valor (R$)','amount','number',{min:'0',step:'.01'}));
    form.append(field('Descrição','description','textarea',{maxLength:2000}),
      field('Arquivo (até 2 MB)','attachment','file',{required:module==='documentos', accept:'.pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.xlsx,.docx,.pptx'}));
    const feedback = statusMessage('');
    const submit = el('button','button button-primary','Publicar');submit.type='submit';
    form.append(submit,feedback);
    form.onsubmit = async event => {
      event.preventDefault(); if(submit.disabled) return;
      submit.disabled = true;
      try {
        const fields = new FormData(form);
        const body = {title:fields.get('title').trim(), description:fields.get('description').trim()};
        for (const key of ['competence','dueDate']) if (fields.get(key)) body[key]=fields.get(key);
        if (fields.get('amount')) body.amountCents = Math.round(Number(fields.get('amount')) * 100);
        const file = form.elements.attachment.files[0];
        if (file) {
          if (file.size > 2*1024*1024 || file.size === 0) throw new Error('Selecione um arquivo entre 1 byte e 2 MB.');
          body.file = await readFile(file);
        }
        if (!active(ticket)) return;
        await request(collectionPath,{method:'POST',body});
        if (active(ticket)) drawTab();
      } catch (err) {if (active(ticket)) feedback.textContent=err.message;}
      finally {submit.disabled=false;}
    };
    toggle.append(form);panel.append(toggle);
  }

  async function drawWork(panel,ticket,page) {
    const module = activeTab;
    const collectionPath = path()+'/'+module;
    if (detail.active && detail.modules.includes(module)) publication(panel,ticket,module,collectionPath);
    else panel.append(statusMessage(detail.active ? 'Libere este módulo em Acesso e módulos para publicar.' : 'Cadastro inativo.'));
    const list = el('div','tech-work-list');
    const loading = statusMessage('Carregando registros…');
    list.append(loading); panel.append(list);
    try {
      const {items,hasMore} = await request(collectionPath+'?page='+page);
      if (!active(ticket)) return;
      list.replaceChildren();
      if (!items.length) list.append(statusMessage('Nenhum registro nesta seção.'));
      for (const item of items) {
        const article = el('article','tech-work-item');
        article.append(el('strong','',item.title));
        const meta = [item.competence && 'Competência '+item.competence, item.dueDate && 'Vence em '+localDate(item.dueDate),
          item.amountCents != null && money.format(item.amountCents/100),item.origin==='cliente' ? 'Enviado pelo cliente' : 'Publicado pela Maximum'];
        article.append(el('small','tech-app-note',meta.filter(Boolean).join(' · ')));
        if (item.description) article.append(el('p','',item.description));
        const itemPath = collectionPath+'/'+encodeURIComponent(item.id);
        if (item.filename) {
          const file = el('a','tech-download',item.filename);
          file.href = '/v1/platform'+itemPath+'/file'; file.download = item.filename;
          article.append(file);
        }
        const actions = el('div','tech-app-actions');
        const label = el('label','tech-field');
        const select = el('select');
        const options = module==='documentos' ? ['disponivel','recebido','em-analise','conferido'] : ['aberto','pago','cancelado'];
        for (const status of options) select.add(new Option(statuses[status],status));
        select.value=item.status;
        label.append(el('span','','Situação'),select);
        const message=statusMessage('');
        const save=action('Atualizar',async()=>{
          save.disabled=true;
          try {
            await request(itemPath,{method:'PATCH',body:{status:select.value}});
            if (active(ticket)) {item.status=select.value;message.textContent='Situação atualizada.';}
          } catch (err) {if (active(ticket)) message.textContent=err.message;}
          finally {save.disabled=false;}
        });
        actions.append(label,save);article.append(actions,message);list.append(article);
      }
      const paging = el('div','tech-app-actions');
      if(page>1) paging.append(action('Anterior',()=>drawTab(page-1)));
      if(hasMore) paging.append(action('Próxima',()=>drawTab(page+1)));
      list.append(paging);
    } catch (err) {
      if (active(ticket)) list.replaceChildren(statusMessage(err.message),action('Tentar novamente',()=>drawTab(page)));
    }
  }
  search.lastChild.oninput=renderDirectory;
  void loadDirectory();
  return () => {disposed=true;serial++;root.replaceChildren();};
}
