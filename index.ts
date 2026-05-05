import * as cheerio from 'cheerio';
import { Hono } from 'hono';
import { log } from './log';
import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    type WASocket
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
// @ts-ignore
import qrcode from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import { renderer, Dashboard } from './dashboard';
import { serveStatic } from 'hono/bun';
import { streamSSE } from 'hono/streaming';
import { db } from './db';
import { contacts as contactsTable } from './schema';
import { eq } from 'drizzle-orm';

// --- Types ---
export interface PintuAirData {
    id_pintu_air: string;
    kode_stasiun: string;
    nama_pintu_air: string;
    lokasi: string;
    sort_number: string;
    siaga1: string;
    siaga2: string;
    siaga3: string;
    siaga4: string;
    latitude: string;
    longitude: string;
    file_export: string;
    record_status: string;
    created_date?: string;
    created_by?: string;
    last_updated_date?: string;
    last_updated_by?: string;
    tanggal: string;
    tinggi_air: string;
    tinggi_air_sebelumnya: string;
    status_siaga: string;
    tma_unaltered: string;
    coor_x?: string;
    coor_y?: string;
}

interface AppConfig {
    targetJids: string[];
}

// --- Constants ---
const CHECK_INTERVAL = 90_000;
const INDICATOR_CODE_STATION = ['32', '25']; // Angke Hulu, Cengkareng Drain
const CONFIG_FILE = './config.json';
const AUTH_DIR = './baileys_auth';

const mem: Record<string, any> = {
    interval: null,
    qr: null,
    waStatus: 'connecting',
    lastStatus: {} as Record<string, number>,
    data: [] as PintuAirData[],
    contacts: {} as Record<string, string>,
    sseControllers: new Set<any>(),
    selfId: null,
    selfLid: null,
    isConnecting: false,
    lastSiaga1NotifyTime: 0
};

// Initialize Database
async function initDb() {
    // Create table if not exists (raw sqlite since we don't have migrations ran yet)
    db.run(`CREATE TABLE IF NOT EXISTS contacts (jid TEXT PRIMARY KEY, name TEXT NOT NULL)`);

    // Load existing contacts
    const allContacts = db.select().from(contactsTable).all();
    for (const c of allContacts) {
        mem.contacts[c.jid] = c.name;
    }
    log(`Loaded ${allContacts.length} contacts from DB`);
}

function broadcastWAUpdate() {
    const data = JSON.stringify({
        status: mem.waStatus,
        qr: mem.qr
    });
    for (const controller of mem.sseControllers) {
        try {
            controller.writeSSE({ data, event: 'wa-update' });
        } catch (e) {
            mem.sseControllers.delete(controller);
        }
    }
}

function broadcastStationUpdate() {
    const data = JSON.stringify({
        data: mem.data,
        lastStatus: mem.lastStatus,
        isAlarmActive: !!mem.interval
    });
    for (const controller of mem.sseControllers) {
        try {
            controller.writeSSE({ data, event: 'station-update' });
        } catch (e) {
            mem.sseControllers.delete(controller);
        }
    }
}

function broadcastContactsUpdate() {
    const data = JSON.stringify({
        contacts: mem.contacts,
        targetJids: config.targetJids,
        selfId: mem.selfId
    });
    for (const controller of mem.sseControllers) {
        try {
            controller.writeSSE({ data, event: 'contacts-update' });
        } catch (e) {
            mem.sseControllers.delete(controller);
        }
    }
}

let sock: WASocket | null = null;
let config: AppConfig = { targetJids: [] };

// Load config
if (fs.existsSync(CONFIG_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        if (loaded.targetJid && !loaded.targetJids) {
            config.targetJids = [loaded.targetJid];
        } else {
            config.targetJids = loaded.targetJids || [];
        }
    } catch (e) {
        log('Error loading config:' + e);
    }
}

function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function saveContact(jid: string, name: string) {
    if (!jid || !name) return;

    // Protect "Me (Self)" label
    if (mem.selfId && jid === mem.selfId) {
        name = 'Me (Self)';
    }

    if (mem.contacts[jid] === name) return; // Skip if no change

    mem.contacts[jid] = name;
    db.insert(contactsTable)
        .values({ jid, name })
        .onConflictDoUpdate({ target: contactsTable.jid, set: { name } })
        .run();
}

// --- Helper Functions ---
function getStatusNumber(tinggiAir: number, s1: number, s2: number, s3: number): number {
    if (tinggiAir >= s1) return 1;
    if (tinggiAir >= s2) return 2;
    if (tinggiAir >= s3) return 3;
    return 4;
}

