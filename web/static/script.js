// ---------------------------------------------------------------------
// LAYOUT BUILDER (Components V2): several independent cards (each its own
// Container: own accent color, own ordered text/image blocks), all sent
// together as ONE Discord message. No lines between cards, just spacing.


// ---------------------------------------------------------------------


// A custom server emoji is pasted as <:name:id>, which is Discord's syntax and
// means nothing to a browser. Its picture does have a URL though, so the field
// shows it — otherwise there is no way to tell a correct paste from a typo
// until the bot posts something.
function previewCurrencySymbol() {
    const field = document.getElementById('set_currency_symbol');
    const preview = document.getElementById('currencySymbolPreview');
    if (!field || !preview) return;

    const custom = /^<(a?):([A-Za-z0-9_]+):(\d+)>$/.exec(field.value.trim());
    if (!custom) {
        preview.classList.add('hidden');
        preview.removeAttribute('src');
        return;
    }

    const [, animated, name, id] = custom;
    preview.src = `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=32`;
    preview.alt = name;
    preview.classList.remove('hidden');
}

// Save settings via API
async function saveSettings(event, category) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);

    const statusMsg = document.getElementById('settingsStatusMsg');

    const settingsPayload = {
        category: category,
        settings: {}
    };

    formData.forEach((value, key) => {
        settingsPayload.settings[key] = value;
    });

    try {
        const res = await fetch('/api/save-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settingsPayload)
        });

        const data = await res.json();

        if (res.ok) {
            statusMsg.textContent = `✅ ${data.message || 'The settings have been successfully saved'}`;
            statusMsg.className = 'text-sm font-semibold p-3 rounded bg-[#2b2d31] border border-green-500/50 text-green-400 text-center';
        } else {
            statusMsg.textContent = `❌ ${data.detail || 'Error saving'}`;
            statusMsg.className = 'text-sm font-semibold p-3 rounded bg-[#2b2d31] border border-red-500/50 text-red-400 text-center';
        }
    } catch (err) {
        statusMsg.textContent = '❌ Error connecting to the server';
        statusMsg.className = 'text-sm font-semibold p-3 rounded bg-[#2b2d31] border border-red-500/50 text-red-400 text-center';
    }

    statusMsg.classList.remove('hidden');
    setTimeout(() => {
        statusMsg.classList.add('hidden');
    }, 4000);
}

// ---------------------------------------------------------------------

// Loading settings from the database
async function loadSystemSettings() {
    try {
        const response = await fetch('/api/settings/system');
        if (!response.ok) throw new Error("Unable to load settings");

        const data = await response.json();

        const tokenInput = document.getElementById('set_discord_bot_token');
        const clientSecretInput = document.getElementById('set_discord_client_secret');

        if (tokenInput) tokenInput.value = data.discord_bot_token || '';
        if (clientSecretInput) clientSecretInput.value = data.discord_client_secret || '';

    } catch (error) {
        console.error("Error loading settings:", error);
    }
}

// ---------------------------------------------------------------------

// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// DASHBOARD STATS (uptime / CPU / RAM)

function formatUptime(totalSeconds) {
    const s = Math.floor(totalSeconds);
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;

    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours || days) parts.push(`${hours}h`);
    if (minutes || hours || days) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}

async function refreshStats() {
    try {
        const res = await fetch('/api/stats');
        if (!res.ok) throw new Error('Failed to fetch stats');
        const data = await res.json();

        const cpuValue = document.getElementById('statCpuValue');
        const cpuBar = document.getElementById('statCpuBar');
        if (cpuValue && cpuBar) {
            cpuValue.textContent = `${data.cpu_percent.toFixed(1)}%`;
            cpuBar.style.width = `${Math.min(data.cpu_percent, 100)}%`;
        }

        const ramValue = document.getElementById('statRamValue');
        const ramBar = document.getElementById('statRamBar');
        if (ramValue && ramBar) {
            ramValue.textContent = `${data.memory_used_mb} / ${data.memory_total_mb} MB (${data.memory_percent.toFixed(1)}%)`;
            ramBar.style.width = `${Math.min(data.memory_percent, 100)}%`;
        }

        const statusDot = document.getElementById('statStatusDot');
        const statusText = document.getElementById('statStatus');
        const uptimeEl = document.getElementById('statUptime');
        const pluginsEl = document.getElementById('statPlugins');
        const latencyEl = document.getElementById('statLatency');

        if (data.bot) {
            const online = data.bot.connected;
            if (statusDot) statusDot.className = `w-2.5 h-2.5 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`;
            if (statusText) statusText.textContent = online ? 'Online' : 'Offline';
            if (uptimeEl) uptimeEl.textContent = formatUptime(data.bot.uptime_seconds);
            if (pluginsEl) pluginsEl.textContent = data.bot.plugins_running;
            if (latencyEl) latencyEl.textContent = data.bot.latency_ms !== null ? `${data.bot.latency_ms} ms` : '—';
        } else {
            if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
            if (statusText) statusText.textContent = 'Unreachable';
            if (uptimeEl) uptimeEl.textContent = '—';
            if (pluginsEl) pluginsEl.textContent = '—';
            if (latencyEl) latencyEl.textContent = '—';
        }
    } catch (err) {
        console.error('Error fetching stats:', err);
    }
}

function initStats() {
    if (!document.getElementById('statCpuValue')) return;
    refreshStats();
    setInterval(refreshStats, 3000);
}

// ---------------------------------------------------------------------
// LIVE LOGS (WebSocket; auto-follows the tail unless the user scrolled up)

const LOG_LEVEL_COLORS = {
    ERROR: 'text-red-400',
    WARNING: 'text-yellow-400',
    INFO: 'text-gray-300',
};

function appendLogLine(panel, line) {
    const div = document.createElement('div');

    let colorClass = 'text-gray-300';
    for (const [level, cls] of Object.entries(LOG_LEVEL_COLORS)) {
        if (line.includes(`[${level}]`)) {
            colorClass = cls;
            break;
        }
    }
    div.className = colorClass;
    div.textContent = line;
    panel.appendChild(div);

    // Cap the number of rendered lines so the DOM doesn't grow forever.
    while (panel.children.length > 500) {
        panel.removeChild(panel.firstChild);
    }
}

