import json

import pytest

from dopplerbot.plugins.manifest import (
    CURRENT_API_VERSION,
    PluginManifestError,
    is_api_compatible,
    load_manifest,
    parse_manifest,
)


def manifest(**overrides) -> dict:
    data = {"id": "demo", "name": "Demo", "version": "1.0.0", "api_version": "2.0"}
    data.update(overrides)
    return data


def lavalink(**overrides) -> dict:
    service = {"name": "lavalink", "image": "ghcr.io/lavalink-devs/lavalink:4", "port": 2333}
    service.update(overrides)
    return service


def test_minimal_manifest_gets_defaults():
    parsed = parse_manifest(manifest())
    assert parsed.entrypoint == "plugin.py"
    assert parsed.services == []
    assert parsed.page is None
    assert parsed.default_enabled is True
    assert parsed.module_name == "doppler_plugins.demo"


@pytest.mark.parametrize("field", ["id", "name", "version", "api_version"])
def test_required_fields(field):
    data = manifest()
    del data[field]
    with pytest.raises(PluginManifestError, match=field):
        parse_manifest(data)


@pytest.mark.parametrize("plugin_id", ["Demo", "1demo", "d", "de-mo", "../demo", "a" * 33])
def test_rejects_bad_ids(plugin_id):
    with pytest.raises(PluginManifestError, match="Invalid plugin id"):
        parse_manifest(manifest(id=plugin_id))


def test_api_compatibility():
    major, minor = (int(p) for p in CURRENT_API_VERSION.split("."))
    assert is_api_compatible(f"{major}.0")
    assert is_api_compatible(CURRENT_API_VERSION)
    # A newer minor needs features this bot does not have; another major is
    # a different API altogether.
    assert not is_api_compatible(f"{major}.{minor + 1}")
    assert not is_api_compatible(f"{major + 1}.0")
    assert not is_api_compatible(f"{major - 1}.9")
    assert not is_api_compatible("two")


def test_incompatible_api_is_refused():
    with pytest.raises(PluginManifestError, match="targets plugin API"):
        parse_manifest(manifest(api_version="9.0"))


def test_requirements_must_be_strings():
    with pytest.raises(PluginManifestError, match="requirements"):
        parse_manifest(manifest(requirements=["ok", 3]))


def test_service_is_parsed():
    parsed = parse_manifest(manifest(services=[lavalink(env={"A": "1"}, memory_mb=700)]))
    service = parsed.services[0]
    assert service.port == 2333
    assert service.memory_mb == 700
    assert service.env == {"A": "1"}


@pytest.mark.parametrize("service, message", [
    (lavalink(image="ghcr.io/lavalink-devs/lavalink"), "must pin a tag"),
    (lavalink(image=""), "declares no image"),
    (lavalink(name="Lava Link"), "invalid service name"),
    (lavalink(port=70000), "out of range"),
    (lavalink(memory_mb=10), "memory_mb"),
    (lavalink(env={"lower": "x"}), "invalid environment name"),
    (lavalink(files={"/etc/passwd": "/x"}), "relative path"),
    (lavalink(files={"../secret": "/x"}), "relative path"),
    (lavalink(files={"app.yml": "relative/target"}), "absolute path"),
])
def test_service_rules(service, message):
    with pytest.raises(PluginManifestError, match=message):
        parse_manifest(manifest(services=[service]))


def test_duplicate_services():
    with pytest.raises(PluginManifestError, match="duplicate service"):
        parse_manifest(manifest(services=[lavalink(), lavalink()]))


def test_image_digest_counts_as_pinned():
    image = "registry:5000/lavalink@sha256:" + "0" * 64
    assert parse_manifest(manifest(services=[lavalink(image=image)])).services[0].image == image


@pytest.mark.parametrize("page, message", [
    ({"title": "T", "entry": "../page.html"}, "relative path"),
    ({"title": "T", "entry": "page.js"}, "must be an .html"),
    ({"title": "T"}, "no entry"),
    ({"entry": "page.html"}, "no title"),
])
def test_page_rules(page, message):
    with pytest.raises(PluginManifestError, match=message):
        parse_manifest(manifest(page=page))


def write_plugin(root, plugin_id="demo", files=("plugin.py",), **overrides):
    plugin_dir = root / plugin_id
    plugin_dir.mkdir()
    (plugin_dir / "plugin.json").write_text(json.dumps(manifest(id=plugin_id, **overrides)))
    for name in files:
        (plugin_dir / name).write_text("")
    return plugin_dir


def test_load_manifest(tmp_path):
    plugin_dir = write_plugin(tmp_path, page={"title": "Demo", "entry": "page.html"},
                              files=("plugin.py", "page.html"))
    parsed = load_manifest(plugin_dir)
    assert parsed.path == plugin_dir
    assert parsed.page.entry == "page.html"


def test_id_must_match_directory(tmp_path):
    plugin_dir = write_plugin(tmp_path, plugin_id="demo")
    (plugin_dir / "plugin.json").write_text(json.dumps(manifest(id="other")))
    with pytest.raises(PluginManifestError, match="does not match its directory"):
        load_manifest(plugin_dir)


def test_missing_entrypoint(tmp_path):
    with pytest.raises(PluginManifestError, match="entrypoint"):
        load_manifest(write_plugin(tmp_path, files=()))


def test_missing_page_file(tmp_path):
    with pytest.raises(PluginManifestError, match="does not exist"):
        load_manifest(write_plugin(tmp_path, page={"title": "Demo", "entry": "page.html"}))


def test_unreadable_manifest(tmp_path):
    plugin_dir = tmp_path / "demo"
    plugin_dir.mkdir()
    (plugin_dir / "plugin.json").write_text("{not json")
    with pytest.raises(PluginManifestError, match="Could not read"):
        load_manifest(plugin_dir)