async function handleCommand(sock: WASocket, remoteJid: string, text: string) {
    if (!text.startsWith('/')) return;

    const command = text.split(' ')[0]!.toLowerCase();
    // const args = text.split(' ').slice(1);

    switch (command) {
        case '/help':
            const helpMsg = `🤖 *Available Commands:*\n\n` +
                `*/help* - Show this help message\n` +
                `*/status* - Check current water level status\n` +
                `*/list* - List target JIDs\n` +
                `*/notify* - Send manual notification to all targets\n` +
                `*/ping* - Check bot status`;
            await sock.sendMessage(remoteJid, { text: helpMsg });
            break;
        case '/status':
            const summary = mem.data.map((p: any) => {
                const status = getStatusNumber(Number(p.tinggi_air), Number(p.siaga1) + 350, Number(p.siaga2) + 350, Number(p.siaga3) + 350);
                const emoji = status === 1 ? '🔴' : status === 2 ? '🟡' : status === 3 ? '🔵' : '🟢';
                return `${emoji} *${p.nama_pintu_air}*: ${Number(p.tinggi_air) / 10}cm (Siaga ${status})`;
            }).join('\n');
            await sock.sendMessage(remoteJid, { text: `🤖 *Current Status:*\n\n${summary || 'No data available'}` });
            break;
        case '/list':
            const targets = config.targetJids.map(jid => `- ${mem.contacts[jid] || jid}`).join('\n');
            await sock.sendMessage(remoteJid, { text: `🤖 *Target JIDs:*\n\n${targets || 'No targets configured'}` });
            break;
        case '/notify':
            if (config.targetJids.length === 0) {
                await sock.sendMessage(remoteJid, { text: '🤖 No target JIDs configured.' });
                break;
            }

            const currentSummary = mem.data.map((p: any) => {
                const status = getStatusNumber(Number(p.tinggi_air), Number(p.siaga1) + 350, Number(p.siaga2) + 350, Number(p.siaga3) + 350);
                const emoji = status === 1 ? '🔴' : status === 2 ? '🟡' : status === 3 ? '🔵' : '🟢';
                return `${emoji} *${p.nama_pintu_air}*: ${Number(p.tinggi_air) / 10}cm (Siaga ${status})`;
            }).join('\n');

            const notifyMsg = `🔔 *Bunjir Alarm: Current Status Update*\n\n${currentSummary || 'No data available'}\n\n_Triggered manually via command._`;

            let successCount = 0;
            for (const targetJid of config.targetJids) {
                try {
                    await sock.sendMessage(targetJid, { text: notifyMsg });
                    successCount++;
                } catch (e) {
                    log(`Failed to send notify message to ${targetJid}: ${e}`);
                }
            }
            await sock.sendMessage(remoteJid, { text: `🤖 Current status notification sent to ${successCount}/${config.targetJids.length} targets.` });
            break;
        case '/ping':
            await sock.sendMessage(remoteJid, { text: '🤖 pong' });
            break;
    }
}