function connectLogsWebSocket() {
    const panel = document.getElementById('logsPanel');
    const dot = document.getElementById('logsConnDot');
    const label = document.getElementById('logsConnLabel');
    if (!panel) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws/logs`);

    ws.onopen = () => {
        if (dot) dot.className = 'w-2 h-2 rounded-full bg-green-500';
        if (label) label.textContent = 'Live';
    };

    ws.onmessage = (event) => {
        // Near-bottom scroll means "follow the tail"; otherwise leave the user's scroll position alone.
        const wasNearBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 40;

        event.data.split('\n').forEach(line => {
            if (line) appendLogLine(panel, line);
        });

        if (wasNearBottom) {
            panel.scrollTop = panel.scrollHeight;
        }
    };

    ws.onclose = () => {
        if (dot) dot.className = 'w-2 h-2 rounded-full bg-red-500';
        if (label) label.textContent = 'Disconnected — retrying...';
        setTimeout(connectLogsWebSocket, 3000);
    };

    ws.onerror = () => {
        ws.close();
    };
}

// ---------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    loadSystemSettings();
    previewCurrencySymbol();
    initStats();
    connectLogsWebSocket();
    loadPluginPages();
});

async function saveSystemSettings(event) {
    event.preventDefault();

    const confirmed = confirm(
        "Are you sure you want to save the new keys?\n\n" +
        "If you change your Discord token, the bot will restart. Please wait a few seconds after saving."
    );

    if (!confirmed) return;

    const formData = new FormData(event.target);

    try {
        const response = await fetch('/api/settings/system', {
            method: 'POST',
            body: formData
        });

        const res = await response.json();

        if (res.status === 'restarting') {
            alert('Keys saved. The bot is restarting... The page will refresh in 5 seconds.');
            setTimeout(() => window.location.reload(), 5000);
        } else {
            alert('The keys have been successfully saved.');
        }
    } catch (e) {
        alert('A save error occurred, or the bot is restarting.');
    }
}

// Switch sub-categories inside Settings tab
function switchSettingsCategory(catName) {
    document.querySelectorAll('.settings-form').forEach(form => {
        form.classList.add('hidden');
    });

    document.querySelectorAll('.settings-cat-btn').forEach(btn => {
        btn.className = 'settings-cat-btn px-3 py-1.5 rounded text-xs font-semibold transition text-gray-400 hover:bg-[#35373c]';
    });

    const activeForm = document.getElementById(`form-settings-${catName}`);
    if (activeForm) {
        activeForm.classList.remove('hidden');
    }

    if (catName === 'AI') loadProviders();

    const activeBtn = document.getElementById(`cat-btn-${catName}`);
    if (activeBtn) {
        activeBtn.className = 'settings-cat-btn px-3 py-1.5 rounded text-xs font-semibold transition bg-indigo-600 text-white';
    }
}

// Tab Switcher
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.add('hidden');
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.className = 'tab-btn px-4 py-2 rounded text-sm font-semibold transition text-gray-400 hover:bg-[#35373c]';
    });

    const activeTab = document.getElementById(`tab-${tabName}`);
    if (activeTab) {
        activeTab.classList.remove('hidden');
    }

    const activeBtn = document.getElementById(`btn-${tabName}`);
    if (activeBtn) {
        activeBtn.className = 'tab-btn px-4 py-2 rounded text-sm font-semibold transition bg-indigo-600 text-white';
    }

    if (tabName === 'plugins') {
        loadPlugins();
    }
    if (tabName.startsWith('plugin-')) {
        openPluginPage(tabName);
    }
}

// ---------------------------------------------------------------------
// PLUGINS
//
// Nothing here knows about any particular plugin: each one declares its
// settings in its own Python code, the bot serves that schema, and the cards
// and forms below are generated from it.

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// One form row, rendered according to the field's declared type.
function renderPluginField(pluginId, field, value) {
    const inputId = `plg_${pluginId}_${field.key}`;
    const base = 'w-full bg-[#1e1f22] border border-[#3f4147] rounded p-2 text-white text-sm focus:outline-none focus:border-indigo-500 transition';
    const label = `<label class="block text-xs font-bold text-gray-400 uppercase mb-1">${escapeHtml(field.label)}</label>`;
    const hint = field.description
        ? `<p class="text-[11px] text-gray-400 mt-1">${escapeHtml(field.description)}</p>`
        : '';

    let input;
    switch (field.type) {
        case 'bool':
            return `
                <div class="flex items-center justify-between bg-[#1e1f22] p-3 rounded-lg border border-[#3f4147]">
                    <div>
                        <span class="block text-xs font-bold text-gray-300 uppercase">${escapeHtml(field.label)}</span>
                        ${field.description ? `<span class="text-[10px] text-gray-400">${escapeHtml(field.description)}</span>` : ''}
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" id="${inputId}" data-key="${escapeHtml(field.key)}" data-type="bool"
                            ${value === true || value === 'true' ? 'checked' : ''} class="sr-only peer">
                        <div class="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                </div>`;

        case 'select':
            input = `<select id="${inputId}" data-key="${escapeHtml(field.key)}" data-type="select" class="${base}">
                ${field.choices.map(c =>
                    `<option value="${escapeHtml(c.value)}" ${String(value) === c.value ? 'selected' : ''}>${escapeHtml(c.label)}</option>`
                ).join('')}
            </select>`;
            break;

        case 'text':
            input = `<textarea id="${inputId}" data-key="${escapeHtml(field.key)}" data-type="text" rows="4" class="${base}">${escapeHtml(value)}</textarea>`;
            break;

        case 'secret':
            // Same reveal-on-hover treatment the other API key fields use.
            input = `<input type="password" id="${inputId}" data-key="${escapeHtml(field.key)}" data-type="secret"
                value="${escapeHtml(value)}" autocomplete="off"
                onmouseenter="this.type='text'" onmouseleave="this.type='password'"
                class="${base} font-mono">`;
            break;

        case 'slider':
            input = `<div class="flex items-center gap-3">
                <input type="range" id="${inputId}" data-key="${escapeHtml(field.key)}" data-type="slider"
                    min="${field.min}" max="${field.max}" step="${field.step ?? 0.1}" value="${escapeHtml(value)}"
                    oninput="document.getElementById('${inputId}_out').textContent = this.value"
                    class="flex-1 accent-indigo-600">
                <span id="${inputId}_out" class="text-xs text-gray-300 font-mono w-10 text-right">${escapeHtml(value)}</span>
            </div>`;
            break;

        case 'channel':
        case 'category':
        case 'role':
            input = guildPicker(inputId, field, value);
            break;

        case 'int':
        case 'float':
            input = `<input type="number" id="${inputId}" data-key="${escapeHtml(field.key)}" data-type="${field.type}"
                value="${escapeHtml(value)}" ${field.type === 'float' ? 'step="any"' : ''}
                ${field.min !== null && field.min !== undefined ? `min="${field.min}"` : ''}
                ${field.max !== null && field.max !== undefined ? `max="${field.max}"` : ''}
                class="${base} font-mono">`;
            break;

        default:
            input = `<input type="text" id="${inputId}" data-key="${escapeHtml(field.key)}" data-type="string"
                value="${escapeHtml(value)}" class="${base}">`;
    }

    return `<div>${label}${input}${hint}</div>`;
}


