// The portal operator's public business registration. Private customer records are managed in the Central.
const officeDocument = '08304049000140';
const systemActor = '00000000-0000-0000-0000-000000000000';

export async function ensureMaximumOffice(clients) {
  const existing = await clients.get(officeDocument);
  if (existing) return;
  try {
    await clients.create({
      type: 'pj', document: officeDocument, legalName: 'MAXIMUM ASSESSORIA CONTABIL',
      nickname: 'Maximum', tradeName: 'Maximum Assessoria Contábil', active: true,
      taxRegime: 'indefinido', street: 'Rua Américo Lôbo', streetNumber: '1192',
      district: 'Manoel Honório', city: 'Juiz de Fora', state: 'MG', postalCode: '36045065',
      website: 'https://maximumcontabil.com.br/', phones: ['3232125584', '32988748436'],
      contacts: [{name: 'Maximum Assessoria Contábil', role: 'Atendimento', email: 'maximum@maximumcontabil.com.br', phone: '3232125584'}],
      modules: [],
    }, systemActor);
  } catch (error) {
    if (error.code !== 'CLIENT_EXISTS' || !(await clients.get(officeDocument))) throw error;
  }
}