// --- WhatsApp Logic ---
async function connectToWhatsApp() {
    if (mem.isConnecting) {
        log('Connection attempt already in progress, skipping...');
        return;
    }
    mem.isConnecting = true;

    try {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        const { version } = await fetchLatestBaileysVersion();

        if (sock) {
            log('Cleaning up existing socket...');
            try { sock.ev.removeAllListeners('connection.update'); } catch (e) { }
            try { sock.end(undefined); } catch (e) { }
            sock = null;
        }

        log('Initializing WhatsApp connection...');
        sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
            },
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                mem.qr = await qrcode.toDataURL(qr);
                mem.waStatus = 'qr';
                broadcastWAUpdate();
            }

            if (connection === 'close') {
                mem.isConnecting = false;
                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                log('connection closed due to ' + lastDisconnect?.error + ', reconnecting ' + shouldReconnect);
                mem.waStatus = 'disconnected';
                mem.qr = null;
                broadcastWAUpdate();
                if (shouldReconnect) {
                    mem.waStatus = 'connecting';
                    broadcastWAUpdate();
                    // debounce reconnect
                    setTimeout(() => connectToWhatsApp(), 3000);
                }
            } else if (connection === 'open') {
                log('opened connection');
                mem.isConnecting = false;
                mem.waStatus = 'open';
                mem.qr = null;
                broadcastWAUpdate();

                // Capture self JID and LID
                if (sock?.user) {
                    mem.selfId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    // @ts-ignore
                    mem.selfLid = sock.user.lid || null;
                    saveContact(mem.selfId, 'Me (Self)');
                    if (mem.selfLid) saveContact(mem.selfLid, 'Me (Self - LID)');
                    log(`Self Identifiers - JID: ${mem.selfId}, LID: ${mem.selfLid}`);
                }

                // FORCE SYNC GROUPS
                if (sock) {
                    try {
                        const groups = await sock.groupFetchAllParticipating();
                        for (const jid in groups) {
                            const group = groups[jid];
                            if (group) saveContact(jid, (group.subject || jid.split('@')[0]) as string);
                        }
                        log(`Deep sync: ${Object.keys(groups).length} groups fetched.`);
                    } catch (e) {
                        log('Error in deep sync: ' + e);
                    }
                }

                broadcastContactsUpdate();
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('contacts.upsert', (contacts) => {
            for (const contact of contacts) {
                if (contact.id) {
                    const name = (contact.name || contact.notify || contact.verifiedName || contact.id.split('@')[0]) as string;
                    saveContact(contact.id, name);
                }
            }
            broadcastContactsUpdate();
        });

        sock.ev.on('contacts.update', (updates) => {
            let changed = false;
            for (const update of updates) {
                const name = update.name || update.notify || update.verifiedName;
                if (name && update.id) {
                    saveContact(update.id, name as string);
                    changed = true;
                }
            }
            if (changed) broadcastContactsUpdate();
        });

        sock.ev.on('groups.upsert', (groups) => {
            for (const group of groups) {
                if (group.id) {
                    saveContact(group.id, (group.subject || group.id.split('@')[0]) as string);
                }
            }
            broadcastContactsUpdate();
        });

        sock.ev.on('groups.update', (updates) => {
            for (const update of updates) {
                if (update.id) {
                    saveContact(update.id, (update.subject || update.id.split('@')[0]) as string);
                }
            }
            broadcastContactsUpdate();
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            let changed = false;
            for (const msg of messages) {
                // Save contact info if pushName is available
                if (msg.key.remoteJid && msg.pushName) {
                    saveContact(msg.key.remoteJid, msg.pushName);
                    changed = true;
                }

                // Command listener: Only respond if the message is in the "Me (Self)" chat
                const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

                if (text && text.startsWith('/')) {
                    const remoteJid = msg.key.remoteJid;
                    if (!remoteJid) continue;

                    const normalizedRemote = jidNormalizedUser(remoteJid);
                    const normalizedSelfId = mem.selfId ? jidNormalizedUser(mem.selfId) : null;
                    const normalizedSelfLid = mem.selfLid ? jidNormalizedUser(mem.selfLid) : null;

                    log(`Incoming command: "${text}" from ${remoteJid} (Normalized: ${normalizedRemote})`);
                    log(`Self Identifiers - Normalized JID: ${normalizedSelfId}, Normalized LID: ${normalizedSelfLid}`);

                    if (sock && (normalizedSelfId || normalizedSelfLid)) {
                        const isSelfChat = normalizedRemote === normalizedSelfId || normalizedRemote === normalizedSelfLid;
                        if (isSelfChat) {
                            log(`Executing command: ${text}`);
                            await handleCommand(sock, remoteJid, text);
                        } else {
                            log(`Command ignored: Not in self chat (Normalized JID: ${normalizedRemote})`);
                        }
                    }
                }
            }
            if (changed) broadcastContactsUpdate();
        });

        sock.ev.on('messaging-history.set', ({ contacts }) => {
            if (contacts) {
                for (const contact of contacts) {
                    if (contact.id) {
                        const name = (contact.name || contact.notify || contact.verifiedName || contact.id.split('@')[0]) as string;
                        saveContact(contact.id, name);
                    }
                }
                broadcastContactsUpdate();
            }
        });

    } catch (e) {
        mem.isConnecting = false;
        log('Failed to initialize socket: ' + e);
    }
}

// --- Helper Functions ---
async function fetchData(): Promise<PintuAirData[]> {
    try {
        const raw = await fetch("https://poskobanjir.dsdadki.web.id/xmldata.xml");
        const text = await raw.text();
        const $ = cheerio.load(text);
        const Documentelement = $('Documentelement');
        const res: PintuAirData[] = [];

        Documentelement.children('SP_GET_LAST_STATUS_PINTU_AIR').each((_, pintu) => {
            const obj: any = {};
            $(pintu).children().each((_, child) => {
                if (child.type === 'tag') {
                    const name = child.name;
                    const text = $(child).text();
                    obj[name] = text;
                }
            });
            if (obj.kode_stasiun) {
                res.push(obj as PintuAirData);
            }
        });

        return res;
    } catch (error) {
        log('Fetch error: ' + error);
        return [];
    }
}