// The home guild's channels, categories and roles. Fetched once per page: the
// settings forms are rendered synchronously from strings, so this has to be in
// hand before they are built.
let guildOptions = null;

async function ensureGuildOptions() {
    if (guildOptions) return guildOptions;
    try {
        const res = await fetch('/api/guild/options');
        const data = await res.json();
        guildOptions = (res.ok && data.status === 'ok')
            ? data
            : { channels: [], categories: [], roles: [], unavailable: data.detail || data.message || 'unavailable' };
    } catch (e) {
        guildOptions = { channels: [], categories: [], roles: [], unavailable: 'Could not reach the bot.' };
    }
    return guildOptions;
}

// An id typed by hand is a chance to get it wrong and no way to notice. These
// fields become a list of what the guild actually has.
function guildPicker(inputId, field, value) {
    const base = 'w-full bg-[#1e1f22] border border-[#3f4147] rounded p-2 text-white text-sm focus:outline-none focus:border-indigo-500 transition';
    const current = String(value ?? '');
    const attrs = `id="${inputId}" data-key="${escapeHtml(field.key)}" data-type="${field.type}" class="${base}"`;

    // Before the list arrives, or when the bot cannot be reached, the field
    // stays an id box rather than becoming an empty dropdown that would save
    // nothing over whatever is already configured.
    if (!guildOptions || guildOptions.unavailable) {
        const why = guildOptions && guildOptions.unavailable ? guildOptions.unavailable : '';
        return `<input type="number" ${attrs.replace(`class="${base}"`, `class="${base} font-mono"`)}
                    value="${escapeHtml(current)}">
                ${why ? `<p class="text-[11px] text-amber-400 mt-1">Channel list unavailable (${escapeHtml(why)}) — enter the id.</p>` : ''}`;
    }

    const chosen = [];
    let body = '';

    if (field.type === 'role') {
        body = guildOptions.roles
            .map(r => `<option value="${r.id}" ${r.id === current ? (chosen.push(1), 'selected') : ''}>@${escapeHtml(r.name)}</option>`)
            .join('');
    } else if (field.type === 'category') {
        body = guildOptions.categories
            .map(c => `<option value="${c.id}" ${c.id === current ? (chosen.push(1), 'selected') : ''}>${escapeHtml(c.name)}</option>`)
            .join('');
    } else {
        // Channels read far better grouped the way Discord shows them.
        const groups = guildOptions.categories.map(cat => [cat.name, guildOptions.channels.filter(ch => ch.category === cat.id)]);
        const loose = guildOptions.channels.filter(ch => !ch.category);
        if (loose.length) groups.unshift(['No category', loose]);

        body = groups
            .filter(([, list]) => list.length)
            .map(([name, list]) => `<optgroup label="${escapeHtml(name)}">` + list
                .map(ch => `<option value="${ch.id}" ${ch.id === current ? (chosen.push(1), 'selected') : ''}>` +
                           `${ch.kind === 'voice' ? '🔊 ' : '# '}${escapeHtml(ch.name)}</option>`)
                .join('') + '</optgroup>')
            .join('');
    }

    // A channel that has since been deleted must stay visible and selected,
    // rather than the form quietly reassigning the setting to whatever is first.
    const stale = current && current !== '0' && !chosen.length
        ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} — no longer in the server</option>`
        : '';

    return `<select ${attrs}>
        <option value="0" ${!current || current === '0' ? 'selected' : ''}>— none —</option>
        ${stale}${body}
    </select>`;
}

// Which cards are open. Kept across re-renders so toggling or reloading a
// plugin doesn't collapse everything the user had expanded.
const expandedPlugins = new Set();

function togglePluginCard(pluginId) {
    const body = document.getElementById(`plugin-body-${pluginId}`);
    if (!body) return;

    const opening = body.classList.contains('hidden');
    body.classList.toggle('hidden', !opening);
    if (opening) {
        expandedPlugins.add(pluginId);
    } else {
        expandedPlugins.delete(pluginId);
    }

    const chevron = document.getElementById(`plugin-chevron-${pluginId}`);
    if (chevron) chevron.classList.toggle('rotate-90', opening);
}

function renderPluginCard(plugin) {
    const values = plugin.values || {};
    const statusText = plugin.running
        ? '<span class="text-[10px] text-green-400 font-semibold">● RUNNING</span>'
        : (plugin.enabled
            ? '<span class="text-[10px] text-red-400 font-semibold">● FAILED</span>'
            : '<span class="text-[10px] text-gray-500 font-semibold">● DISABLED</span>');

    // Shown outside the collapsible body: a plugin that failed to load should
    // say so without the user having to open it first.
    const error = plugin.error
        ? `<p class="text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2 font-mono mx-5 mb-4">${escapeHtml(plugin.error)}</p>`
        : '';

    // Settings are only readable while the plugin is running, since the schema
    // lives in the plugin's own code.
    const fields = (plugin.settings_schema || [])
        .map(f => renderPluginField(plugin.id, f, values[f.key]))
        .join('');

    const expandable = plugin.running && fields;
    const isOpen = expandable && expandedPlugins.has(plugin.id);

    const chevron = expandable
        ? `<span id="plugin-chevron-${plugin.id}"
               class="text-gray-500 text-xs mt-1.5 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}">▶</span>`
        : '<span class="w-2"></span>';

    // A plugin with nothing to configure shouldn't look clickable.
    const hint = plugin.running && !fields
        ? '<span class="text-[10px] text-gray-600">· no settings</span>'
        : '';

    const header = expandable
        ? `class="flex items-start justify-between gap-4 p-5 cursor-pointer hover:bg-[#313338] transition rounded-lg"
           onclick="togglePluginCard('${plugin.id}')"`
        : 'class="flex items-start justify-between gap-4 p-5"';

    const body = expandable
        ? `<div id="plugin-body-${plugin.id}" class="${isOpen ? '' : 'hidden'} px-5 pb-5 space-y-4 border-t border-[#3f4147] pt-4">
               ${fields}
               <button onclick="savePluginSettings('${plugin.id}')"
                   class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-2 rounded transition shadow-md text-sm">
                   💾 Save settings
               </button>
           </div>`
        : '';

    return `
    <div class="bg-[#2b2d31] rounded-lg border border-[#3f4147] shadow-lg">
        <div ${header}>
            <div class="flex items-start gap-3">
                ${chevron}
                <span class="text-2xl leading-none">${escapeHtml(plugin.icon)}</span>
                <div>
                    <h3 class="text-white font-bold flex items-center gap-2">
                        ${escapeHtml(plugin.name)}
                        <span class="text-[10px] text-gray-500 font-mono">v${escapeHtml(plugin.version)}</span>
                        ${statusText}
                    </h3>
                    <p class="text-xs text-gray-400 mt-1">${escapeHtml(plugin.description)}</p>
                    <p class="text-[10px] text-gray-500 mt-1 font-mono">
                        ${escapeHtml(plugin.id)}${plugin.author ? ' · ' + escapeHtml(plugin.author) : ''} · ${escapeHtml(plugin.installed_from)} ${hint}
                    </p>
                </div>
            </div>
            <!-- The controls sit inside the clickable header, so their clicks
                 must not also open or close the card. -->
            <div class="flex items-center gap-3 shrink-0" onclick="event.stopPropagation()">
                ${plugin.installed_from !== 'local' ? `
                <button onclick="uninstallPlugin('${plugin.id}')" title="Remove this plugin's files"
                    class="bg-[#1e1f22] hover:bg-red-600/80 border border-[#3f4147] text-gray-300 hover:text-white px-3 py-1.5 rounded transition text-xs font-semibold">
                    🗑
                </button>` : ''}
                <button onclick="reloadPlugin('${plugin.id}')" title="Reload this plugin's code without restarting the bot"
                    class="bg-[#1e1f22] hover:bg-[#35373c] border border-[#3f4147] text-gray-300 px-3 py-1.5 rounded transition text-xs font-semibold">
                    ♻️ Reload
                </button>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" ${plugin.enabled ? 'checked' : ''}
                        onchange="togglePlugin('${plugin.id}', this.checked)" class="sr-only peer">
                    <div class="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
            </div>
        </div>
        ${error}
        ${body}
    </div>`;
}

async function loadPlugins() {
    const list = document.getElementById('pluginsList');
    if (!list) return;

    // The settings forms are built from strings in one pass, so the guild's
    // channels have to be in hand before that pass starts.
    await ensureGuildOptions();

    try {
        const res = await fetch('/api/plugins');
        const data = await res.json();

        if (!res.ok) {
            list.innerHTML = `<p class="text-xs text-red-400">${escapeHtml(data.detail || 'Could not reach the bot.')}</p>`;
            return;
        }

        const plugins = data.plugins || [];
        list.innerHTML = plugins.length
            ? plugins.map(renderPluginCard).join('')
            : '<p class="text-xs text-gray-400">No plugins installed yet.</p>';
    } catch (e) {
        list.innerHTML = '<p class="text-xs text-red-400">Error connecting to the server.</p>';
    }
}

async function rescanPlugins() {
    try {
        await fetch('/api/plugins/rescan', { method: 'POST' });
    } catch (e) {
        // loadPlugins() reports the failure to the user.
    }
    loadPlugins();
}

async function togglePlugin(pluginId, enabled) {
    try {
        const res = await fetch('/api/plugins/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plugin: pluginId, enabled })
        });
        if (!res.ok) {
            const data = await res.json();
            alert(`Failed to ${enabled ? 'enable' : 'disable'} ${pluginId}: ${data.detail || 'unknown error'}`);
        }
    } catch (e) {
        alert('Error connecting to the server.');
    }
    loadPlugins();
    loadPluginPages();
}

async function reloadPlugin(pluginId) {
    try {
        const res = await fetch('/api/plugins/reload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plugin: pluginId })
        });
        const data = await res.json();
        alert(res.ok ? `${pluginId} reloaded.` : `Reload failed: ${data.detail || 'unknown error'}`);
    } catch (e) {
        alert('Error connecting to the server.');
    }
    loadPlugins();
    loadPluginPages();
}

async function savePluginSettings(pluginId) {
    const values = {};
    document.querySelectorAll(`[id^="plg_${pluginId}_"]`).forEach(el => {
        const key = el.dataset.key;
        if (!key) return;
        values[key] = el.dataset.type === 'bool' ? el.checked : el.value;
    });

    try {
        const res = await fetch('/api/plugins/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plugin: pluginId, values })
        });
        const data = await res.json();
        alert(res.ok ? 'Settings saved.' : `Save failed: ${data.detail || 'unknown error'}`);
    } catch (e) {
        alert('Error connecting to the server.');
    }
}

// ---------------------------------------------------------------------
// PLUGIN BROWSER
//
// The bot cannot install anything itself: the plugins directory and the trust
// configuration are read-only in its container. Everything here goes through
// the bot to the broker, which is the only component allowed to write them.

function switchPluginView(view) {
    document.querySelectorAll('.plugin-view').forEach(pane => pane.classList.add('hidden'));
    document.querySelectorAll('.plugin-view-btn').forEach(btn => {
        btn.className = 'plugin-view-btn px-3 py-1.5 rounded text-xs font-semibold transition text-gray-400 hover:bg-[#35373c]';
    });

    const paneId = { installed: 'pluginInstalled', browse: 'pluginBrowse', sources: 'pluginSources' }[view];
    const pane = document.getElementById(paneId);
    if (pane) pane.classList.remove('hidden');

    const btn = document.getElementById(`plgview-btn-${view}`);
    if (btn) btn.className = 'plugin-view-btn px-3 py-1.5 rounded text-xs font-semibold transition bg-indigo-600 text-white';

    if (view === 'browse') loadCatalog();
    if (view === 'sources') loadPluginSources();
    if (view === 'installed') loadPlugins();
}

function trustBadge(trusted) {
    return trusted
        ? '<span class="text-[10px] text-green-400 font-semibold">✓ TRUSTED</span>'
        : '<span class="text-[10px] text-amber-400 font-semibold">⚠ UNTRUSTED</span>';
}

function renderCatalogEntry(entry) {
    const services = (entry.services || []).length
        ? `<span class="text-[10px] text-amber-400" title="This plugin runs a container of its own">📦 runs ${escapeHtml((entry.services || []).join(', '))}</span>`
        : '';

    const action = entry.installed
        ? `<button onclick="installPlugin('${entry.source}', '${entry.id}')"
               class="bg-[#1e1f22] hover:bg-[#35373c] border border-[#3f4147] text-gray-300 px-3 py-1.5 rounded transition text-xs font-semibold">
               ⬆ Reinstall
           </button>
           <button onclick="uninstallPlugin('${entry.id}')"
               class="bg-red-600/80 hover:bg-red-600 text-white px-3 py-1.5 rounded transition text-xs font-semibold">
               🗑 Uninstall
           </button>`
        : `<button onclick="installPlugin('${entry.source}', '${entry.id}')"
               class="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded transition text-xs font-bold">
               ⬇ Install
           </button>`;

    const installedNote = entry.installed
        ? `<span class="text-[10px] text-gray-500">installed v${escapeHtml(entry.installed_version || '?')}</span>`
        : '';

    return `
    <div class="bg-[#2b2d31] p-5 rounded-lg border border-[#3f4147] shadow-lg flex items-start justify-between gap-4">
        <div class="flex items-start gap-3">
            <span class="text-2xl leading-none">${escapeHtml(entry.icon || '🧩')}</span>
            <div>
                <h3 class="text-white font-bold flex items-center gap-2 flex-wrap">
                    ${escapeHtml(entry.name || entry.id)}
                    <span class="text-[10px] text-gray-500 font-mono">v${escapeHtml(entry.version || '?')}</span>
                    ${trustBadge(entry.trusted)}
                    ${installedNote}
                </h3>
                <p class="text-xs text-gray-400 mt-1">${escapeHtml(entry.description || '')}</p>
                <p class="text-[10px] text-gray-500 mt-1 font-mono">
                    ${escapeHtml(entry.id)}${entry.author ? ' · ' + escapeHtml(entry.author) : ''} · from ${escapeHtml(entry.source_label || entry.source)}
                    ${services}
                </p>
            </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">${action}</div>
    </div>`;
}

async function loadCatalog() {
    const list = document.getElementById('pluginCatalog');
    if (!list) return;
    list.innerHTML = '<p class="text-xs text-gray-400">Loading catalogue...</p>';

    try {
        const res = await fetch('/api/plugins/catalog');
        const data = await res.json();
        if (!res.ok) {
            list.innerHTML = `<p class="text-xs text-red-400">${escapeHtml(data.detail || 'Could not reach the broker.')}</p>`;
            return;
        }

        // A source that cannot be reached is reported rather than silently
        // dropped, so a typo in a repo name is visible.
        const errors = Object.entries(data.errors || {})
            .map(([name, message]) =>
                `<p class="text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2 font-mono">${escapeHtml(name)}: ${escapeHtml(message)}</p>`)
            .join('');

        const entries = (data.plugins || []).map(renderCatalogEntry).join('');
        list.innerHTML = errors + (entries || '<p class="text-xs text-gray-400">No plugins offered by the configured sources.</p>');
    } catch (e) {
        list.innerHTML = '<p class="text-xs text-red-400">Error connecting to the server.</p>';
    }
}

async function installPlugin(source, pluginId) {
    if (!confirm(`Install "${pluginId}" from "${source}"?\n\nThis runs someone else's code inside your bot.`)) return;

    try {
        const res = await fetch('/api/plugins/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source, plugin: pluginId })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(`Install failed: ${data.detail || 'unknown error'}`);
        } else if (data.error) {
            alert(`${pluginId} was installed but failed to load:\n\n${data.error}`);
        } else {
            alert(`${pluginId} installed${data.running ? ' and running' : ''}.`);
        }
    } catch (e) {
        alert('Error connecting to the server.');
    }
    loadCatalog();
    loadPluginPages();
}

