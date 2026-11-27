const identity=document.querySelector('#identity');
try {
  const response=await fetch('/v1'+location.pathname);
  if(!response.ok) throw new Error();
  const person=await response.json();
  const name=document.createElement('h1');
  name.textContent=person.name;
  identity.replaceChildren(name);
  if(person.photo){const photo=new Image(); photo.alt=person.name; photo.src=person.photo; identity.prepend(photo);}
  const socials=document.createElement('div');
  socials.className='bio-socials';
  const contacts=[...person.links];
  if(person.email) contacts.push({platform:'email',url:'mailto:'+person.email});
  if(person.phone) contacts.push({platform:'telefone',url:'tel:'+person.phone.replace(/[^+0-9]/g,'')});
  for(const contact of contacts){
    const link=document.createElement('a');
    const icon=document.createElement('i');
    const icons={instagram:'instagram',linkedin:'linkedin',tiktok:'tiktok',email:'envelope',telefone:'telephone'};
    icon.className='bi bi-'+(icons[contact.platform] || 'link-45deg');
    link.href=contact.url; link.title=contact.label || contact.platform;
    link.setAttribute('aria-label',link.title);link.append(icon);socials.append(link);
  }
  identity.append(socials);
} catch {identity.textContent='Este perfil está indisponível.';}
