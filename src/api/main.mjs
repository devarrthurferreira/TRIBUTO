import { createApiServer } from './http.mjs';
import { MySqlStore } from './mysql-store.mjs';
import { PlatformMySqlStore } from '../platform/mysql-store.mjs';
import { createPlatformRouter } from '../platform/routes.mjs';
import { ChatMySqlStore } from '../chat/mysql-store.mjs';
import { createChat } from '../chat/service.mjs';
import { WhatsAppMySqlStore } from '../whatsapp/mysql-store.mjs';
import { createWhatsAppService, readWhatsAppConfig } from '../whatsapp/service.mjs';
import { createBaileysBridge, readBaileysConfig } from '../whatsapp/baileys.mjs';
import { createWhatsAppWorkspace } from '../whatsapp/workspace.mjs';
import { ClubMySqlStore } from '../club/mysql-store.mjs';
import { createClubRouter } from '../club/routes.mjs';
import { MarketingCrmStore } from '../marketing/crm-store.mjs';
import { createMarketingCrmRouter } from '../marketing/crm-routes.mjs';
import { readCrmMailConfig, startCrmDelivery } from '../marketing/delivery.mjs';
import { createPublicCrmRouter } from '../marketing/public-crm.mjs';
import { PeopleMySqlStore } from '../people/mysql-store.mjs';
import { createPeopleRouter } from '../people/routes.mjs';
import { MaxHubCoreStore } from '../maxhub/core-store.mjs';
import { createMaxHubCoreRouter } from '../maxhub/core-routes.mjs';
import { MaxHubFeedStore } from '../maxhub/feed-store.mjs';
import { createMaxHubFeedRouter } from '../maxhub/feed-routes.mjs';
import { awardMaxcoin } from '../maxhub/points.mjs';
import { ClientMySqlStore } from '../clients/mysql-store.mjs';
import { ClientCertificateStore } from '../clients/certificates.mjs';
import { ClientAccessStore } from '../clients/access-store.mjs';
import { createClientAccessAdminRouter, createClientPortalRouter } from '../clients/access-routes.mjs';
import { createClientAdminRouter } from '../clients/admin-routes.mjs';
import { createDossierStore } from '../dossiers/store.mjs';
import { createDossierRouter, createPublicDossierRouter } from '../dossiers/routes.mjs';
import { SmtpMySqlStore } from '../notifications/smtp-store.mjs';
import { createSmtpNotificationsRouter, startSmtpDelivery } from '../notifications/smtp-delivery.mjs';

for (const key of ['MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']) {
  if (!process.env[key]) throw new Error(`${key} obrigatória`);
}
const bootstrapTokenSha256 = process.env.BOOTSTRAP_ADMIN_TOKEN_SHA256 || null;
if (bootstrapTokenSha256 && !/^[a-f0-9]{64}$/.test(bootstrapTokenSha256)) throw new Error('BOOTSTRAP_ADMIN_TOKEN_SHA256 deve conter 64 caracteres hex');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida');
const mysqlPort = Number(process.env.MYSQL_PORT || 3306);
if (!Number.isInteger(mysqlPort) || mysqlPort < 1 || mysqlPort > 65535) throw new Error('MYSQL_PORT inválida');
const store = await MySqlStore.connect({
  host: process.env.MYSQL_HOST || '127.0.0.1', port: mysqlPort,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
});
const platformStore = new PlatformMySqlStore(store.pool);
await platformStore.initialize();
const clients = new ClientMySqlStore(platformStore);
const certificates = new ClientCertificateStore(store.pool);
const accessStore = new ClientAccessStore(platformStore);
await Promise.all([clients.initialize(), certificates.initialize(), accessStore.initialize()]);
const secureCookies = process.env.COOKIE_SECURE !== 'false';
const accessAdmin = createClientAccessAdminRouter({ accessStore, clientStore: clients });
const clientAdmin = createClientAdminRouter({ clients, certificates, accessStore, accessAdmin });
const clientPortal = createClientPortalRouter({ accessStore, clientStore: clients, secureCookies });
const smtpStore = new SmtpMySqlStore(platformStore);
await smtpStore.initialize();
const dossiers = createDossierStore({ platformStore, smtpStore });
await dossiers.initialize();
const smtpNotifications = createSmtpNotificationsRouter(smtpStore);
const dossierRouter = createDossierRouter(dossiers);
const publicDossier = createPublicDossierRouter(dossiers);
if (await platformStore.countUsers() === 0 && !bootstrapTokenSha256) throw new Error('Configure BOOTSTRAP_ADMIN_TOKEN_SHA256 para o primeiro administrador');
const maxhubCore = new MaxHubCoreStore(platformStore);
await maxhubCore.initialize();
const maxhubFeed = new MaxHubFeedStore(platformStore);
await maxhubFeed.initialize();
const clubStore = new ClubMySqlStore(platformStore, { awardMood: awardMaxcoin });
await clubStore.initialize();
const crmMail = readCrmMailConfig();
const marketingCrmStore = new MarketingCrmStore(platformStore, {
  deliveryConfigured: Boolean(crmMail), analyticsConfigured: Boolean(crmMail?.webhookKey?.length),
});
await marketingCrmStore.initialize();
const peopleStore = new PeopleMySqlStore(platformStore);
await peopleStore.initialize();
const chatStore = new ChatMySqlStore(store.pool);
await chatStore.initialize();
const chat = createChat({ store: platformStore, chatStore });
const whatsappConfig = process.env.WHATSAPP_MODE === 'baileys' ? null : readWhatsAppConfig();
const baileysConfig = readBaileysConfig();
const whatsappStore = new WhatsAppMySqlStore(store.pool);
const whatsappWorkspace = createWhatsAppWorkspace({ pool: store.pool, whatsAppStore: whatsappStore, platformStore });
await whatsappStore.initialize();
await whatsappWorkspace.initialize();
const bridge = baileysConfig ? createBaileysBridge({ config: baileysConfig, store: whatsappStore, pool: store.pool }) : null;
if (bridge) await bridge.initialize();
const whatsapp = createWhatsAppService({ config: whatsappConfig, store: whatsappStore, bridge, workspace: whatsappWorkspace });
const platformRouter = createPlatformRouter({ store: platformStore, chat, whatsapp, club: createClubRouter(clubStore),
  crm: createMarketingCrmRouter(marketingCrmStore), people: createPeopleRouter(peopleStore),
  maxhubCore: createMaxHubCoreRouter(maxhubCore), maxhubFeed: createMaxHubFeedRouter(maxhubFeed),
  bootstrapTokenSha256, secureCookies, clientAdmin, dossierRouter, smtpNotifications });
const server = createApiServer({ store, agentRegistry: platformStore, platformRouter, whatsapp,
  publicCrm: createPublicCrmRouter(marketingCrmStore, crmMail), clientPortal, publicDossier, bioStore:maxhubCore,
  clientSchedules: documents => clients.collectionSchedules(documents) });
const io = chat.attach(server);
const stopCrmDelivery = startCrmDelivery(marketingCrmStore, crmMail);
const stopSmtpDelivery = startSmtpDelivery(smtpStore);
server.listen(port, host, () => console.log(`TRIBUTO API ouvindo em ${host}:${port}`));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await Promise.all([stopCrmDelivery(), stopSmtpDelivery()]);
    await bridge?.close();
    await io.close();
    await store.close();
    process.exit(0);
  } catch (error) {
    console.error('Falha ao encerrar a aplicação', error.code);
    process.exit(1);
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