async function uninstallPlugin(pluginId) {
    if (!confirm(`Uninstall "${pluginId}"?\n\nIts files and any containers it started are removed. Its saved settings are kept.`)) return;

    try {
        const res = await fetch('/api/plugins/uninstall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plugin: pluginId })
        });
        const data = await res.json();
        if (!res.ok) alert(`Uninstall failed: ${data.detail || 'unknown error'}`);
    } catch (e) {
        alert('Error connecting to the server.');
    }
    // Called from both the catalogue and the installed list, so refresh
    // whichever pane is actually on screen.
    if (!document.getElementById('pluginBrowse').classList.contains('hidden')) {
        loadCatalog();
    } else {
        loadPlugins();
    }
    loadPluginPages();
}

function renderSourceRow(source, installedCount) {
    return `
    <div class="bg-[#2b2d31] p-4 rounded-lg border border-[#3f4147] flex items-center justify-between gap-4">
        <div>
            <h4 class="text-white font-bold text-sm flex items-center gap-2">
                ${escapeHtml(source.label || source.name)} ${trustBadge(source.trusted)}
            </h4>
            <p class="text-[11px] text-gray-400 mt-1 font-mono">
                ${escapeHtml(source.repo)} · ${escapeHtml(source.branch)}
                ${installedCount ? `· ${installedCount} installed` : ''}
            </p>
        </div>
        <div class="flex items-center gap-3 shrink-0">
            <label class="flex items-center gap-2 cursor-pointer" title="Trusted sources may run sidecar containers">
                <span class="text-[10px] text-gray-400 uppercase font-bold">Trusted</span>
                <span class="relative inline-flex items-center">
                    <input type="checkbox" ${source.trusted ? 'checked' : ''}
                        onchange="setSourceTrust('${source.name}', this.checked)" class="sr-only peer">
                    <span class="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></span>
                </span>
            </label>
            <button onclick="removePluginSource('${source.name}')"
                class="bg-[#1e1f22] hover:bg-red-600/80 border border-[#3f4147] text-gray-300 hover:text-white px-3 py-1.5 rounded transition text-xs font-semibold">
                Remove
            </button>
        </div>
    </div>`;
}

