"""Plugin manifests.

Every plugin ships a ``plugin.json`` next to its code. The manifest is
deliberately plain data: the dashboard's plugin browser has to be able to list
and describe a plugin -- name, version, author, description -- *before* the
plugin's Python is ever imported, both for locally installed plugins and for
ones offered in a remote catalog on GitHub.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

# Version of the plugin API this bot implements. A plugin declares the API
# version it was written against; see is_api_compatible() for the rule.
CURRENT_API_VERSION = "2.2"

MANIFEST_FILENAME = "plugin.json"

# A plugin id doubles as its settings namespace, its import name and its
# directory name, so it is restricted to a conservative slug.
_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,31}$")

_REQUIRED_FIELDS = ("id", "name", "version", "api_version")


class PluginManifestError(Exception):
    """Raised when a plugin.json is missing, malformed or incompatible."""


@dataclass(frozen=True)
class PagePlugin:
    """A settings page a plugin ships itself.

    For the cases a generated form cannot express -- the embed builder, whose
    UI is a canvas rather than a list of fields. The file is served into a
    sandboxed frame; see the dashboard side for what that frame may do.
    """

    title: str
    entry: str
    icon: str = "🧩"

    def to_dict(self) -> dict:
        return {"title": self.title, "entry": self.entry, "icon": self.icon}


@dataclass(frozen=True)
class ServiceSpec:
    """A sidecar container a plugin needs (Lavalink, a database, ...).

    This is the *whole* description of what may run: the broker builds the
    container from this and nothing else. The bot only ever names a service,
    so plugin code cannot influence the image, the mounts or the capabilities.
    """

    name: str
    image: str
    # Literal environment for the container.
    env: dict[str, str] = field(default_factory=dict)
    # Environment resolved from the plugin's own settings at start time:
    # {ENV_VAR: setting_key}. The only part a plugin influences, and only for
    # keys it declared here.
    env_from_settings: dict[str, str] = field(default_factory=dict)
    # Read-only file mounts, {path relative to the plugin dir: container path}.
    files: dict[str, str] = field(default_factory=dict)
    # The port the service listens on inside the network. Never published to
    # the host -- sidecars are reachable only from the bot's own network.
    port: int | None = None
    memory_mb: int = 512

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "image": self.image,
            "env": dict(self.env),
            "env_from_settings": dict(self.env_from_settings),
            "files": dict(self.files),
            "port": self.port,
            "memory_mb": self.memory_mb,
        }


@dataclass(frozen=True)
class PluginManifest:
    id: str
    name: str
    version: str
    api_version: str
    description: str = ""
    author: str = ""
    icon: str = "🧩"
    entrypoint: str = "plugin.py"
    homepage: str = ""
    # pip requirements the plugin needs. Declared for the dashboard to show;
    # nothing is installed automatically -- pulling arbitrary packages on a
    # user's behalf is the operator's decision, not the plugin's.
    requirements: list[str] = field(default_factory=list)
    # Sidecar containers this plugin needs; see ServiceSpec.
    services: list[ServiceSpec] = field(default_factory=list)
    # An optional settings page of the plugin's own; see PagePlugin.
    page: "PagePlugin | None" = None
    # Whether the plugin starts enabled the first time it is discovered.
    default_enabled: bool = True
    # Filesystem location. Empty for manifests fetched from a remote catalog.
    path: Path | None = None

    @property
    def module_name(self) -> str:
        return f"{PLUGIN_PACKAGE}.{self.id}"

    def to_dict(self) -> dict:
        """Serialisable form, for the dashboard and for catalog indexes."""
        return {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "api_version": self.api_version,
            "description": self.description,
            "author": self.author,
            "icon": self.icon,
            "entrypoint": self.entrypoint,
            "homepage": self.homepage,
            "requirements": list(self.requirements),
            "services": [service.to_dict() for service in self.services],
            "page": self.page.to_dict() if self.page else None,
            "default_enabled": self.default_enabled,
        }


# Synthetic package every plugin is imported under, so that a plugin can use
# relative imports between its own files and so that unloading is a matter of
# dropping one module prefix from sys.modules.
PLUGIN_PACKAGE = "doppler_plugins"


def is_api_compatible(api_version: str) -> bool:
    """Semver-ish: same major, and a minor no newer than what we implement."""
    try:
        want_major, want_minor = (int(p) for p in api_version.split(".")[:2])
        have_major, have_minor = (int(p) for p in CURRENT_API_VERSION.split(".")[:2])
    except (ValueError, TypeError):
        return False
    return want_major == have_major and want_minor <= have_minor


_SERVICE_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{1,31}$")
_ENV_NAME_PATTERN = re.compile(r"^[A-Z_][A-Z0-9_]{0,63}$")

# A sidecar gets a hard memory ceiling; a plugin cannot ask for the whole host.
MAX_SERVICE_MEMORY_MB = 4096


def _parse_services(data: dict, plugin_id: str) -> list[ServiceSpec]:
    raw_services = data.get("services", [])
    if not isinstance(raw_services, list):
        raise PluginManifestError(f"{plugin_id!r}: 'services' must be a list.")

    services: list[ServiceSpec] = []
    seen: set[str] = set()

    for raw in raw_services:
        if not isinstance(raw, dict):
            raise PluginManifestError(f"{plugin_id!r}: each service must be an object.")

        name = str(raw.get("name", ""))
        if not _SERVICE_NAME_PATTERN.match(name):
            raise PluginManifestError(
                f"{plugin_id!r}: invalid service name {name!r} "
                "(2-32 chars, lowercase letters, digits, '-' and '_')."
            )
        if name in seen:
            raise PluginManifestError(f"{plugin_id!r}: duplicate service {name!r}.")
        seen.add(name)

        image = str(raw.get("image", "")).strip()
        if not image:
            raise PluginManifestError(f"{plugin_id!r}: service {name!r} declares no image.")
        # A floating "latest" would silently change what runs on every restart.
        if ":" not in image.rsplit("/", 1)[-1] and "@" not in image:
            raise PluginManifestError(
                f"{plugin_id!r}: service {name!r} image {image!r} must pin a tag or digest."
            )

        env = raw.get("env", {}) or {}
        env_from_settings = raw.get("env_from_settings", {}) or {}
        files = raw.get("files", {}) or {}
        for label, mapping in (("env", env), ("env_from_settings", env_from_settings), ("files", files)):
            if not isinstance(mapping, dict):
                raise PluginManifestError(f"{plugin_id!r}: service {name!r} '{label}' must be an object.")

        for key in list(env) + list(env_from_settings):
            if not _ENV_NAME_PATTERN.match(str(key)):
                raise PluginManifestError(
                    f"{plugin_id!r}: service {name!r} declares an invalid environment name {key!r}."
                )

        for source, target in files.items():
            source = str(source)
            # Mounts may only expose files from inside the plugin's own folder,
            # so a manifest cannot reach the host filesystem.
            if source.startswith("/") or ".." in Path(source).parts:
                raise PluginManifestError(
                    f"{plugin_id!r}: service {name!r} file {source!r} must be a relative path "
                    "inside the plugin directory."
                )
            if not str(target).startswith("/"):
                raise PluginManifestError(
                    f"{plugin_id!r}: service {name!r} mount target {target!r} must be an absolute path."
                )

        port = raw.get("port")
        if port is not None:
            try:
                port = int(port)
            except (TypeError, ValueError):
                raise PluginManifestError(f"{plugin_id!r}: service {name!r} has a non-numeric port.") from None
            if not 1 <= port <= 65535:
                raise PluginManifestError(f"{plugin_id!r}: service {name!r} port {port} is out of range.")

        try:
            memory_mb = int(raw.get("memory_mb", 512))
        except (TypeError, ValueError):
            raise PluginManifestError(f"{plugin_id!r}: service {name!r} has a non-numeric memory_mb.") from None
        if not 64 <= memory_mb <= MAX_SERVICE_MEMORY_MB:
            raise PluginManifestError(
                f"{plugin_id!r}: service {name!r} memory_mb must be between 64 and {MAX_SERVICE_MEMORY_MB}."
            )

        services.append(ServiceSpec(
            name=name,
            image=image,
            env={str(k): str(v) for k, v in env.items()},
            env_from_settings={str(k): str(v) for k, v in env_from_settings.items()},
            files={str(k): str(v) for k, v in files.items()},
            port=port,
            memory_mb=memory_mb,
        ))

    return services


def _parse_page(data: dict, plugin_id: str, path: Path | None) -> "PagePlugin | None":
    raw = data.get("page")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise PluginManifestError(f"{plugin_id!r}: 'page' must be an object.")

    entry = str(raw.get("entry", "")).strip()
    if not entry:
        raise PluginManifestError(f"{plugin_id!r}: 'page' declares no entry file.")

    # Same rule as service file mounts: the page must come from inside the
    # plugin's own folder.
    if entry.startswith("/") or ".." in Path(entry).parts:
        raise PluginManifestError(
            f"{plugin_id!r}: page entry {entry!r} must be a relative path inside the plugin directory."
        )
    if not entry.endswith(".html"):
        raise PluginManifestError(f"{plugin_id!r}: page entry {entry!r} must be an .html file.")

    if path is not None and not (path / entry).is_file():
        raise PluginManifestError(f"{plugin_id!r}: page entry {entry!r} does not exist.")

    title = str(raw.get("title", "")).strip()
    if not title:
        raise PluginManifestError(f"{plugin_id!r}: 'page' declares no title.")

    return PagePlugin(title=title, entry=entry, icon=str(raw.get("icon", "🧩")))


def parse_manifest(data: dict, path: Path | None = None) -> PluginManifest:
    """Validate a decoded plugin.json. Raises PluginManifestError."""
    if not isinstance(data, dict):
        raise PluginManifestError("Manifest must be a JSON object.")

    missing = [f for f in _REQUIRED_FIELDS if not data.get(f)]
    if missing:
        raise PluginManifestError(f"Manifest is missing required field(s): {', '.join(missing)}.")

    plugin_id = data["id"]
    if not isinstance(plugin_id, str) or not _ID_PATTERN.match(plugin_id):
        raise PluginManifestError(
            f"Invalid plugin id {plugin_id!r}: use 2-32 chars, lowercase letters, "
            "digits and underscores, starting with a letter."
        )

    # The id is the import name, so it must match the folder it lives in --
    # otherwise two plugins could claim the same namespace from different dirs.
    if path is not None and path.name != plugin_id:
        raise PluginManifestError(
            f"Plugin id {plugin_id!r} does not match its directory name {path.name!r}."
        )

    api_version = str(data["api_version"])
    if not is_api_compatible(api_version):
        raise PluginManifestError(
            f"Plugin {plugin_id!r} targets plugin API {api_version}, "
            f"but this bot implements {CURRENT_API_VERSION}."
        )

    requirements = data.get("requirements", [])
    if not isinstance(requirements, list) or not all(isinstance(r, str) for r in requirements):
        raise PluginManifestError(f"{plugin_id!r}: 'requirements' must be a list of strings.")

    return PluginManifest(
        id=plugin_id,
        name=str(data["name"]),
        version=str(data["version"]),
        api_version=api_version,
        description=str(data.get("description", "")),
        author=str(data.get("author", "")),
        icon=str(data.get("icon", "🧩")),
        entrypoint=str(data.get("entrypoint", "plugin.py")),
        homepage=str(data.get("homepage", "")),
        requirements=requirements,
        services=_parse_services(data, plugin_id),
        page=_parse_page(data, plugin_id, path),
        default_enabled=bool(data.get("default_enabled", True)),
        path=path,
    )


def load_manifest(plugin_dir: Path) -> PluginManifest:
    """Read and validate the plugin.json inside a plugin directory."""
    manifest_path = plugin_dir / MANIFEST_FILENAME
    if not manifest_path.is_file():
        raise PluginManifestError(f"No {MANIFEST_FILENAME} in {plugin_dir}.")

    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise PluginManifestError(f"Could not read {manifest_path}: {e}") from e

    manifest = parse_manifest(data, path=plugin_dir)

    if not (plugin_dir / manifest.entrypoint).is_file():
        raise PluginManifestError(
            f"{manifest.id!r}: entrypoint {manifest.entrypoint!r} does not exist in {plugin_dir}."
        )

    return manifest
