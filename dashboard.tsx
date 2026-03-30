import { jsxRenderer } from 'hono/jsx-renderer';
import type { PintuAirData } from './index';

export const renderer = jsxRenderer(({ children }) => {
    return (
        <html lang="en" data-theme="light">
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>Bunjir Alarm Dashboard</title>
                <link rel="stylesheet" href="/pico.min.css" />
                <style>{`
                    .status-dot {
                        height: 8px;
                        width: 8px;
                        border-radius: 50%;
                        display: inline-block;
                        margin-right: 4px;
                    }
                    .bg-siaga-1 { background-color: #d32f2f; }
                    .bg-siaga-2 { background-color: #f57c00; }
                    .bg-siaga-3 { background-color: #fbc02d; }
                    .bg-siaga-4 { background-color: #388e3c; }
                    
                    .qr-card {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        background: var(--pico-card-sectioning-background-color);
                        padding: 1rem;
                        border-radius: var(--pico-border-radius);
                        margin-bottom: 1rem;
                    }
                    .qr-card img {
                        border: 8px solid white;
                        box-shadow: var(--pico-box-shadow);
                    }
                    #qr-image-container:empty {
                        display: none;
                    }
                    
                    .text-siaga-1 { color: #d32f2f; font-weight: bold; }
                    .text-siaga-2 { color: #f57c00; font-weight: bold; }
                    .text-siaga-3 { color: #b7950b; font-weight: bold; }
                    .text-siaga-4 { color: #388e3c; font-weight: bold; }
                    
                    select[multiple] {
                        height: 150px;
                        font-size: 0.8rem;
                    }
                    .monitoring-info {
                        display: flex;
                        gap: 0.75rem;
                        flex-wrap: wrap;
                        margin-bottom: 0.5rem;
                        font-size: 0.7rem;
                        text-transform: uppercase;
                        opacity: 0.8;
                    }
                    .monitoring-info span {
                        display: flex;
                        align-items: center;
                        white-space: nowrap;
                    }
                    article {
                        padding: var(--pico-spacing) !important;
                    }
                    article > header {
                        margin-bottom: calc(var(--pico-spacing) * 0.5) !important;
                        padding: 0 !important;
                        background: transparent !important;
                        border: none !important;
                    }
                    .dest-summary {
                        font-size: 0.8rem;
                        margin-bottom: 0.5rem;
                        color: var(--pico-muted-color);
                    }
                    details summary {
                        font-size: 0.8rem;
                        margin-bottom: 0;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    details summary::-webkit-details-marker {
                        display: none;
                    }
                    details summary::after {
                        content: '✎';
                        font-size: 0.9rem;
                        opacity: 0.6;
                    }
                    details[open] summary::after {
                        content: '✕';
                    }
                    .search-box {
                        margin-bottom: 0.5rem !important;
                        font-size: 0.8rem !important;
                    }
                    .wa-actions {
                        display: flex;
                        gap: 0.25rem;
                    }
                `}</style>
                <script dangerouslySetInnerHTML={{
                    __html: `
                    let serverContacts = {};
                    let serverSelfId = null;
                    let lastServerTargetJids = [];

                    async function sendTestMessage(btn) {
                        const originalText = btn.innerText;
                        btn.innerText = 'Sending...';
                        btn.disabled = true;
                        try {
                            const res = await fetch('/test-send', { method: 'POST' });
                            const data = await res.json();
                            alert(data.message);
                        } catch (e) {
                            alert('Failed to connect to server');
                        } finally {
                            btn.innerText = originalText;
                            btn.disabled = false;
                        }
                    }

                    async function waAction(action) {
                        try {
                            await fetch('/' + action, { method: 'POST' });
                        } catch (e) {
                            alert('Failed to execute ' + action);
                        }
                    }

                    async function resetContacts(btn) {
                        if(!confirm('Clear local contacts and force fresh sync?')) return;
                        const originalText = btn.innerText;
                        btn.innerText = 'Resetting...';
                        try {
                            await fetch('/reset-contacts', { method: 'POST' });
                            await fetch('/reconnect', { method: 'POST' });
                        } catch (e) {
                            alert('Failed to reset');
                        } finally {
                            btn.innerText = originalText;
                        }
                    }

                    function updateLocalSummary() {
                        const select = document.getElementById('jid_select');
                        const manual = document.getElementById('jid_manual');
                        const summary = document.getElementById('dest-list-summary');
                        const countBadge = document.getElementById('dest-count-badge');
                        
                        const selectedOptions = Array.from(select.selectedOptions).map(opt => opt.value);
                        const manualJids = manual.value.split(',').map(j => j.trim()).filter(j => j.length > 0);
                        const allSelected = [...new Set([...selectedOptions, ...manualJids])];
                        
                        const names = allSelected.map(jid => {
                            if (jid === serverSelfId) return "Me (Self)";
                            return serverContacts[jid] || jid.split('@')[0];
                        });
                        
                        summary.innerText = names.join(', ') || 'None';
                        countBadge.innerText = allSelected.length;
                    }

                    function syncFromServer() {
                        renderContacts(serverContacts, serverSelfId, lastServerTargetJids);
                        updateLocalSummary();
                    }

                    function filterDestinations(query) {
                        const q = query.toLowerCase();
                        const select = document.getElementById('jid_select');
                        const groups = select.getElementsByTagName('optgroup');
                        const options = select.getElementsByTagName('option');

                        for (const opt of options) {
                            const text = opt.innerText.toLowerCase();
                            const val = opt.value.toLowerCase();
                            if (text.includes(q) || val.includes(q)) {
                                opt.style.display = '';
                            } else {
                                opt.style.display = 'none';
                            }
                        }

                        for (const group of groups) {
                            const opts = group.getElementsByTagName('option');
                            let hasVisible = false;
                            for (const o of opts) {
                                if (o.style.display !== 'none') {
                                    hasVisible = true;
                                    break;
                                }
                            }
                            group.style.display = hasVisible ? '' : 'none';
                        }
                    }

                    function renderContacts(contacts, selfId, targetJids, currentSelection = []) {
                        const select = document.getElementById('jid_select');
                        if(!select) return;

                        const entries = Object.entries(contacts).sort((a, b) => a[1].localeCompare(b[1]));
                        const self = entries.filter(([id]) => id === selfId);
                        const groups = entries.filter(([id]) => id.includes('@g.us'));
                        const individuals = entries.filter(([id, name]) => {
                            if (id === selfId) return false;
                            if (id.includes('@g.us')) return false;
                            const isSelectedByServer = targetJids.includes(id);
                            const isSelectedByUser = currentSelection.includes(id);
                            const hasRealName = /[a-zA-Z]/.test(name);
                            return isSelectedByServer || isSelectedByUser || hasRealName;
                        });

                        let html = '';
                        if (self.length > 0) {
                            html += '<optgroup label="Account">';
                            self.forEach(([id, name]) => {
                                const sel = currentSelection.includes(id) || (currentSelection.length === 0 && targetJids.includes(id)) ? ' selected' : '';
                                html += '<option value="' + id + '"' + sel + '>Me (Self)</option>';
                            });
                            html += '</optgroup>';
                        }
                        
                        html += '<optgroup label="Groups">';
                        groups.forEach(([id, name]) => {
                            const sel = currentSelection.includes(id) || (currentSelection.length === 0 && targetJids.includes(id)) ? ' selected' : '';
                            html += '<option value="' + id + '"' + sel + '>' + name + '</option>';
                        });
                        html += '</optgroup>';

                        html += '<optgroup label="Individuals">';
                        individuals.forEach(([id, name]) => {
                            const sel = currentSelection.includes(id) || (currentSelection.length === 0 && targetJids.includes(id)) ? ' selected' : '';
                            html += '<option value="' + id + '"' + sel + '>' + name + '</option>';
                        });
                        html += '</optgroup>';

                        select.innerHTML = html;
                    }

                    const eventSource = new EventSource('/sse');
                    
                    eventSource.addEventListener('wa-update', (e) => {
                        const data = JSON.parse(e.data);
                        const statusEl = document.getElementById('wa-status-text');
                        const qrContainer = document.getElementById('qr-image-container');
                        const actionsContainer = document.getElementById('wa-actions-container');
                        
                        let actionsHtml = '';
                        if (data.status === 'open') {
                            statusEl.innerHTML = 'Status: <ins>Connected ✅</ins>';
                            qrContainer.innerHTML = '';
                            document.getElementById('btn-test-send').disabled = false;
                            actionsHtml = '<button class="outline secondary" style="width: auto; padding: 0.1rem 0.4rem; font-size: 0.65rem; margin: 0;" onclick="waAction(\\'disconnect\\')">Disconnect</button>';
                             actionsHtml += '<button class="outline secondary" style="width: auto; padding: 0.1rem 0.4rem; font-size: 0.65rem; margin: 0;" onclick="waAction(\\'rescan\\')">Rescan</button>';
                        } else if (data.status === 'qr') {
                            statusEl.innerHTML = 'Status: <mark>Scan Required 📱</mark>';
                            if (data.qr) {
                                qrContainer.innerHTML = '<div class="qr-card"><img src="' + data.qr + '" alt="WA QR Code" /><small style="margin-top: 0.5rem;">Link device in WhatsApp</small></div>';
                            }
                            document.getElementById('btn-test-send').disabled = true;
                            actionsHtml = '<button class="outline secondary" style="width: auto; padding: 0.1rem 0.4rem; font-size: 0.65rem; margin: 0;" onclick="waAction(\\'reconnect\\')">Reset</button>';
                        } else if (data.status === 'disconnected') {
                            statusEl.innerHTML = 'Status: <del>Disconnected ❌</del>';
                            qrContainer.innerHTML = '';
                            document.getElementById('btn-test-send').disabled = true;
                            actionsHtml = '<button class="outline secondary" style="width: auto; padding: 0.1rem 0.4rem; font-size: 0.65rem; margin: 0;" onclick="waAction(\\'reconnect\\')">Connect</button>';
                             actionsHtml += '<button class="outline secondary" style="width: auto; padding: 0.1rem 0.4rem; font-size: 0.65rem; margin: 0;" onclick="waAction(\\'rescan\\')">Rescan</button>';
                        } else {
                            statusEl.innerHTML = 'Status: <code>' + data.status + '...</code>';
                            qrContainer.innerHTML = '';
                            document.getElementById('btn-test-send').disabled = true;
                        }
                        actionsContainer.innerHTML = actionsHtml;
                    });

                    eventSource.addEventListener('station-update', (e) => {
                        const payload = JSON.parse(e.data);
                        const bannerContainer = document.getElementById('alarm-banner-container');
                        if (payload.isAlarmActive) {
                            bannerContainer.innerHTML = '<article style="border: 2px solid #d32f2f; background: #fff5f5; margin-bottom: 1rem; padding: 0.75rem !important;"><h4 style="color: #d32f2f; margin: 0; font-size: 1rem;">🚨 CRITICAL ALARM ACTIVE</h4></article>';
                        } else {
                            bannerContainer.innerHTML = '';
                        }

                        const tbody = document.getElementById('station-table-body');
                        if (payload.data && payload.data.length > 0) {
                            tbody.innerHTML = payload.data.map(p => {
                                const status = payload.lastStatus[p.kode_stasiun] || 4;
                                const timeStr = p.tanggal ? p.tanggal.split('T')[1]?.substring(0, 5) || '--:--' : '--:--';
                                return '<tr>' +
                                    '<td><strong>' + p.nama_pintu_air + '</strong></td>' +
                                    '<td><code>' + p.tinggi_air + ' cm</code></td>' +
                                    '<td class="text-siaga-' + status + '">S' + status + '</td>' +
                                    '<td><small>' + timeStr + '</small></td>' +
                                '</tr>';
                            }).join('');
                        }
                    });

                    eventSource.addEventListener('contacts-update', (e) => {
                        const payload = JSON.parse(e.data);
                        serverContacts = payload.contacts;
                        serverSelfId = payload.selfId;
                        lastServerTargetJids = payload.targetJids;
                        
                        const select = document.getElementById('jid_select');
                        if(!select) return;
                        
                        const currentUserSelection = Array.from(select.selectedOptions).map(opt => opt.value);
                        const isEditing = document.querySelector('details').open;

                        if (!isEditing) {
                            const selectedNames = payload.targetJids.map(jid => {
                                if(jid === serverSelfId) return "Me (Self)";
                                return payload.contacts[jid] || jid.split('@')[0];
                            }).join(', ');
                            document.getElementById('dest-list-summary').innerText = selectedNames || 'None';
                            document.getElementById('dest-count-badge').innerText = payload.targetJids.length;
                            renderContacts(payload.contacts, payload.selfId, payload.targetJids);
                        } else {
                            // If user is currently editing, just update the underlying data but don't re-render select
                            // to avoid losing user's unsaved changes.
                        }
                    });
                `}} />
            </head>
            <body>
                <header class="container" style="padding: 1rem 0 0.5rem 0;">
                    <nav>
                        <ul><li><strong>🌊 Bunjir Alarm</strong></li></ul>
                        <ul>
                            <li><a href="/stop" class="outline contrast" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;" onclick="event.preventDefault(); fetch('/stop').then(() => location.reload())">Reset Alarm</a></li>
                        </ul>
                    </nav>
                </header>

                <main class="container">
                    {children}
                </main>

                <footer class="container" style="padding: 1rem 0; text-align: center; border-top: 1px solid var(--pico-muted-border-color); margin-top: 1rem;">
                    <small>Monitoring Station 32 & 25</small>
                </footer>
            </body>
        </html>
    );
});