async function loadPluginSources() {
    const list = document.getElementById('sourcesList');
    if (!list) return;

    try {
        const res = await fetch('/api/plugins/sources');
        const data = await res.json();
        if (!res.ok) {
            list.innerHTML = `<p class="text-xs text-red-400">${escapeHtml(data.detail || 'Could not reach the broker.')}</p>`;
            return;
        }

        const installed = data.installed || {};
        const counts = {};
        Object.values(installed).forEach(entry => {
            counts[entry.source] = (counts[entry.source] || 0) + 1;
        });

        const rows = (data.sources || []).map(s => renderSourceRow(s, counts[s.name] || 0)).join('');
        list.innerHTML = rows || '<p class="text-xs text-gray-400">No sources configured.</p>';
    } catch (e) {
        list.innerHTML = '<p class="text-xs text-red-400">Error connecting to the server.</p>';
    }
}

async function addPluginSource() {
    const name = document.getElementById('source-name').value.trim();
    const repo = document.getElementById('source-repo').value.trim();
    const branch = document.getElementById('source-branch').value.trim() || 'main';

    if (!name || !repo) {
        alert('A short name and an owner/repository are both required.');
        return;
    }

    try {
        const res = await fetch('/api/plugins/sources/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, repo, branch, label: name })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(`Could not add the source: ${data.detail || 'unknown error'}`);
        } else {
            document.getElementById('source-name').value = '';
            document.getElementById('source-repo').value = '';
        }
    } catch (e) {
        alert('Error connecting to the server.');
    }
    loadPluginSources();
}

