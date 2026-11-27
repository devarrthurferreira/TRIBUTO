const moduleId = 'sucesso-do-cliente';
const taskPath = '/work-items?module=' + moduleId;
const dossierPath = '/dossiers?sector=' + moduleId + '&limit=100';
const statuses = {open:'A fazer', in_progress:'Em andamento', done:'Concluídas'};
function el(tag, label, className) {
  const element = document.createElement(tag);
  if (label != null) element.textContent = label;
  if (className) element.className = className;
  return element;
}
function action(label, callback, primary = false) {
  const button = el('button', label, 'button ' + (primary ? 'button-primary' : 'button-quiet'));
  button.type = 'button';
  button.addEventListener('click', callback);
  return button;
}
async function pages(request, path) {
  const items = [];
  let first;
  for (let page = 1; ; page++) {
    const result = await request(path + '&page=' + page);
    first ??= result;
    items.push(...result.items);
    if (!result.hasMore) return {items, people:first.assignees || []};
  }
}
const monthFormat = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo', year:'numeric',month:'2-digit'});
function chart(card, records, months, line) {
  const dates = line ? [] : records.map(item => new Date(item.createdAt)).filter(date => Number.isFinite(+date)).map(date => monthFormat.format(date));
  const values = months.map(month => line
    ? records.reduce((sum,row) => sum + (row.month <= month ? Number(row.registrations) : 0),0)
    : dates.filter(date => date === month).length);
  const max = Math.max(1, ...values);
  const ns = 'http://www.w3.org/2000/svg';
  function shape(tag, attrs, content) {
    const node = document.createElementNS(ns,tag);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
    if (content != null) node.textContent = content;
    return node;
  }
  const width = line ? 850 : 480, height = 165;
  const svg = shape('svg',{viewBox:'0 0 '+width+' '+height,role:'img','aria-label':months.map((m,i)=>m+': '+values[i]).join(', ')});
  const x = i => 38 + i*(width-76)/5;
  const y = v => 128 - v/max*94;
  for (const level of [0,.5,1]) svg.append(shape('line',{x1:12,x2:width-12,y1:y(level*max),y2:y(level*max),class:'cs-gridline'}));
  if (line) svg.append(shape('polyline',{points:values.map((v,i)=>x(i)+','+y(v)).join(' '),fill:'none',stroke:'currentColor','stroke-width':3}));
  values.forEach((v,i)=>{
    svg.append(line ? shape('circle',{cx:x(i),cy:y(v),r:4,fill:'currentColor'}) :
      shape('rect',{x:x(i)-13,y:y(v),width:26,height:128-y(v),rx:4,fill:'currentColor'}));
    svg.append(shape('text',{x:x(i),y:y(v)-9,'text-anchor':'middle'},v),
      shape('text',{x:x(i),y:153,'text-anchor':'middle'},months[i].slice(5)+'/'+months[i].slice(2,4)));
  });
  card.append(svg);
}
export function mountSuccessOverview(root,{request,name,tasks,dossiers}) {
  const shell = el('div',null,'cs-overview');
  const grid = el('div',null,'cs-charts');
  shell.append(el('h1','Olá, '+name+'!'),grid);
  root.append(shell);
  const [year,month] = monthFormat.format(new Date()).split('-').map(Number);
  const months = Array.from({length:6},(_,i)=>new Date(Date.UTC(year,month-6+i,15)).toISOString().slice(0,7));
  function panel(title,caption,load,line=false) {
    const card = el('article',null,'cs-chart'+(line?' wide':''));
    card.append(el('h2',title),el('p',caption));
    grid.append(card);
    const status = el('p','Carregando…');
    card.append(status);
    load().then(records=>{ status.remove(); chart(card,records,months,line); }).catch(()=>{status.textContent='Não foi possível carregar este gráfico.';});
  }
  if (tasks) panel('Tarefas criadas','Novas tarefas por mês',async()=>(await pages(request,taskPath)).items);
  if (dossiers) panel('Dossiês cadastrados','Novos protocolos por mês, incluindo arquivados',async()=>{
    const sets = await Promise.all([pages(request,dossierPath),pages(request,dossierPath+'&archived=1')]);
    return [...new Map(sets.flatMap(s=>s.items).map(item=>[item.id,item])).values()];
  });
  panel('Crescimento da carteira','Empresas cadastradas na Maximum · acumulado mensal',async()=>
    (await request('/sucesso-do-cliente/crescimento')).months,true);
}

