import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import pino from 'pino';
import qrCode from 'qrcode';
import { MODULES } from '../platform/policy.mjs';

const PAIRING_TIME_MS = 135_000;
const QR_TIME_MS = 45_000;
const AUTH_TABLE = `CREATE TABLE IF NOT EXISTS platform_wa_baileys_auth (
  sector VARCHAR(32) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  key_id VARCHAR(190) NOT NULL,
  encrypted LONGBLOB NOT NULL,
  PRIMARY KEY (sector, kind, key_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;
const PHONE = /^[1-9]\d{6,14}$/;
const PROVIDER_ID = /^[\x21-\x7e]{1,255}$/;
const MEDIA = Object.freeze({ imageMessage: ['image', 'Imagem recebida'], audioMessage: ['audio', 'Áudio recebido'],
  videoMessage: ['video', 'Vídeo recebido'], documentMessage: ['document', 'Documento recebido'],
  locationMessage: ['location', 'Localização recebida'], liveLocationMessage: ['location', 'Localização recebida'],
  contactMessage: ['contacts', 'Contato recebido'], contactsArrayMessage: ['contacts', 'Contatos recebidos'],
  stickerMessage: ['sticker', 'Figurinha recebida'] });
const CREDS = 'credentials';
const MAIN = 'main';
// Advisory locks are server-wide, so use the current database as part of the lease key.
const LEASE_KEY_SQL = "CONCAT('central-baileys:', LEFT(SHA2(CONCAT(DATABASE(), ':', ?), 256), 40))";

export function readBaileysConfig(env = process.env) {
  const { WHATSAPP_MODE: mode, WHATSAPP_SECTOR: sector, WHATSAPP_BAILEYS_AUTH_KEY: key } = env;
  if (mode !== 'baileys' || !MODULES.some(module => module.id === sector && !module.legacy)
    || !/^[a-f\d]{64}$/i.test(key || '')) return null;
  return { sector, authKey: Buffer.from(key, 'hex') };
}

function phoneFromJid(jid) {
  const match = /^([1-9]\d{6,14})(?::\d+)?@(?:s\.whatsapp\.net|c\.us)$/.exec(jid || '');
  return match?.[1] ?? null;
}

async function peerPhone(socket, key) {
  const jid = key?.remoteJid;
  if (typeof jid !== 'string' || !/@(?:s\.whatsapp\.net|c\.us|lid)$/.test(jid)) return null;
  const phone = phoneFromJid(jid) || phoneFromJid(key.remoteJidAlt);
  if (phone || !jid.endsWith('@lid')) return phone;
  return phoneFromJid(await socket.signalRepository?.lidMapping?.getPNForLID(jid));
}

function receivedItem(library, update, phone, now) {
  const received = library.normalizeMessageContent(update.message);
  const providerId = update.key?.id;
  const timestamp = Number(update.messageTimestamp) * 1000;
  if (!received || !PROVIDER_ID.test(providerId ?? '') || !Number.isFinite(timestamp)
    || timestamp <= 0 || timestamp > now + 5 * 60_000) return null;
  if (received.protocolMessage || received.senderKeyDistributionMessage || received.reactionMessage) return null;
  const rawText = received.conversation ?? received.extendedTextMessage?.text;
  const mediaKey = Object.keys(MEDIA).find(key => received[key]);
  const [type, fallback] = mediaKey ? MEDIA[mediaKey] : ['other', 'Mensagem recebida'];
  const text = typeof rawText === 'string' ? rawText.trim().slice(0, 4096) : '';
  const name = typeof update.pushName === 'string' ? update.pushName.trim().slice(0, 120) : '';
  return { providerId, phone, name, type: text ? 'text' : type, text: text || fallback, at: new Date(Math.min(now, timestamp)) };
}

function rowContext(sector, kind, id) {
  return Buffer.from(JSON.stringify([sector, kind, id]));
}

function seal(config, kind, id, value, replacer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.authKey, iv);
  cipher.setAAD(rowContext(config.sector, kind, id));
  const body = Buffer.concat([cipher.update(JSON.stringify(value, replacer), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function unseal(config, kind, id, value, reviver) {
  const decipher = createDecipheriv('aes-256-gcm', config.authKey, value.subarray(0, 12));
  decipher.setAAD(rowContext(config.sector, kind, id));
  decipher.setAuthTag(value.subarray(12, 28));
  const text = Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
  return JSON.parse(text, reviver);
}

function makeAuthStore(pool, config, library) {
  const { replacer, reviver } = library.BufferJSON;

  async function write(executor, kind, id, value) {
    if (value == null) return executor.execute('DELETE FROM platform_wa_baileys_auth WHERE sector = ? AND kind = ? AND key_id = ?', [config.sector, kind, id]);
    const encrypted = seal(config, kind, id, value, replacer);
    return executor.execute(`INSERT INTO platform_wa_baileys_auth (sector, kind, key_id, encrypted)
      VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE encrypted = VALUES(encrypted)`, [config.sector, kind, id, encrypted]);
  }

  async function get(kind, ids) {
    if (!ids.length) return {};
    const [rows] = await pool.execute(`SELECT key_id, encrypted FROM platform_wa_baileys_auth
      WHERE sector = ? AND kind = ? AND key_id IN (${ids.map(() => '?').join(', ')})`, [config.sector, kind, ...ids]);
    return Object.fromEntries(rows.map(({ key_id: id, encrypted }) => {
      const data = unseal(config, kind, id, encrypted, reviver);
      return [id, kind === 'app-state-sync-key' ? library.proto.Message.AppStateSyncKeyData.fromObject(data) : data];
    }));
  }

  async function set(data) {
    const executor = await pool.getConnection();
    try {
      await executor.beginTransaction();
      for (const [kind, values] of Object.entries(data)) {
        for (const [id, value] of Object.entries(values)) await write(executor, kind, id, value);
      }
      await executor.commit();
    } catch (error) {
      await executor.rollback();
      throw error;
    } finally {
      executor.release();
    }
  }

  return {
    async credentials() { return (await get(CREDS, [MAIN]))[MAIN] ?? null; },
    saveCredentials: (creds) => write(pool, CREDS, MAIN, creds),
    clear: () => pool.execute('DELETE FROM platform_wa_baileys_auth WHERE sector = ?', [config.sector]),
    keys: { get, set }
  };
}

function bounded(task, ms) {
  let timer;
  return Promise.race([task, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('WhatsApp: prazo excedido')), ms);
    timer.unref?.();
  })]).finally(() => clearTimeout(timer));
}

export function createBaileysBridge({ config, store, pool, logger = console,
  loadLibrary = () => import('@whiskeysockets/baileys'), renderQr = (value) => qrCode.toDataURL(value, { width: 280, margin: 3 }) }) {
  const transportLogger = pino({ level: 'silent' });
  let library, authStore, lease, leaseTimer, socket, retry, pairingTimer, accountPhone, qr;
  let state = 'disconnected';
  let lifecycle = Promise.resolve();
  let authWrites = Promise.resolve();
  let pairingUntil = 0;
  let attempts = 0;
  let closing = false;
  const sending = new Map();

  function report(stage) {
    logger.warn?.('Integração WhatsApp indisponível', { stage });
  }

  function queue(work) {
    const task = lifecycle.then(work);
    lifecycle = task.catch(() => {});
    return task;
  }

  function scheduleEvent(work) { void queue(work).catch(() => report('evento')); }

  async function stopSocket() {
    const active = socket;
    socket = null;
    if (active) {
      try { await bounded(Promise.resolve(active.end(undefined)), 3000); }
      catch { /* socket already closed */ }
    }
  }

  function clearPairing() {
    qr = null;
    pairingUntil = 0;
    clearTimeout(pairingTimer);
  }

  async function releaseLease() {
    const executor = lease;
    lease = null;
    clearInterval(leaseTimer);
    if (!executor) return;
    try { await executor.execute(`SELECT RELEASE_LOCK(${LEASE_KEY_SQL})`, [config.sector]); }
    catch { executor.destroy(); }
    finally { executor.release(); }
  }

  async function claimLease() {
    if (lease) return true;
    const executor = await pool.getConnection();
    try {
      const [[row]] = await executor.execute(`SELECT GET_LOCK(${LEASE_KEY_SQL}, 0) claimed`, [config.sector]);
      if (Number(row.claimed) !== 1) {
        executor.release();
        return false;
      }
      lease = executor;
      leaseTimer = setInterval(async () => {
        try { await executor.query('SELECT 1'); }
        catch {
          scheduleEvent(async () => {
            if (lease !== executor) return;
            await stopSocket();
            await releaseLease();
            delayedReconnect();
          });
        }
      }, 25_000);
      leaseTimer.unref?.();
      return true;
    } catch (error) {
      executor.release();
      throw error;
    }
  }

  function delayedReconnect(immediate = false) {
    if (closing) return;
    state = 'reconnecting';
    clearTimeout(retry);
    retry = setTimeout(() => scheduleEvent(openSocket), immediate ? 50 : Math.min(30_000, 1000 * (2 ** Math.min(attempts++, 5))));
    retry.unref?.();
  }

  function scope() {
    return accountPhone ? { phoneId: `baileys:${accountPhone}`, sector: config.sector } : null;
  }

  function storeAuthWrite(work) {
    const pending = authWrites.then(work);
    authWrites = pending.catch(() => report('gravação da sessão'));
    return pending;
  }

  async function dormant(nextState) {
    clearTimeout(retry);
    clearPairing();
    await stopSocket();
    sending.clear();
    await authWrites;
    await releaseLease();
    state = nextState;
  }

  async function handleConnection(active, creds, update) {
    if (socket !== active) return;
    if (update.connection === 'close') {
      socket = null;
      qr = null;
      await authWrites;
      const reason = update.lastDisconnect?.error?.output?.statusCode;
      if ([library.DisconnectReason.loggedOut, library.DisconnectReason.badSession].includes(reason)) {
        accountPhone = null;
        if (lease) await authStore.clear();
        await dormant('disconnected');
        return;
      }
      if ([library.DisconnectReason.connectionReplaced, library.DisconnectReason.forbidden,
        library.DisconnectReason.multideviceMismatch].includes(reason) || !creds.registered && pairingUntil <= Date.now()) {
        await dormant('disconnected');
        return;
      }
      delayedReconnect(reason === library.DisconnectReason.restartRequired);
      return;
    }
    if (update.connection === 'open') {
      const self = active.user || creds.me;
      accountPhone = phoneFromJid(self?.phoneNumber) || phoneFromJid(self?.id) || phoneFromJid(creds.me?.id);
      if (!accountPhone) {
        await dormant('error');
        return;
      }
      attempts = 0;
      clearPairing();
      state = 'connected';
      return;
    }
    if (!update.qr) return;
    if (pairingUntil <= Date.now()) {
      await dormant('disconnected');
      return;
    }
    qr = { qrImage: await renderQr(update.qr), qrExpiresAt: new Date(Date.now() + QR_TIME_MS).toISOString() };
    state = 'qr';
  }

  async function openSocket() {
    if (closing || socket) return;
    state = attempts ? 'reconnecting' : 'connecting';
    try {
      if (!await claimLease()) {
        delayedReconnect();
        return;
      }
      await authWrites;
      const saved = await authStore.credentials();
      if (!saved?.registered && pairingUntil <= Date.now()) {
        await dormant('disconnected');
        return;
      }
      const creds = saved || library.initAuthCreds();
      let current;
      const keys = {
        get: async (kind, ids) => { await authWrites; return authStore.keys.get(kind, ids); },
        set: (data) => current && current === socket ? storeAuthWrite(() => authStore.keys.set(data)) : Promise.resolve()
      };
      current = library.default({ auth: { creds, keys }, logger: transportLogger,
        browser: library.Browsers.ubuntu('Chrome'), syncFullHistory: false, shouldSyncHistoryMessage: () => false,
        connectTimeoutMs: 20_000, qrTimeout: QR_TIME_MS, markOnlineOnConnect: false,
        emitOwnEvents: false, getMessage: async key => sending.get(key.id)?.content });
      socket = current;
      current.ev.on('creds.update', update => {
        if (socket !== current) return;
        Object.assign(creds, update);
        void storeAuthWrite(() => authStore.saveCredentials(creds)).catch(() => {});
      });
      current.ev.on('connection.update', update => scheduleEvent(() => handleConnection(current, creds, update)));
      current.ev.on('messages.upsert', event => {
        if (event.type !== 'notify') return;
        scheduleEvent(async () => {
          if (socket !== current || !scope()) return;
          for (const update of event.messages) {
            if (!update.message || update.key?.fromMe) continue;
            const phone = await peerPhone(current, update.key);
            const item = phone ? receivedItem(library, update, phone, Date.now()) : null;
            if (item) await store.recordInbound(scope(), item);
          }
        });
      });
      current.ev.on('messages.update', updates => scheduleEvent(async () => {
        if (socket !== current || !scope()) return;
        const statuses = library.WAMessageStatus;
        for (const { key, update } of updates) {
          if (!key.fromMe || !PROVIDER_ID.test(key.id ?? '')) continue;
          const state = ({ [statuses.SERVER_ACK]: ['sent', 1], [statuses.ERROR]: ['failed', 2],
            [statuses.DELIVERY_ACK]: ['delivered', 3], [statuses.READ]: ['read', 4], [statuses.PLAYED]: ['read', 4] })[update.status];
          if (!state) continue;
          const phone = await peerPhone(current, key);
          if (phone) await store.recordDelivery(scope(), { phone, providerId: key.id, clientId: sending.get(key.id)?.clientId ?? null,
            status: state[0], rank: state[1] });
        }
      }));
    } catch {
      report('conexão');
      await dormant('error');
    }
  }

  async function initialize() {
    await pool.query(AUTH_TABLE);
    library = await loadLibrary();
    authStore = makeAuthStore(pool, config, library);
    try {
      const saved = await authStore.credentials();
      if (saved?.registered) {
        accountPhone = phoneFromJid(saved.me?.phoneNumber) || phoneFromJid(saved.me?.id);
        await queue(openSocket);
      }
    } catch {
      report('restauração da sessão');
      state = 'error';
    }
  }

  function status({ includeQr = false } = {}) {
    const activeQr = includeQr && qr && Date.parse(qr.qrExpiresAt) > Date.now() ? qr : {};
    return { state, phone: accountPhone ?? null, ...activeQr };
  }

  async function connect() {
    return queue(async () => {
      if (!socket && !closing) {
        pairingUntil = Date.now() + PAIRING_TIME_MS;
        clearTimeout(retry);
        clearTimeout(pairingTimer);
        pairingTimer = setTimeout(() => scheduleEvent(async () => {
          if (state !== 'connected') await dormant('disconnected');
        }), PAIRING_TIME_MS);
        pairingTimer.unref?.();
        await openSocket();
      }
      return status({ includeQr: true });
    });
  }

  async function disconnect() {
    return queue(async () => {
      if (!await claimLease()) return { ...status(), unlinkConfirmed: false };
      clearTimeout(retry);
      clearPairing();
      const active = socket;
      socket = null;
      let unlinkConfirmed = false;
      try {
        if (active && accountPhone) {
          await bounded(active.logout(), 5000);
          unlinkConfirmed = true;
        }
      } catch { report('desvinculação do dispositivo'); }
      finally {
        if (active) {
          try { await bounded(Promise.resolve(active.end(undefined)), 3000); }
          catch { /* logout already closed the socket */ }
        }
        await authWrites;
        try { await authStore.clear(); }
        finally {
          sending.clear();
          accountPhone = null;
          state = 'disconnected';
          await releaseLease();
        }
      }
      return { ...status(), unlinkConfirmed };
    });
  }

  async function send(phone, text, clientId, expectedScope) {
    const active = socket;
    const currentScope = scope();
    if (!active || state !== 'connected' || !PHONE.test(phone) || !currentScope
      || expectedScope && currentScope.phoneId !== expectedScope.phoneId) return { providerId: null, status: 'failed', rank: 2 };
    const providerId = `3EB0${createHash('sha256').update(`${currentScope.phoneId}|${phone}|${clientId}`).digest('hex').slice(0, 18).toUpperCase()}`;
    sending.set(providerId, { clientId, content: { conversation: text } });
    const expire = setTimeout(() => sending.delete(providerId), 60_000);
    expire.unref?.();
    try {
      const result = await bounded(active.sendMessage(`${phone}@s.whatsapp.net`, { text }, { messageId: providerId }), 12_000);
      return result?.key?.id
        ? { providerId: result.key.id, status: 'accepted', rank: 1 }
        : { providerId, status: 'uncertain', rank: 0 };
    } catch {
      return { providerId, status: 'uncertain', rank: 0 };
    }
  }

  return { sector: config.sector, initialize, connect, disconnect, status, scope, send, async close() {
    closing = true;
    await queue(() => dormant('disconnected'));
  } };
}