async function setSourceTrust(name, trusted) {
    if (trusted && !confirm(
        `Mark "${name}" as trusted?\n\nPlugins from a trusted source are allowed to start containers of their own.`
    )) {
        loadPluginSources();
        return;
    }

    try {
        await fetch('/api/plugins/sources/trust', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, trusted })
        });
    } catch (e) {
        alert('Error connecting to the server.');
    }
    loadPluginSources();
}

async function removePluginSource(name) {
    if (!confirm(`Remove the source "${name}"?\n\nPlugins already installed from it stay, but stop being trusted.`)) return;

    try {
        await fetch('/api/plugins/sources/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, trusted: false })
        });
    } catch (e) {
        alert('Error connecting to the server.');
    }
    loadPluginSources();
}

// ---------------------------------------------------------------------
// PROVIDERS (AI)
//
// The broker holds these keys in a volume the bot container cannot see, and
// never returns their values — only whether each one is set. So this form is
// built from that metadata, and an untouched field means "leave as is".
//
// Only credentials live here. A plugin that can pick between backends declares
// that choice as its own setting instead — the translator's free-or-AI switch,
// for one.

const PROVIDER_SECTIONS = [
    {
        section: 'ai',
        title: 'AI chat',
        // One entry per provider: the key it needs, and where that key comes
        // from. Only the selected provider's field is shown -- three boxes when
        // two of them can never apply is just three chances to fill in the
        // wrong one.
        providers: [
            {
                id: 'gemini',
                modelKey: 'gemini_model',
                label: 'Google Gemini',
                key: 'gemini_api_key',
                keyLabel: 'Gemini API key',
                url: 'https://aistudio.google.com/apikey',
                site: 'Google AI Studio',
                steps: [
                    'Sign in with a Google account.',
                    'Open Google AI Studio and choose "Get API key".',
                    'Create a key in a new or existing project, then copy it.',
                ],
                note: 'Has a free tier, capped at a small number of requests per day.',
            },
            {
                id: 'deepseek',
                modelKey: 'deepseek_model',
                label: 'DeepSeek',
                key: 'deepseek_api_key',
                keyLabel: 'DeepSeek API key',
                url: 'https://platform.deepseek.com/api_keys',
                site: 'the DeepSeek platform',
                steps: [
                    'Create an account and sign in.',
                    'Open API keys and create one. It is shown once, so copy it now.',
                    'Top the balance up: requests fail without credit.',
                ],
                note: 'Paid only. There is no free tier.',
            },
            {
                id: 'chatgpt',
                modelKey: 'chatgpt_model',
                label: 'ChatGPT',
                key: 'chatgpt_api_key',
                keyLabel: 'OpenAI API key',
                url: 'https://platform.openai.com/api-keys',
                site: 'the OpenAI platform',
                steps: [
                    'Create an account and sign in.',
                    'Add a payment method under Billing.',
                    'Open API keys, create a secret key and copy it. It is shown once.',
                ],
                note: 'Paid only. An account without billing set up returns quota errors.',
            },
        ],
    },
];

// The last payload from /api/providers, so changing the dropdown can redraw the
// section without asking the broker again.
let providerState = {};

function providerGuide(provider) {
    const steps = provider.steps
        .map(step => `<li>${escapeHtml(step)}</li>`)
        .join('');

    return `
        <details class="mt-2 group">
            <summary class="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer select-none font-semibold">
                Where do I get an API key?
            </summary>
            <div class="mt-2 p-3 bg-[#1e1f22] border border-[#3f4147] rounded-lg space-y-2">
                <ol class="list-decimal list-inside space-y-1 text-[11px] text-gray-300">${steps}</ol>
                <p class="text-[11px] text-gray-400">${escapeHtml(provider.note)}</p>
                <a href="${escapeHtml(provider.url)}" target="_blank" rel="noopener noreferrer"
                   class="inline-block text-[11px] font-semibold text-indigo-400 hover:text-indigo-300">
                    Open ${escapeHtml(provider.site)} ↗
                </a>
            </div>
        </details>`;
}


// The list comes from the provider itself rather than being hardcoded here: a
// list written into the dashboard would be out of date within a release.
async function loadProviderModels(section, providerId) {
    const select = document.getElementById(`prov_${section}_model`);
    const note = document.getElementById(`prov_${section}_model_note`);
    if (!select) return;

    const spec = PROVIDER_SECTIONS.find(s => s.section === section);
    const provider = spec && spec.providers.find(p => p.id === providerId);
    const stored = provider ? ((providerState[section] || {})[provider.modelKey] || '') : '';

    const fail = (message) => {
        select.innerHTML = `<option value="${escapeHtml(stored)}">${escapeHtml(stored || 'unavailable')}</option>`;
        select.disabled = true;
        note.textContent = message;
        note.className = 'text-[11px] text-amber-400 mt-1';
    };

    try {
        const res = await fetch(`/api/providers/models?provider=${encodeURIComponent(providerId)}`);
        const data = await res.json();
        if (!res.ok || data.status !== 'ok') {
            fail(data.detail || data.message || 'Could not list the models.');
            return;
        }

        const models = data.models || [];
        // A model that is set but no longer listed still works often enough --
        // deepseek-chat is not in DeepSeek's own listing yet answers fine. It
        // stays selectable rather than being silently swapped out.
        const options = models.slice();
        if (stored && !options.includes(stored)) options.unshift(stored);

        select.disabled = false;
        select.innerHTML =
            `<option value="">Default (${escapeHtml(data.default || 'provider default')})</option>` +
            options.map(m =>
                `<option value="${escapeHtml(m)}" ${m === stored ? 'selected' : ''}>${escapeHtml(m)}` +
                `${m === stored && !models.includes(m) ? ' — not listed' : ''}</option>`).join('');

        note.textContent = `${models.length} model(s) offered by this key.`;
        note.className = 'text-[11px] text-gray-500 mt-1';
    } catch (e) {
        fail('Error connecting to the server.');
    }
}