interface DashboardProps {
    waStatus: string;
    qr: string | null;
    targetJids: string[];
    data: PintuAirData[];
    lastStatus: Record<string, number>;
    isAlarmActive: boolean;
    contacts: Record<string, string>;
    selfId: string | null;
}

export const Dashboard = ({ waStatus, qr, targetJids, data, lastStatus, isAlarmActive, contacts, selfId }: DashboardProps) => {
    const contactEntries = Object.entries(contacts).sort((a, b) => a[1].localeCompare(b[1]));
    const self = contactEntries.filter(([id]) => id === selfId);
    const groups = contactEntries.filter(([id]) => id.includes('@g.us'));
    const individuals = contactEntries.filter(([id, name]) => {
        if (id === selfId) return false;
        if (id.includes('@g.us')) return false;
        const isSelected = targetJids.includes(id);
        const hasRealName = /[a-zA-Z]/.test(name);
        return isSelected || hasRealName;
    });

    const selectedNames = targetJids.map(jid => {
        if (jid === selfId) return "Me (Self)";
        return contacts[jid] || jid.split('@')[0];
    }).join(', ');

    return (
        <>
            <div id="alarm-banner-container">
                {isAlarmActive && (
                    <article style="border: 2px solid #d32f2f; background: #fff5f5; margin-bottom: 1rem; padding: 0.75rem !important;">
                        <h4 style="color: #d32f2f; margin: 0; font-size: 1rem;">🚨 CRITICAL ALARM ACTIVE</h4>
                    </article>
                )}
            </div>

            <div class="grid">
                {/* WhatsApp Connection Card */}
                <article>
                    <header><strong>WhatsApp Bridge</strong></header>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-size: 0.85rem;">
                        <div id="wa-status-text">
                            Status:
                            {waStatus === 'open' ? <ins>Connected ✅</ins> : waStatus === 'qr' ? <mark>Scan Required 📱</mark> : waStatus === 'disconnected' ? <del>Disconnected ❌</del> : <code>{waStatus}...</code>}
                        </div>
                        <div class="wa-actions" id="wa-actions-container">
                            {waStatus === 'open' ? (
                                <>
                                    <button class="outline secondary" style="width: auto; padding: 0.1rem 0.4rem; font-size: 0.65rem; margin: 0;" onclick="waAction('disconnect')">Disconnect</button>
                                    <button class="outline secondary" style="width: auto; padding: 0.1rem 0.4rem; font-size: 0.65rem; margin: 0;" onclick="waAction('rescan')">Rescan</button>
                                </>
                            ) : (waStatus === 'qr' || waStatus === 'disconnected') ? (
                                <>
                                    <button class="outline secondary" style="width: auto; padding: 0.1rem 0.4rem; font-size: 0.65rem; margin: 0;" onclick="waAction('reconnect')">{waStatus === 'qr' ? 'Reset' : 'Connect'}</button>
                                    <button class="outline secondary" style="width: auto; padding: 0.1rem 0.4rem; font-size: 0.65rem; margin: 0;" onclick="waAction('rescan')">Rescan</button>
                                </>
                            ) : null}
                        </div>
                    </div>

                    <div style="text-align: right; margin-bottom: 0.5rem;">
                        <button
                            id="btn-test-send"
                            class="outline secondary"
                            style="width: auto; padding: 0.1rem 0.4rem; font-size: 0.65rem; margin: 0;"
                            onclick="sendTestMessage(this)"
                            disabled={waStatus !== 'open'}
                        >
                            Test Send
                        </button>
                    </div>

                    <div id="qr-image-container">
                        {waStatus === 'qr' && qr && (
                            <div class="qr-card">
                                <img src={qr} alt="WA QR Code" style="max-width: 180px;" />
                            </div>
                        )}
                    </div>

                    <div class="dest-summary">
                        <strong>Destinations (<span id="dest-count-badge">{targetJids.length}</span>):</strong><br />
                        <span id="dest-list-summary" style="font-size: 0.75rem;">{selectedNames || 'None'}</span>
                    </div>

                    <details>
                        <summary>Edit Destinations</summary>
                        <form action="/set-target" method="post" style="margin-top: 0.5rem;">
                            <fieldset style="margin-bottom: 0.5rem;">
                                <div style="display: flex; gap: 0.25rem;">
                                    <input
                                        type="search"
                                        name="search"
                                        class="search-box"
                                        placeholder="Search contacts..."
                                        aria-label="Search"
                                        style="flex: 1;"
                                        oninput="filterDestinations(this.value)"
                                    />
                                    <button type="button" class="outline secondary" style="width: auto; padding: 0 0.5rem; height: auto; margin-bottom: 0.5rem; font-size: 0.7rem;" onclick="syncFromServer()">Sync UI</button>
                                    <button type="button" class="outline secondary" style="width: auto; padding: 0 0.5rem; height: auto; margin-bottom: 0.5rem; font-size: 0.7rem;" onclick="resetContacts(this)">Reset DB</button>
                                </div>
                                <select id="jid_select" name="jid_select" multiple onchange="updateLocalSummary()">
                                    {self.length > 0 && (
                                        <optgroup label="Account">
                                            {self.map(([id, name]) => <option value={id} selected={targetJids.includes(id)}>Me (Self)</option>)}
                                        </optgroup>
                                    )}
                                    <optgroup label="Groups">
                                        {groups.map(([id, name]) => <option value={id} selected={targetJids.includes(id)}>{name}</option>)}
                                    </optgroup>
                                    <optgroup label="Individuals">
                                        {individuals.map(([id, name]) => <option value={id} selected={targetJids.includes(id)}>{name}</option>)}
                                    </optgroup>
                                </select>
                                <textarea
                                    id="jid_manual" name="jid_manual" rows={1}
                                    style={{ fontSize: '0.7rem', padding: '0.3rem', marginTop: '0.5rem' }}
                                    placeholder="Manual JIDs..."
                                    oninput="updateLocalSummary()"
                                >{targetJids.filter(j => !contacts[j] && j !== selfId).join(', ')}</textarea>
                            </fieldset>
                            <button type="submit" class="secondary" style="font-size: 0.75rem; padding: 0.4rem;">Update</button>
                        </form>
                    </details>
                </article>

                {/* Live Station Data Card */}
                <article>
                    <header><strong>Live Station Data</strong></header>

                    <div class="monitoring-info">
                        <span><span class="status-dot bg-siaga-1"></span> S1</span>
                        <span><span class="status-dot bg-siaga-2"></span> S2</span>
                        <span><span class="status-dot bg-siaga-3"></span> S3</span>
                        <span><span class="status-dot bg-siaga-4"></span> S4</span>
                    </div>

                    <div class="overflow-auto">
                        <table class="striped" style="font-size: 0.8rem; margin-bottom: 0;">
                            <thead>
                                <tr>
                                    <th>Station</th>
                                    <th>TMA</th>
                                    <th>Status</th>
                                    <th>Time</th>
                                </tr>
                            </thead>
                            <tbody id="station-table-body">
                                {data.map((p) => {
                                    const status = lastStatus[p.kode_stasiun] || 4;
                                    const timeStr = p.tanggal ? p.tanggal.split('T')[1]?.substring(0, 5) || '--:--' : '--:--';
                                    return (
                                        <tr>
                                            <td><strong>{p.nama_pintu_air}</strong></td>
                                            <td><code>{p.tinggi_air} cm</code></td>
                                            <td class={`text-siaga-${status}`}>S{status}</td>
                                            <td><small>{timeStr}</small></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div style="text-align: right; margin-top: 0.5rem;">
                        <small style="font-size: 0.65rem; color: var(--pico-muted-color);">Auto-checked every 90s</small>
                    </div>
                </article>
            </div>
            <script dangerouslySetInnerHTML={{
                __html: `
                // Initialize server data from props
                serverContacts = ${JSON.stringify(contacts)};
                serverSelfId = ${JSON.stringify(selfId)};
                lastServerTargetJids = ${JSON.stringify(targetJids)};
            `}} />
        </>
    );
};
