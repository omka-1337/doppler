# Doppler Plugin API

Reference for writing a Doppler plugin. This file is the reference itself: a
running dashboard renders it at `/docs/plugins`, with the API version that
install actually implements shown in the header.

**Plugin API 2.2**

- [Overview](#overview)
- [Quick start](#quick-start)
- [plugin.json](#pluginjson)
- [The Plugin class](#the-plugin-class)
- [Settings](#settings)
- [The context](#the-context)
- [Pages](#pages)
- [Sidecar services](#sidecar-services)
- [Publishing](#publishing)
- [What plugins may do](#what-plugins-may-do)

## Overview

A plugin is a folder with a `plugin.json` manifest and a Python module defining
one subclass of `Plugin`. Doppler ships with no features of its own: everything
is installed from a source through **Plugins → Browse**.

Installed plugins live in `plugins/`, which the broker writes and the bot only
reads. Each is imported under a synthetic package, so a plugin's own files can
import each other with relative imports, and unloading it is a matter of
dropping that one module prefix. That is what lets the dashboard's **Reload**
button swap a plugin's code while the bot stays connected.

```
plugins/my_plugin/
├── plugin.json      # identity and declarations — read without importing anything
├── plugin.py        # entrypoint: one subclass of Plugin
└── helpers.py       # anything else; import it with "from .helpers import ..."
```

## Quick start

A complete, working plugin.

**plugin.json**

```json
{
    "id": "hello",
    "name": "Hello",
    "version": "1.0.0",
    "api_version": "2.2",
    "description": "Replies to /hello.",
    "author": "you",
    "icon": "👋"
}
```

**plugin.py**

```python
import discord
from discord import app_commands
from discord.ext import commands

from dopplerbot.plugins.api import Plugin, PluginSetting, SettingType


class HelloCog(commands.Cog):
    def __init__(self, plugin):
        self.plugin = plugin
        self.bot = plugin.bot

    @app_commands.command(name="hello", description="Say hello")
    async def hello(self, interaction: discord.Interaction):
        greeting = await self.plugin.settings.get("greeting")
        await interaction.response.send_message(f"{greeting}, {interaction.user.mention}!")


class HelloPlugin(Plugin):
    SETTINGS = (
        PluginSetting("greeting", SettingType.STRING, default="Hello",
                      label="Greeting", description="How the bot opens."),
    )

    async def setup(self):
        await self.ctx.add_cog(HelloCog(self))
```

That is the whole plugin. The settings form, the enable/disable switch and the
reload button appear in the dashboard on their own.

## plugin.json

Plain data, deliberately: the dashboard's browser lists and describes a plugin
without importing its Python.

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | 2–32 chars, lowercase letters, digits, underscores. Must equal the folder name, and becomes the settings namespace. |
| `name` | yes | Shown on the plugin card. |
| `version` | yes | Your plugin's version; free-form. |
| `api_version` | yes | The plugin API you wrote against. A plugin targeting a newer minor, or a different major, is refused rather than loaded. |
| `entrypoint` | no | Defaults to `plugin.py`. |
| `description` | no | One sentence, shown on the card and in the browser. |
| `author` | no | |
| `icon` | no | One emoji. Defaults to 🧩. |
| `homepage` | no | |
| `requirements` | no | pip packages you need. **Shown, not installed** — pulling packages on the operator's behalf is their decision, not the plugin's. |
| `default_enabled` | no | Whether it starts the first time it is seen. Defaults to true. |
| `page` | no | A settings page of your own — see [Pages](#pages). An object with `title`, `entry` (an `.html` file in your folder) and an optional `icon`. |
| `services` | no | Sidecar containers — see [Sidecar services](#sidecar-services). |

### Version compatibility

A plugin loads when its `api_version` has the **same major** as the API the bot
implements and a **minor no newer** than it. Growing the API is therefore safe:
a plugin written against 2.0 keeps loading on a bot implementing 2.2. Asking for
more than the bot has is refused outright rather than failing halfway through,
and a major bump refuses every plugin built for the previous one — which is what
2.0 does to plugins written for 1.x.

## The Plugin class

The entrypoint must define exactly one subclass of `Plugin`. If you have several
for some reason, set `PLUGIN = YourClass` to pick one. Identity lives in the
manifest, so the class carries only behaviour.

```python
class MyPlugin(Plugin):
    SETTINGS = (...)          # the form the dashboard generates

    async def setup(self):    # called when enabled or reloaded
        ...

    async def teardown(self): # called when disabled or reloaded
        ...
```

Cogs and views registered through `self.ctx` are removed automatically on
unload — you do not need to undo them in `teardown()`. Use it for what the
context does not know about: background tasks to cancel, connections to close.
Anything you leave running will still be running after a reload.

`self.bot`, `self.settings` and `self.log` are shortcuts to the matching
attributes on `self.ctx`.

## Settings

Declare them once in `SETTINGS`. That single declaration is the form the
dashboard renders, the defaults seeded on first load, and the only keys the
plugin may read or write. Asking for a key you did not declare raises
`PluginSettingError`, so a typo fails loudly instead of quietly reading nothing
forever.

```python
PluginSetting(
    "channel_id",                 # key: lowercase, snake_case
    SettingType.CHANNEL,
    default=0,
    label="Log channel",          # defaults to a prettified key
    description="Where entries are posted.",
    choices=(("a", "Option A"),), # SELECT only
    min=0, max=100, step=1,       # numeric types
    hidden=False,                 # persisted, but not shown in the panel
)
```

Values come back coerced to the declared type — `BOOL` as a real `bool`,
`CHANNEL` and `INT` as `int`.

```python
channel_id = await self.settings.get("channel_id")   # int
everything = await self.settings.all()               # dict, all coerced
await self.settings.set("channel_id", 123456789)
```

Use `hidden=True` for state that should survive a restart but that nobody
should edit — a "lockdown is currently active" flag, say.

`channel`, `category` and `role` render as dropdowns filled from the guild the
bot is locked to, so nobody has to turn on developer mode and copy ids. A value
that no longer exists in the guild stays selected and is labelled as missing,
rather than being quietly replaced. If the bot cannot be reached the field falls
back to a plain id box.

### SettingType

| Type | Renders as |
| --- | --- |
| `string` | Single-line text input. |
| `text` | Multi-line textarea — for a system prompt or a long template. |
| `secret` | Password-style input, masked in the panel and revealed on hover. |
| `int` | Whole number. Honours `min` and `max`. |
| `float` | Decimal number. |
| `bool` | Toggle switch. Coerced to a real `bool` when read. |
| `select` | Dropdown. Requires `choices=((value, label), ...)`. |
| `slider` | Range slider. Requires `min` and `max`; `step` defaults to 0.1. |
| `channel` | A channel of the home guild, picked from a list grouped by category. Read back as an `int`. |
| `category` | A category of the home guild, picked from a list. Read back as an `int`. |
| `role` | A role of the home guild, picked from a list. Read back as an `int`. |

## The context

`self.ctx` is everything a plugin is handed. Registering through it is what
makes unloading complete.

### `ctx.add_cog(cog)` · `ctx.add_view(view)`

Register a cog or a persistent view. Both are removed when the plugin unloads,
which is what lets **Reload** take a plugin's new code without leaving the old
commands behind. `add_cog` is a coroutine and must be awaited; `add_view` is
not.

### `ctx.settings`

Your namespaced settings store: `get`, `set`, `all`. Only declared keys.

### `ctx.db`

This plugin's own SQLite database, opened lazily and closed on unload. Nothing
is shared with another plugin.

### `ctx.ai`

Text generation using whichever provider the operator configured. The key is not
yours and never reaches you — the call is made elsewhere and you get the text.
Raises `AIError`.

```python
if await self.ctx.ai.is_configured():
    reply = await self.ctx.ai.complete("You are terse.", "Say hello.")
```

### `ctx.economy`

One wallet per member, shared by every plugin. Currency lives in the bot's
database rather than a plugin's, because the point of it is to be shared: a shop
and a game have to see one balance between them. Amounts are whole numbers.

```python
balance = await self.ctx.economy.balance(member)
await self.ctx.economy.add(member, 100)

try:
    left = await self.ctx.economy.take(member, 250)
except InsufficientFunds:
    await interaction.response.send_message("You cannot afford that.")

await self.ctx.economy.transfer(sender, recipient, 50)
```

`balance`, `add`, `take`, `transfer` and `set` all accept a member, a user, or a
plain id. `take` and `transfer` raise `InsufficientFunds` rather than letting a
balance go negative, and the check happens inside the write, so two plugins
spending at the same moment cannot both succeed against the same coins.

Bots have no wallets: passing one raises `EconomyError`. An id for an account
the bot has never seen cannot be checked, and is allowed rather than guessed at.

`set` overwrites a balance outright. It is there for putting a mistake right,
not for gameplay.

`top()` is the leaderboard. It returns `{"user_id": ..., "balance": ...}`,
richest first, skipping wallets that hold nothing. Pass `limit=None` for the
whole table if the plugin wants to rank things its own way. Ids rather than
members, because resolving a member may need a request and which of them to
show is the plugin's business.

```python
for place, row in enumerate(await self.ctx.economy.top(limit=10), start=1):
    member = guild.get_member(row["user_id"])
    ...
```

`currency()` returns what the operator calls the money, set once under
**Settings → Main** and shared by every plugin so a shop and a game do not
invent two different names for the same coins.

```python
money = await self.ctx.economy.currency()
f"{money['symbol']} {balance} {money['name']}".strip()   # "🪙 250 coins"
```

`symbol` may be a plain emoji, a server one in Discord's `<:name:id>` form, or
empty. `name` always has something in it, falling back to "coins".

### `ctx.services`

Start and address a sidecar container you declared in the manifest. See
[Sidecar services](#sidecar-services).

### `ctx.add_endpoint(method, path, handler)`

Expose an HTTP endpoint at `/api/plugin/<id><path>`, behind the dashboard's
login. For settings a generated form cannot express. The handler takes an
`aiohttp.web.Request`; returning a dict is shorthand for a JSON response.
Removed automatically when the plugin unloads.

```python
async def list_items(self, request):
    return {"items": [...]}

self.ctx.add_endpoint("GET", "/items", self.list_items)
```

> **Trusted sources only.** The endpoint answers on the dashboard's own origin
> with the operator's session attached, so it is not granted to code whose
> author has not been vouched for. Raises `PermissionError` otherwise — catch it
> and carry on if the rest of your plugin works without the page.

### `ctx.data_dir` · `ctx.savedata_dir`

`data_dir` is a private folder for your files, created on first use.
`savedata_dir` is the bot's shared folder — only for data you deliberately share
with the dashboard.

### `ctx.bot` · `ctx.log` · `ctx.manifest`

The `commands.Bot` instance, a logger named `plugin.<id>` that writes to the
dashboard's live log, and your own parsed manifest.

## Pages

When a generated settings form cannot express your UI, ship an HTML file and
declare it in the manifest. It gets its own tab in the dashboard, which appears
when the plugin starts and disappears when it stops.

```json
"page": {
    "title": "Embed Builder",
    "entry": "page.html",
    "icon": "🛠️"
}
```

The file is served into an iframe with `sandbox="allow-scripts allow-modals"`
and no `allow-same-origin`, so the page runs on an opaque origin. It cannot read
the dashboard's cookies, its DOM, or any dashboard route. Everything it needs
comes through `window.doppler`, injected ahead of your own markup.

`confirm()`, `alert()` and `prompt()` work. Most other things a page cannot do
fail loudly, but these three are the exception worth knowing: without
`allow-modals` a browser makes `confirm()` return `false` and `alert()` do
nothing, with no error either way.

### `doppler.call(method, path, body)`

Calls one of **your** endpoints, declared with `ctx.add_endpoint`. The host
prefixes your plugin id, so a page cannot name another plugin's endpoint or a
dashboard route. Resolves with the decoded JSON, and rejects on any error
response.

```js
const data = await doppler.call('POST', '/save', payload);
```

### `doppler.bot()`

The bot's own identity, for pages that preview what a message will look like.
Read-only, and identical for every page, so it comes from the host rather than
each plugin serving its own copy. Resolves with `username`, `global_name` and
`avatar_url` — the last is `null` when the bot has no avatar set.

```js
const bot = await doppler.bot();
nameEl.textContent = bot.global_name || bot.username;
if (bot.avatar_url) avatarEl.src = bot.avatar_url;
```

Both calls reject rather than resolving with an error body, so
wrap them and keep a sensible placeholder for when they fail.

> **Trusted sources only**, for the same reason as `ctx.add_endpoint`: the page
> is rendered by the dashboard for a logged-in operator. A plugin from an
> untrusted source keeps its settings form and simply gets no tab.

## Sidecar services

A plugin that needs a service of its own declares it in the manifest. The
broker — the only component with access to Docker — reads that declaration
itself and starts the container. Your code only ever names a service; it cannot
describe one.

```json
"services": [
    {
        "name": "lavalink",
        "image": "ghcr.io/lavalink-devs/lavalink:4",
        "port": 2333,
        "memory_mb": 700,
        "env": { "_JAVA_OPTIONS": "-Xmx500m" },
        "env_from_settings": { "LAVALINK_PASSWORD": "lavalink_password" },
        "files": { "lavalink.yml": "/opt/Lavalink/application.yml" }
    }
]
```

`image` must pin a tag or digest, and `port` is reachable inside the bot's
network only.

```python
service = await self.ctx.services.start("lavalink")
service["uri"]   # http://doppler_plg_<plugin>_<service>:<port>
await self.ctx.services.wait_until_ready("lavalink")   # the port takes time to open
```

The broker fixes everything else, and a manifest cannot ask otherwise:

- never privileged, all capabilities dropped, `no-new-privileges`
- no ports published to the host — reachable only from the bot
- the only mounts are read-only files from inside your own plugin folder
- a memory cap, and an image that must pin a tag or digest

> **Trust gate.** Sidecars start only for a plugin the broker installed from a
> source the operator marked trusted. A plugin copied in by hand still loads and
> runs, but gets no containers — there is no record of where it came from.

## Publishing

A source is a GitHub repository and branch with one folder per plugin at the
root, plus an `index.json` the browser reads. Add it under **Plugins →
Sources**; it starts untrusted.

```
index.json
my_plugin/
    plugin.json
    plugin.py
```

```json
{
    "name": "My plugins",
    "plugins": [
        {
            "id": "my_plugin",
            "name": "My Plugin",
            "version": "1.0.0",
            "description": "...",
            "icon": "🧩",
            "services": []
        }
    ]
}
```

## What plugins may do

Worth stating plainly, because the API's shape suggests more separation than
actually exists.

**Actually enforced**

- No access to Docker: the bot container has no socket.
- `config/` and `plugins/` are read-only, so a plugin cannot mark its own source
  trusted or rewrite another plugin's files.
- Sidecars are refused to plugins from untrusted sources.
- The AI provider's key is held outside this process; you get generated text,
  never the credential.
- The dashboard's session secret and OAuth client secret are not in the bot
  container.

**Not enforced**

- Plugin code runs in the bot's own process. Settings namespacing is a
  convention, not a barrier — the database can be opened directly.
- The Discord bot token is readable, because discord.py holds it to keep the
  gateway open.
- Arbitrary code, files and network access, as the bot's own user.

So installing a plugin means trusting its author, the same way installing a
package does. The trust flag decides whether a plugin may additionally run
containers; **it is not a sandbox.**