function renderProviderSection(spec, state, currentId) {
    const configured = (state && state.configured) || {};
    const current = currentId || (state && state.provider) || spec.providers[0].id;
    const provider = spec.providers.find(p => p.id === current) || spec.providers[0];

    const options = spec.providers
        .map(p => `<option value="${p.id}" ${provider.id === p.id ? 'selected' : ''}>${escapeHtml(p.label)}</option>`)
        .join('');

    // Keys for the other providers stay stored; saying so stops the next switch
    // looking like the key was lost.
    const others = spec.providers
        .filter(p => p.id !== provider.id && configured[p.key])
        .map(p => p.label);
    const otherNote = others.length
        ? `<p class="text-[11px] text-gray-500">Also stored: ${escapeHtml(others.join(', '))}.</p>`
        : '';

    return `
    <div class="space-y-4 pb-5 border-b border-[#3f4147] last:border-0">
        <h4 class="text-sm font-bold text-white">${escapeHtml(spec.title)}</h4>
        <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1.5">Provider</label>
            <select id="prov_${spec.section}_provider" onchange="switchProvider('${spec.section}')"
                class="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg p-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 transition">
                ${options}
            </select>
        </div>
        <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1.5">Model</label>
            <select id="prov_${spec.section}_model"
                class="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg p-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 transition">
                <option value="">Loading...</option>
            </select>
            <p id="prov_${spec.section}_model_note" class="text-[11px] text-gray-400 mt-1"></p>
        </div>
        <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1.5">
                ${escapeHtml(provider.keyLabel)}
                ${configured[provider.key]
                    ? '<span class="text-[10px] text-green-400 font-semibold ml-1">✓ set</span>'
                    : '<span class="text-[10px] text-gray-500 font-semibold ml-1">not set</span>'}
            </label>
            <input type="password" id="prov_${spec.section}_key" autocomplete="off"
                placeholder="${configured[provider.key] ? 'Saved — type to replace' : 'Not set'}"
                class="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg p-2.5 text-white font-mono text-sm focus:outline-none focus:border-indigo-500 transition">
            ${providerGuide(provider)}
        </div>
        ${otherNote}
        <button onclick="saveProviders('${spec.section}')"
            class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-2 rounded transition shadow-md text-sm">
            💾 Save
        </button>
    </div>`;
}

// Redraw one section for the provider now selected, keeping anything already
// typed into the key field.
function switchProvider(section) {
    const spec = PROVIDER_SECTIONS.find(s => s.section === section);
    const host = document.getElementById('providersForm');
    if (!spec || !host) return;

    const chosen = document.getElementById(`prov_${section}_provider`).value;
    host.innerHTML = PROVIDER_SECTIONS
        .map(s => renderProviderSection(s, providerState[s.section], s.section === section ? chosen : null))
        .join('');
    PROVIDER_SECTIONS.forEach(s => {
        const sel = document.getElementById(`prov_${s.section}_provider`);
        if (sel) loadProviderModels(s.section, sel.value);
    });
}

async function loadProviders() {
    const host = document.getElementById('providersForm');
    if (!host) return;

    try {
        const res = await fetch('/api/providers');
        const data = await res.json();
        if (!res.ok) {
            host.innerHTML = `<p class="text-xs text-red-400">${escapeHtml(data.detail || 'Could not reach the broker.')}</p>`;
            return;
        }
        providerState = data.providers || {};
        host.innerHTML = PROVIDER_SECTIONS
            .map(spec => renderProviderSection(spec, providerState[spec.section]))
            .join('');
        PROVIDER_SECTIONS.forEach(spec => {
            const chosen = document.getElementById(`prov_${spec.section}_provider`);
            if (chosen) loadProviderModels(spec.section, chosen.value);
        });
    } catch (e) {
        host.innerHTML = '<p class="text-xs text-red-400">Error connecting to the server.</p>';
    }
}

async function saveProviders(section) {
    const spec = PROVIDER_SECTIONS.find(s => s.section === section);
    if (!spec) return;

    const chosen = document.getElementById(`prov_${section}_provider`).value;
    const provider = spec.providers.find(p => p.id === chosen) || spec.providers[0];
    const values = { provider: provider.id };

    // An empty field means "keep whatever is stored", so a saved key survives
    // saving the form without retyping it -- and the keys belonging to the
    // providers not shown are left untouched for the same reason.
    const field = document.getElementById(`prov_${section}_key`);
    if (field && field.value.trim()) values[provider.key] = field.value.trim();

    // Always sent, including empty, because empty is a real choice here: it
    // means "use whatever the provider module defaults to".
    const modelField = document.getElementById(`prov_${section}_model`);
    if (modelField && !modelField.disabled) values[provider.modelKey] = modelField.value;

    try {
        const res = await fetch('/api/providers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section, values })
        });
        const data = await res.json();
        alert(res.ok ? 'Provider settings saved.' : `Save failed: ${data.detail || 'unknown error'}`);
    } catch (e) {
        alert('Error connecting to the server.');
    }
    loadProviders();
}

// ---------------------------------------------------------------------
// USER MENU

function toggleUserMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('userMenu');
    if (!menu) return;

    const opening = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !opening);

    const chevron = document.getElementById('userMenuChevron');
    if (chevron) chevron.classList.toggle('rotate-180', opening);
}

function closeUserMenu() {
    const menu = document.getElementById('userMenu');
    if (menu) menu.classList.add('hidden');
    const chevron = document.getElementById('userMenuChevron');
    if (chevron) chevron.classList.remove('rotate-180');
}

// A menu that only closes by clicking the button again is a nuisance.
document.addEventListener('click', closeUserMenu);
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeUserMenu();
});

// ---------------------------------------------------------------------
// PLUGIN PAGES
//
// A plugin's own page runs in an iframe with sandbox="allow-scripts" and,
// deliberately, no allow-same-origin. The frame therefore gets an opaque
// origin: it cannot read the dashboard's DOM, cannot send its cookies, and
// cannot call the dashboard's API on the operator's behalf. Without that, a
// plugin's page could simply POST to /api/plugins/sources/trust and mark its
// own source trusted — defeating the one boundary that actually holds.
//
// Everything it needs goes through postMessage to the shim below, which only
// ever forwards to that plugin's own endpoints.