export async function mountSuccessTasks(root,{request,create,update}) {
  const shell = el('section',null,'cs-tasks');
  root.append(shell);
  const header = el('header',null,'cs-board-head');
  header.append(el('h1','Tarefas'));
  const search = el('input'); search.type='search'; search.placeholder='Buscar tarefa ou empresa'; search.setAttribute('aria-label',search.placeholder);
  const board = el('div',null,'cs-board');
  const feedback = el('p','Carregando tarefas…'); feedback.setAttribute('role','status');
  shell.append(header,search,feedback,board);
  let items,people,companies;
  try {
    const [result,portfolio] = await Promise.all([pages(request,taskPath),request('/companies')]);
    items=result.items; people=result.people; companies=portfolio.companies;
  } catch { feedback.textContent='Não foi possível carregar as tarefas e a carteira.'; return; }
  feedback.textContent='';
  const companyName = item=>companies.find(c=>c.cnpj===item.companyCnpj)?.name || item.prospectName || (item.companyCnpj || 'Interna');
  const peopleName = id=>people.find(p=>p.id===id)?.name || 'Membro indisponível';
  if (create) header.append(action('Adicionar tarefa',()=>open(null),true));
  async function move(item,status) {
    if (!update || item.status===status) return;
    try {
      const result = await request('/work-items/'+item.id,{method:'PATCH',body:{status,expectedUpdatedAt:item.updatedAt}});
      Object.assign(item,result.item); feedback.textContent='Tarefa movida.'; render();
    } catch (e) { feedback.textContent=e.message; }
  }
  function render() {
    board.replaceChildren();
    for (const [status,label] of Object.entries(statuses)) {
      const list = items.filter(t=>t.status===status && (t.title+' '+companyName(t)).toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
      const column=el('section',null,'cs-column'); column.dataset.status=status;
      const heading=el('h2',label); heading.append(el('small',list.length)); column.append(heading);
      for (const item of list) {
        const card=el('button',null,'cs-task'); card.type='button';
        card.append(el('small',companyName(item)),el('strong',item.title));
        const details=[item.dueAt?.split('-').reverse().join('/'),item.checklist?.length ? 'Checklist '+item.checklist.filter(c=>c.done).length+'/'+item.checklist.length : '', [...new Set([item.assigneeId,...(item.memberIds||[])].filter(Boolean))].map(peopleName).join(', ')].filter(Boolean);
        if (details.length) card.append(el('span',details.join(' · ')));
        card.addEventListener('click',()=>open(item));
        if (update) { card.draggable=true; card.addEventListener('dragstart',e=>e.dataTransfer.setData('text/plain',item.id)); }
        column.append(card);
      }
      if (!list.length) column.append(el('p','Nenhuma tarefa','cs-empty'));
      if (update) {
        column.addEventListener('dragover',e=>e.preventDefault());
        column.addEventListener('drop',e=>{e.preventDefault(); const task=items.find(t=>t.id===e.dataTransfer.getData('text/plain')); if(task) void move(task,status);});
      }
      board.append(column);
    }
  }
  function open(item) {
    const dialog=el('dialog',null,'cs-drawer '+(item?'right':'left'));
    const form=el('form'); const head=el('header',null,'cs-board-head');
    head.append(el('h2',item?'Detalhes da tarefa':'Adicionar tarefa'),action('Fechar',()=>dialog.close()));
    dialog.setAttribute('aria-label',item?'Detalhes da tarefa':'Adicionar tarefa');
    const fields=el('fieldset'); fields.disabled=item ? !update : !create;
    function field(label,input) {
      const wrapper=el('label',label); wrapper.append(input); fields.append(wrapper); return input;
    }
    function select(label,entries,value) {
      const s=el('select'); for(const [v,l] of entries) s.append(new Option(l,v)); s.value=value; return field(label,s);
    }
    const title=field('Título',el('input')); title.required=true; title.minLength=3; title.maxLength=200; title.value=item?.title||'';
    const description=field('Descrição',el('textarea')); description.maxLength=2000; description.rows=4; description.value=item?.description||'';
    const mode=select('A empresa já está cadastrada?',[['registered','Sim, vincular à carteira'],['prospect','Ainda não'],['internal','Tarefa interna']],item ? item.companyCnpj?'registered':item.prospectName?'prospect':'internal' : 'registered');
    const company=select('Empresa da carteira',[['','Selecione a empresa'],...companies.map(c=>[c.cnpj,c.name])],item?.companyCnpj||'');
    const prospect=field('Nome da empresa em cadastro',el('input')); prospect.maxLength=160; prospect.value=item?.prospectName||'';
    mode.disabled=company.disabled=!!item;
    function sync() {
      company.parentElement.hidden=mode.value!=='registered'; company.required=mode.value==='registered';
      prospect.parentElement.hidden=mode.value!=='prospect'; prospect.required=mode.value==='prospect';
    }
    mode.onchange=sync; sync();
    const status=select('Etapa',Object.entries(statuses),item?.status||'open');
    const due=field('Prazo',el('input')); due.type='date'; due.value=item?.dueAt||'';
    const owner=select('Responsável',[['','Sem responsável'],...people.map(p=>[p.id,p.name])],item?.assigneeId||'');
    const members=el('details'); members.append(el('summary','Membros participantes'));
    const selection=new Set(item?.memberIds||[]);
    for(const p of people) {
      const entry=el('label',null,'cs-check'); const mark=el('input'); mark.type='checkbox'; mark.checked=selection.has(p.id);
      mark.onchange=()=>mark.checked?selection.add(p.id):selection.delete(p.id);
      entry.append(mark,el('span',p.name)); members.append(entry);
    }
    fields.append(members,el('h3','Checklist'));
    const checklist=el('div');
    function addCheck(data={}) {
      const row=el('div',null,'cs-check'); const mark=el('input'); mark.type='checkbox'; mark.checked=!!data.done; mark.setAttribute('aria-label','Concluído');
      const name=el('input'); name.value=data.title||''; name.required=true; name.maxLength=140; name.setAttribute('aria-label','Item do checklist');
      if(data.id) row.dataset.id=data.id;
      row.append(mark,name,action('Remover',()=>row.remove())); checklist.append(row);
    }
    for(const entry of item?.checklist||[]) addCheck(entry);
    fields.append(checklist,action('Adicionar item',()=>{if(checklist.children.length<30)addCheck();}));
    const error=el('p'); error.setAttribute('role','alert');
    const save=el('button','Salvar tarefa','button button-primary'); save.type='submit';
    if(!fields.disabled) fields.append(save);
    form.append(head,fields,error); dialog.append(form); shell.append(dialog);
    let busy=false;
    dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
    dialog.onclose=()=>dialog.remove();
    form.onsubmit=async e=>{
      e.preventDefault(); if(busy||fields.disabled)return;
      const body={title:title.value.trim(),description:description.value,status:status.value,dueAt:due.value||null,memberIds:[...selection],assigneeId:owner.value||null,
        prospectName:mode.value==='prospect'?prospect.value.trim():'',checklist:[...checklist.children].map(row=>({id:row.dataset.id,title:row.children[1].value.trim(),done:row.children[0].checked}))};
      if(item) body.expectedUpdatedAt=item.updatedAt;
      else Object.assign(body,{module:moduleId,companyCnpj:mode.value==='registered'?company.value:null});
      busy=true; fields.disabled=true; head.lastChild.disabled=true;
      try {
        const result=await request('/work-items'+(item?'/'+item.id:''),{method:item?'PATCH':'POST',body});
        if(item) Object.assign(item,result.item); else items.unshift(result.item);
        dialog.close(); render(); feedback.textContent='Tarefa salva.';
      } catch(e) { error.textContent=e.message; }
      finally {busy=false; fields.disabled=false; head.lastChild.disabled=false;}
    };
    dialog.showModal();
  }
  search.oninput=render; render();
  const linked=new URLSearchParams(location.search).get('atividade');
  const selected=items.find(t=>t.id===linked); if(selected&&shell.isConnected) open(selected);
}