async function checkStatusChanges(data: PintuAirData[]) {
    const filtered = data.filter(p => INDICATOR_CODE_STATION.includes(p.kode_stasiun));
    mem.data = filtered;

    const summary = filtered.map(p => `${p.nama_pintu_air}: ${Number(p.tinggi_air) / 10}cm (S${getStatusNumber(Number(p.tinggi_air), Number(p.siaga1), Number(p.siaga2), Number(p.siaga3))})`).join(' | ');
    log(`Check: ${summary}`);

    for (const pintu of filtered) {
        const currentTma = Number(pintu.tinggi_air);
        const s1 = Number(pintu.siaga1) + 350;
        const s2 = Number(pintu.siaga2) + 350;
        const s3 = Number(pintu.siaga3) + 350;

        const status = getStatusNumber(currentTma, s1, s2, s3);
        const prevStatus = mem.lastStatus[pintu.kode_stasiun];

        if (prevStatus !== undefined && prevStatus !== status) {
            const msg = `🚨 *Status Change Alert*\n\nStation: *${pintu.nama_pintu_air}*\nPrevious: Siaga ${prevStatus}\nCurrent: *Siaga ${status}*\nTMA: ${Number(currentTma) / 10} cm\n\nThresholds:\nS1: ${s1 / 10}cm, S2: ${s2 / 10}cm, S3: ${s3 / 10}cm`;
            log(msg);

            if (sock && mem.waStatus === 'open' && config.targetJids.length > 0) {
                for (const jid of config.targetJids) {
                    try {
                        await sock.sendMessage(jid, { text: msg });
                    } catch (e) {
                        log(`Failed to send message to ${jid}: ${e}`);
                    }
                }
            }
        }
        mem.lastStatus[pintu.kode_stasiun] = status;
    }
    broadcastStationUpdate();
}

function decideAlarm(data: PintuAirData[]): boolean {
    const filtered = data.filter(p => INDICATOR_CODE_STATION.includes(p.kode_stasiun));
    for (const pintu of filtered) {
        if (Number(pintu.tinggi_air) > Number(pintu.siaga2) + 350) {
            return true;
        }
    }
    return false;
}

function startAlarm() {
    if (mem.interval) return;
    const id = setInterval(() => {
        log('Bunjir Alarm is active!');
    }, 10000);
    mem.interval = id;
}

// --- Hono App ---
const app = new Hono();

app.get('/pico.min.css', serveStatic({ path: './pico.min.css' }));

app.get('/sse', (c) => {
    return streamSSE(c, async (stream) => {
        mem.sseControllers.add(stream);

        await stream.writeSSE({
            data: JSON.stringify({ status: mem.waStatus, qr: mem.qr }),
            event: 'wa-update'
        });

        await stream.writeSSE({
            data: JSON.stringify({
                data: mem.data,
                lastStatus: mem.lastStatus,
                isAlarmActive: !!mem.interval
            }),
            event: 'station-update'
        });

        await stream.writeSSE({
            data: JSON.stringify({
                contacts: mem.contacts,
                targetJids: config.targetJids,
                selfId: mem.selfId
            }),
            event: 'contacts-update'
        });

        stream.onAbort(() => {
            mem.sseControllers.delete(stream);
        });

        while (true) {
            await stream.sleep(30000);
            await stream.writeSSE({ data: 'ping', event: 'ping' });
        }
    });
});

app.use('*', renderer);

app.get('/', (c) => {
    return c.render(
        Dashboard({
            waStatus: mem.waStatus,
            qr: mem.qr,
            targetJids: config.targetJids,
            data: mem.data,
            lastStatus: mem.lastStatus,
            isAlarmActive: !!mem.interval,
            contacts: mem.contacts,
            selfId: mem.selfId
        })
    );
});

app.post('/set-target', async (c) => {
    const fd = await c.req.formData();
    let jids: string[] = [];

    // Handle manual input
    const manualStr = fd.get('jid_manual') as string;
    if (manualStr) {
        const manual = manualStr.split(',').map(j => j.trim()).filter(j => j.length > 0);
        jids.push(...manual);
    }

    // Handle select input (multi-select)
    const selected = fd.getAll('jid_select') as string[];
    if (selected && selected.length > 0) {
        jids.push(...selected);
    }

    config.targetJids = [...new Set(jids)];
    saveConfig();

    // Re-broadcast so all clients update their UI
    broadcastContactsUpdate();

    return c.redirect('/');
});

