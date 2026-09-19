"""Doppler's plugin system.

Plugins import from :mod:`dopplerbot.plugins.api`; the bot uses
:class:`~dopplerbot.plugins.loader.PluginRegistry` to run them.
"""

from dopplerbot.plugins.api import (
    AIError,
    EconomyAccess,
    EconomyError,
    InsufficientFunds,
    Plugin,
    PluginContext,
    PluginSetting,
    PluginSettingError,
    ScopedSettings,
    ServiceManager,
    ServiceUnavailable,
    SettingType,
)
from dopplerbot.plugins.endpoints import EndpointError
from dopplerbot.plugins.loader import INSTALLED_ROOT, PluginRegistry
from dopplerbot.plugins.manifest import (
    CURRENT_API_VERSION,
    MANIFEST_FILENAME,
    PluginManifest,
    PluginManifestError,
    ServiceSpec,
)

__all__ = [
    "AIError",
    "EconomyAccess",
    "EconomyError",
    "InsufficientFunds",
    "EndpointError",
    "Plugin",
    "PluginContext",
    "PluginSetting",
    "PluginSettingError",
    "ScopedSettings",
    "ServiceManager",
    "ServiceSpec",
    "ServiceUnavailable",
    "SettingType",
    "PluginRegistry",
    "INSTALLED_ROOT",
    "PluginManifest",
    "PluginManifestError",
    "CURRENT_API_VERSION",
    "MANIFEST_FILENAME",
]
