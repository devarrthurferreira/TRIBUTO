import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClientAdminRouter } from '../src/clients/admin-routes.mjs';

test('Tecnologia gerencia somente o APP Cliente e aplica o escopo de empresa em cada operação', async () => {
  const id = randomUUID();
  const item = randomUUID();
  const company = {id,name:'Cliente de teste',active:true,modules:['guias']};
  const calls=[];
  const clients={
    get:async key=>key===id ? company : null,list:async()=>[company],
    updatePortalModules:async(...args)=>calls.push(args),
  };
  const workspaceStore={
    publish:async(...args)=>{calls.push(args);return {id:item};},
    list:async(...args)=>{calls.push(args);return {items:[],hasMore:false};},
    updateStatus:async(...args)=>{calls.push(args);return {id:item,status:'pago'};},
  };
  const accessAdmin = {handleHttp:async ({user,requireAdmin,send,res})=>{requireAdmin(user);return send(res,200,{access:{}});}};
  const router=createClientAdminRouter({clients,workspaceStore,accessAdmin});
  const staff={_id:'staff',active:true,role:'member',moduleGrants:{tecnologia:'manage'}};
  const visit=(route,method='GET',data={},user=staff)=>router.handleHttp({
    req:{url:'/v1/platform'+route,method},res:{},route,user,send:(_res,status,body)=>({status,body}),
    readBody:async()=>data,requireAdmin:()=>{throw new Error('admin exigido');},logger:console,
  });
  assert.equal((await visit('/clients/app')).body.clients.length,1);
  assert.equal((await visit('/clients/'+id+'/access')).status,200);
  await assert.rejects(visit('/clients/'+id),/admin exigido/);
  for(const grant of ['view','edit',{level:'manage',blockedActions:['clientAppManage']}]) {
    await assert.rejects(visit('/clients/app','GET',{}, {...staff,moduleGrants:{tecnologia:grant}}),err=>err.status===403);
  }
  await visit('/clients/app/'+id+'/modules','PUT',{modules:['guias']});
  assert.deepEqual(calls.pop(),[id,['guias'],'staff']);
  await assert.rejects(visit('/clients/app/'+id+'/modules','PUT',{}), err=>err.status===400);
  await visit('/clients/app/'+id+'/guias','POST',{title:'Guia'});
  assert.deepEqual(calls.pop(),[id,'guias',{title:'Guia'},'staff']);
  await visit('/clients/app/'+id+'/guias/'+item,'PATCH',{status:'pago'});
  assert.deepEqual(calls.pop(),[id,'guias',item,'pago','staff']);
  await assert.rejects(visit('/clients/app/'+id+'/financeiro','POST',{title:'Outro'}),err=>err.status===409);
  await assert.rejects(visit('/clients/app/'+randomUUID()+'/documentos'),err=>err.status===404);
});
