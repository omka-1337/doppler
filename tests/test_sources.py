import io
import json
import tarfile

import pytest

from broker import sources
from broker.sources import SourceError

TOP = "doppler-plugins-main"


@pytest.fixture
def broker_dirs(tmp_path, monkeypatch):
    """Point the broker's /config and /plugins at a scratch directory."""
    config = tmp_path / "config"
    plugins = tmp_path / "plugins"
    monkeypatch.setattr(sources, "CONFIG_DIR", config)
    monkeypatch.setattr(sources, "SOURCES_FILE", config / "sources.json")
    monkeypatch.setattr(sources, "INSTALLED_FILE", config / "installed.json")
    monkeypatch.setattr(sources, "INSTALLED_ROOT", plugins)
    sources.save_sources([
        {"name": "official", "repo": "omka-1337/doppler-plugins", "branch": "main", "trusted": True},
        {"name": "stranger", "repo": "someone/plugins", "branch": "main", "trusted": False},
    ])
    return config, plugins


def archive(files: dict[str, str], extra=()) -> bytes:
    """A .tar.gz shaped like GitHub's: everything under one top directory."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        directory = tarfile.TarInfo(TOP)
        directory.type = tarfile.DIRTYPE
        tar.addfile(directory)
        for name, content in files.items():
            data = content.encode()
            info = tarfile.TarInfo(f"{TOP}/{name}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        for info in extra:
            tar.addfile(info)
    return buffer.getvalue()


def plugin_files(directory: str, plugin_id: str = "music", version: str = "2.4.0") -> dict[str, str]:
    manifest = {"id": plugin_id, "name": plugin_id.title(), "version": version, "api_version": "2.0"}
    return {
        f"{directory}/plugin.json": json.dumps(manifest),
        f"{directory}/plugin.py": "# plugin\n",
        f"{directory}/sub/helper.py": "# helper\n",
    }


@pytest.fixture
def remote(monkeypatch):
    """Stand in for GitHub: set .catalog and .payload, and record what was fetched."""

    class Remote:
        catalog: dict = {"plugins": []}
        payload: bytes = b""
        downloaded: list[str] = []

    async def fetch_catalog(source):
        return Remote.catalog

    async def download(url):
        Remote.downloaded.append(url)
        return Remote.payload

    monkeypatch.setattr(sources, "fetch_catalog", fetch_catalog)
    monkeypatch.setattr(sources, "_download", download)
    Remote.downloaded = []
    return Remote


# --- where a plugin lives ---------------------------------------------

@pytest.mark.parametrize("entry, expected", [
    ({"id": "music", "path": "doppler/plugins/music"}, "doppler/plugins/music"),
    ({"id": "music", "path": "doppler/plugins/music/"}, "doppler/plugins/music"),
    # No path: the flat layout, a directory named after the id at the root.
    ({"id": "music"}, "music"),
    ({"id": "music", "path": ""}, "music"),
])
def test_plugin_path(entry, expected):
    assert sources.plugin_path(entry) == expected


@pytest.mark.parametrize("path", [
    "/etc", "../outside", "doppler/../../etc", "doppler/./music", "doppler//music",
    "doppler\\music", "/",
])
def test_plugin_path_stays_inside_the_repository(path):
    with pytest.raises(SourceError):
        sources.plugin_path({"id": "music", "path": path})


def test_urls_use_full_ref():
    source = {"repo": "omka-1337/doppler-plugins", "branch": "feature/x"}
    assert sources._catalog_url(source) == (
        "https://raw.githubusercontent.com/omka-1337/doppler-plugins/refs/heads/feature/x/index.json"
    )
    assert sources._archive_url(source).endswith("/tar.gz/refs/heads/feature/x")


# --- installing --------------------------------------------------------

async def test_install_from_author_directory(broker_dirs, remote):
    _, plugins = broker_dirs
    remote.catalog = {"plugins": [{"id": "music", "path": "doppler/plugins/music"}]}
    remote.payload = archive({
        **plugin_files("doppler/plugins/music"),
        # Another plugin and repository files must not come along.
        **plugin_files("doppler/plugins/voice", plugin_id="voice"),
        "README.md": "# catalogue\n",
    })

    result = await sources.install("official", "music")

    assert result == {"id": "music", "version": "2.4.0", "source": "official"}
    installed = sorted(p.relative_to(plugins / "music").as_posix()
                       for p in (plugins / "music").rglob("*") if p.is_file())
    assert installed == ["plugin.json", "plugin.py", "sub/helper.py"]
    assert not (plugins / "voice").exists()
    assert sources.load_installed() == {"music": {"source": "official", "version": "2.4.0"}}
    assert remote.downloaded == [
        "https://codeload.github.com/omka-1337/doppler-plugins/tar.gz/refs/heads/main"
    ]


async def test_install_from_flat_layout(broker_dirs, remote):
    """Sources that predate author directories keep working."""
    _, plugins = broker_dirs
    remote.catalog = {"plugins": [{"id": "music"}]}
    remote.payload = archive(plugin_files("music"))

    await sources.install("official", "music")
    assert (plugins / "music" / "plugin.py").is_file()


async def test_reinstall_replaces_old_files(broker_dirs, remote):
    _, plugins = broker_dirs
    remote.catalog = {"plugins": [{"id": "music", "path": "doppler/plugins/music"}]}
    remote.payload = archive(plugin_files("doppler/plugins/music", version="1.0.0"))
    await sources.install("official", "music")
    (plugins / "music" / "stale.py").write_text("")

    remote.payload = archive(plugin_files("doppler/plugins/music", version="2.0.0"))
    await sources.install("official", "music")

    assert not (plugins / "music" / "stale.py").exists()
    assert sources.load_installed()["music"]["version"] == "2.0.0"


async def test_only_catalogued_plugins_install(broker_dirs, remote):
    remote.catalog = {"plugins": [{"id": "voice", "path": "doppler/plugins/voice"}]}
    with pytest.raises(SourceError, match="does not offer"):
        await sources.install("official", "music")
    assert remote.downloaded == []


async def test_unknown_source(broker_dirs, remote):
    with pytest.raises(SourceError, match="No configured source"):
        await sources.install("nowhere", "music")


@pytest.mark.parametrize("plugin_id", ["../config", "Music", "", None])
async def test_install_refuses_bad_ids(broker_dirs, remote, plugin_id):
    remote.catalog = {"plugins": [{"id": plugin_id, "path": "x"}]}
    with pytest.raises(SourceError, match="not a valid plugin id"):
        await sources.install("official", plugin_id)


async def test_missing_directory(broker_dirs, remote):
    remote.catalog = {"plugins": [{"id": "music", "path": "doppler/plugins/music"}]}
    remote.payload = archive(plugin_files("music"))
    with pytest.raises(SourceError, match="doppler/plugins/music/"):
        await sources.install("official", "music")


async def test_directory_without_manifest(broker_dirs, remote):
    remote.catalog = {"plugins": [{"id": "music", "path": "music"}]}
    remote.payload = archive({"music/plugin.py": ""})
    with pytest.raises(SourceError, match="no plugin.json"):
        await sources.install("official", "music")


async def test_manifest_id_must_match_catalog(broker_dirs, remote):
    _, plugins = broker_dirs
    remote.catalog = {"plugins": [{"id": "music", "path": "doppler/plugins/music"}]}
    remote.payload = archive(plugin_files("doppler/plugins/music", plugin_id="voice"))
    with pytest.raises(SourceError, match="declares id 'voice'"):
        await sources.install("official", "music")
    assert not (plugins / "music").exists()
    assert sources.load_installed() == {}


async def test_links_and_traversal_are_dropped(broker_dirs, remote):
    _, plugins = broker_dirs
    link = tarfile.TarInfo(f"{TOP}/music/escape")
    link.type = tarfile.SYMTYPE
    link.linkname = "/etc/passwd"
    remote.catalog = {"plugins": [{"id": "music"}]}
    remote.payload = archive(
        {**plugin_files("music"), "music/../../evil.py": "boom"},
        extra=[link],
    )

    await sources.install("official", "music")

    assert not (plugins / "music" / "escape").exists()
    assert not any(p.name == "evil.py" for p in broker_dirs[0].parent.rglob("*"))


# --- trust and removal --------------------------------------------------

async def test_trust_follows_the_source(broker_dirs, remote):
    remote.catalog = {"plugins": [{"id": "music"}, {"id": "voice"}]}
    remote.payload = archive({**plugin_files("music"), **plugin_files("voice", plugin_id="voice")})
    await sources.install("official", "music")
    await sources.install("stranger", "voice")

    assert sources.is_trusted("music")
    assert not sources.is_trusted("voice")
    # Placed by hand: no record of where it came from.
    assert not sources.is_trusted("handmade")

    sources.save_sources([s for s in sources.load_sources() if s["name"] != "official"])
    assert not sources.is_trusted("music")


async def test_uninstall(broker_dirs, remote):
    _, plugins = broker_dirs
    remote.catalog = {"plugins": [{"id": "music"}]}
    remote.payload = archive(plugin_files("music"))
    await sources.install("official", "music")

    sources.uninstall("music")
    assert not (plugins / "music").exists()
    assert sources.load_installed() == {}

    with pytest.raises(SourceError, match="not installed"):
        sources.uninstall("music")


def test_uninstall_stays_inside_plugins(broker_dirs):
    config, _ = broker_dirs
    with pytest.raises(SourceError, match="not a valid plugin id"):
        sources.uninstall("../config")
    assert (config / "sources.json").is_file()