app.post('/test-send', async (c) => {
    if (!sock || mem.waStatus !== 'open') {
        return c.json({ success: false, message: 'WhatsApp is not connected.' }, 400);
    }
    if (config.targetJids.length === 0) {
        return c.json({ success: false, message: 'No target JIDs configured.' }, 400);
    }
    const msg = "🔔 *Bunjir Alarm: Test Message*\nThis is a test notification to verify your connection setup.";
    let successCount = 0;
    for (const jid of config.targetJids) {
        try {
            await sock.sendMessage(jid, { text: msg });
            successCount++;
        } catch (e) {
            log(`Failed to send test message to ${jid}: ${e}`);
        }
    }
    return c.json({
        success: true,
        message: `Test message sent to ${successCount}/${config.targetJids.length} targets.`
    });
});

app.post('/reset-contacts', async (c) => {
    mem.contacts = {};
    db.delete(contactsTable).run();
    log('Contacts database and memory cleared.');
    broadcastContactsUpdate();
    return c.json({ success: true });
});

app.post('/rescan', async (c) => {
    if (sock) {
        try {
            await sock.logout();
        } catch (e) { }
        sock = null;
    }

    // Completely wipe auth directory to force a new QR
    if (fs.existsSync(AUTH_DIR)) {
        try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            log('Auth directory wiped for rescan.');
        } catch (e) {
            log('Error wiping auth dir: ' + e);
        }
    }

    mem.waStatus = 'connecting';
    mem.qr = null;
    broadcastWAUpdate();

    // Re-init connection
    connectToWhatsApp();

    return c.json({ success: true });
});

app.post('/disconnect', async (c) => {
    if (sock) {
        try {
            await sock.logout();
        } catch (e) { }
        sock = null;
    }
    mem.waStatus = 'disconnected';
    mem.qr = null;
    broadcastWAUpdate();
    return c.json({ success: true });
});

app.post('/reconnect', async (c) => {
    if (sock) {
        sock.end(undefined);
        sock = null;
    }
    mem.waStatus = 'connecting';
    mem.qr = null;
    broadcastWAUpdate();
    connectToWhatsApp();
    return c.json({ success: true });
});

app.get('/stop', (c) => {
    log('stopping alarm...');
    if (mem.interval) {
        clearInterval(mem.interval);
        mem.interval = null;
    }
    return c.text('ok');
});

// --- Helper Functions ---
async function sendPeriodicSiaga1Notification() {
    if (!sock || mem.waStatus !== 'open' || config.targetJids.length === 0) return;

    const currentSummary = mem.data.map((p: any) => {
        const status = getStatusNumber(Number(p.tinggi_air), Number(p.siaga1) + 350, Number(p.siaga2) + 350, Number(p.siaga3) + 350);
        const emoji = status === 1 ? '🔴' : status === 2 ? '🟡' : status === 3 ? '🔵' : '🟢';
        return `${emoji} *${p.nama_pintu_air}*: ${Number(p.tinggi_air) / 10}cm (Siaga ${status})`;
    }).join('\n');

    const notifyMsg = `🚨 *Bunjir Alarm: Periodic Siaga 1 Update*\n\n${currentSummary || 'No data available'}\n\n_Automated update (Every 30m during Siaga 1)._`;

    for (const targetJid of config.targetJids) {
        try {
            await sock.sendMessage(targetJid, { text: notifyMsg });
        } catch (e) {
            log(`Failed to send periodic notify message to ${targetJid}: ${e}`);
        }
    }
}

// --- Main Loop ---
async function main() {
    log('checking data...');
    const data = await fetchData();
    if (data.length > 0) {
        await checkStatusChanges(data);
        if (decideAlarm(data)) {
            startAlarm();
        }

        const hasSiaga1 = mem.data.some((p: any) => {
            const status = getStatusNumber(Number(p.tinggi_air), Number(p.siaga1) + 350, Number(p.siaga2) + 350, Number(p.siaga3) + 350);
            return status === 1;
        });

        if (hasSiaga1) {
            const now = Date.now();
            // 30 minutes = 30 * 60 * 1000 = 1800000 ms
            if (now - mem.lastSiaga1NotifyTime >= 1800000) {
                mem.lastSiaga1NotifyTime = now;
                await sendPeriodicSiaga1Notification();
            }
        } else {
            mem.lastSiaga1NotifyTime = 0;
        }
    }
    setTimeout(main, CHECK_INTERVAL);
}

// Start everything
initDb().then(() => {
    connectToWhatsApp();
    main();
});

Bun.serve({
    fetch: app.fetch,
    port: 6001
});