const pluginFrames = new Map();   // iframe element -> plugin id

// Injected ahead of the plugin's own HTML.
const PLUGIN_PAGE_SHIM = `<script>
(function () {
    let seq = 0;
    const pending = new Map();

    window.addEventListener('message', function (event) {
        const msg = event.data;
        if (!msg || msg.__doppler !== 'reply') return;
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(msg.error));
        else entry.resolve(msg.result);
    });

    function request(payload) {
        const id = ++seq;
        payload.id = id;
        return new Promise(function (resolve, reject) {
            pending.set(id, { resolve: resolve, reject: reject });
            parent.postMessage(payload, '*');
        });
    }

    window.doppler = {
        // Call one of this plugin's own declared endpoints.
        call: function (method, path, body) {
            return request({ __doppler: 'call', method: method, path: path, body: body });
        },
        // The bot's name and avatar. Read-only, and the same for every page, so
        // it comes from the host rather than each plugin serving its own copy.
        bot: function () {
            return request({ __doppler: 'bot' });
        }
    };
})();
<\/script>`;

window.addEventListener('message', async event => {
    const msg = event.data;
    if (!msg || (msg.__doppler !== 'call' && msg.__doppler !== 'bot')) return;

    // A sandboxed frame's origin is the string "null", so it proves nothing.
    // Identify the sender by its window instead: that cannot be forged.
    let pluginId = null;
    for (const [frame, id] of pluginFrames) {
        if (frame.contentWindow === event.source) { pluginId = id; break; }
    }
    if (!pluginId) return;

    const reply = (result, error) =>
        event.source.postMessage({ __doppler: 'reply', id: msg.id, result, error }, '*');

    if (msg.__doppler === 'bot') {
        try {
            const res = await fetch('/api/bot-info');
            const data = await res.json().catch(() => ({}));
            // Without this a 404 resolves as if it were the bot's identity, and
            // the page silently renders its placeholder instead of reporting.
            if (!res.ok) reply(null, data.detail || `HTTP ${res.status}`);
            else reply(data);
        } catch (e) {
            reply(null, String(e));
        }
        return;
    }

    const path = typeof msg.path === 'string' ? msg.path : '';
    if (!path.startsWith('/') || path.includes('..')) {
        reply(null, 'Invalid path');
        return;
    }

    try {
        // Confined to this plugin's own endpoints — the frame cannot name
        // another plugin, let alone a dashboard route.
        const res = await fetch(`/api/plugin/${pluginId}${path}`, {
            method: (msg.method || 'GET').toUpperCase(),
            headers: msg.body === undefined ? {} : { 'Content-Type': 'application/json' },
            body: msg.body === undefined ? undefined : JSON.stringify(msg.body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) reply(null, data.detail || data.message || `HTTP ${res.status}`);
        else reply(data);
    } catch (e) {
        reply(null, String(e));
    }
});

async function loadPluginPages() {
    let pages;
    try {
        const res = await fetch('/api/plugin-pages');
        if (!res.ok) return;
        pages = (await res.json()).pages || [];
    } catch (e) {
        return;
    }

    // Disabling or uninstalling a plugin has to take its tab with it, or the
    // dashboard keeps offering a page that no longer answers.
    const live = new Set(pages.map(p => p.plugin));
    let closedActive = false;

    document.querySelectorAll('[data-plugin-page]').forEach(el => {
        if (live.has(el.dataset.pluginPage)) return;
        if (el.classList.contains('tab-content') && !el.classList.contains('hidden')) closedActive = true;
        if (el.dataset.frame) pluginFrames.delete(el.querySelector('iframe'));
        el.remove();
    });

    pages.forEach(mountPageAsTab);

    if (closedActive) switchTab('stats');
}

// Each page gets a top-level tab of its own.
function mountPageAsTab(page) {
    const settingsBtn = document.getElementById('btn-settings');
    const navBar = settingsBtn ? settingsBtn.parentElement : null;
    const main = document.querySelector('main');
    if (!navBar || !main) return;

    const tabName = `plugin-${page.plugin}`;
    if (document.getElementById(`tab-${tabName}`)) return;

    const btn = document.createElement('button');
    btn.id = `btn-${tabName}`;
    btn.className = 'tab-btn px-4 py-2 rounded text-sm font-semibold transition text-gray-400 hover:bg-[#35373c]';
    btn.textContent = `${page.icon} ${page.title}`;
    btn.dataset.pluginPage = page.plugin;
    btn.addEventListener('click', () => switchTab(tabName));
    navBar.insertBefore(btn, settingsBtn);

    const pane = document.createElement('div');
    pane.id = `tab-${tabName}`;
    pane.className = 'tab-content hidden';
    pane.dataset.plugin = page.plugin;
    pane.dataset.pluginPage = page.plugin;
    pane.innerHTML = '<p class="text-xs text-gray-400">Loading...</p>';
    main.appendChild(pane);
}

// Loaded on first open rather than up front: a page nobody visits should not
// cost a request, and its scripts should not be running in the background.
async function openPluginPage(pane) {
    if (typeof pane === 'string') pane = document.getElementById(`tab-${pane}`);
    if (!pane || pane.dataset.loaded) return;

    const pluginId = pane.dataset.plugin;
    try {
        const res = await fetch(`/api/plugin-page/${pluginId}`);
        const data = await res.json();
        if (!res.ok) {
            pane.innerHTML = `<p class="text-xs text-red-400">${escapeHtml(data.detail || 'Could not load the page.')}</p>`;
            return;
        }

        const frame = document.createElement('iframe');
        frame.className = 'w-full rounded-lg border border-[#3f4147] bg-[#2b2d31]';
        frame.style.height = '78vh';
        // allow-modals as well: without it confirm() silently returns false and
        // alert() does nothing, so a page's "are you sure?" never opens and its
        // error reporting disappears. Pages come from trusted sources only.
        frame.setAttribute('sandbox', 'allow-scripts allow-modals');
        frame.srcdoc = PLUGIN_PAGE_SHIM + data.html;

        pane.innerHTML = '';
        pane.appendChild(frame);
        pluginFrames.set(frame, pluginId);
        pane.dataset.loaded = '1';
        pane.dataset.frame = '1';
    } catch (e) {
        pane.innerHTML = '<p class="text-xs text-red-400">Error connecting to the server.</p>';
    }
}
