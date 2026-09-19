import asyncio
import aiosqlite
import os
from pathlib import Path

SAVEDATA_DIR = Path(__file__).resolve().parent.parent / "savedata"
SAVEDATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = SAVEDATA_DIR / "bot.db"

# A single, shared connection for the entire bot process (opening new connections for every request is expensive and doesn't make sense).
_db: aiosqlite.Connection | None = None

# Locks the database until the query is completed. This ensures sequential access, which prevents "database is locked" errors.
_db_lock = asyncio.Lock()


async def _connect() -> aiosqlite.Connection:
    global _db
    if _db is None:
        _db = await aiosqlite.connect(DB_PATH)
        await ensure_tables(_db)
    return _db


async def close_db():
    global _db
    async with _db_lock:
        if _db is not None:
            await _db.close()
            _db = None


# FORCE TABLE CREATION
async def ensure_tables(db):
    # Settings are keyed by (category, key), where category doubles as the
    # plugin's namespace — a plugin declaring a common key like "channel_id"
    # must not collide with another plugin doing the same.
    await db.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            category TEXT NOT NULL DEFAULT 'Main',
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (category, key)
        )
    """)

    # One wallet per member, shared by every plugin that deals in currency.
    # It lives here rather than in a plugin's own database precisely because it
    # is shared: a shop plugin and a gambling plugin must see one balance, not
    # two. Balances are integers on purpose — money in floats is a bug waiting.
    await db.execute("""
        CREATE TABLE IF NOT EXISTS wallets (
            user_id INTEGER PRIMARY KEY,
            balance INTEGER NOT NULL DEFAULT 0
        )
    """)

    await db.commit()


# First-run seeding, not a migration: `make start` writes a generated Lavalink
# password into .env, and this is how it reaches the music plugin's settings.
# Without it music would not work on a fresh install. Each entry is
# (env var, plugin_id, key); an unset variable is skipped, and a value already
# set from the dashboard is never overwritten.
ENV_SEEDS = [
    ("LAVALINK_PASSWORD", "music", "lavalink_password"),
    ("LAVALINK_URI", "music", "lavalink_uri"),
    ("YOUTUBE_OAUTH_REFRESH_TOKEN", "music", "youtube_oauth_refresh_token"),
]


async def seed_settings_from_env(db):
    for env_var, plugin_id, key in ENV_SEEDS:
        value = os.getenv(env_var)
        if not value:
            continue
        # Fill in a value that is missing *or* still blank: a placeholder row
        # created by a default should not shadow a real key sitting in .env.
        await db.execute(
            """
            INSERT INTO settings (category, key, value)
            VALUES (?, ?, ?)
            ON CONFLICT(category, key) DO UPDATE SET
                value = excluded.value
            WHERE settings.value = ''
            """,
            (plugin_id, key, value),
        )
    await db.commit()


# INIT DB
async def init_db():
    async with _db_lock:
        db = await _connect()
        await seed_settings_from_env(db)


# ---> SETTINGS
# GETTING SETTINGS
# category is optional for backwards compatibility: without it the first match
# for the key is returned regardless of namespace, which is only safe for the
# handful of globally-unique core keys (prefix, home_guild_id, module toggles).
async def get_settings(key: str, default: str | None = None, category: str | None = None) -> str | None:
    if category is None:
        query, params = "SELECT value FROM settings WHERE key = ? LIMIT 1", (key,)
    else:
        query, params = "SELECT value FROM settings WHERE category = ? AND key = ?", (category, key)

    async with _db_lock:
        db = await _connect()
        async with db.execute(query, params) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else default


# GETTING CATEGORY SETTINGS
async def get_settings_by_category(category: str = "Main") -> dict[str, str]:
    async with _db_lock:
        db = await _connect()
        async with db.execute(
            "SELECT key, value FROM settings WHERE category = ?",
            (category,),
        ) as cursor:
            rows = await cursor.fetchall()
            return {row[0]: row[1] for row in rows}


# SAVES CHANGES TO THE SETTINGS
async def set_settings(key: str, value: str, category: str = "Main"):
    async with _db_lock:
        db = await _connect()
        await db.execute(
            """
            INSERT INTO settings (category, key, value)
            VALUES (?, ?, ?)
            ON CONFLICT(category, key) DO UPDATE SET
                value = excluded.value
            """,
            (category, key, value),
        )
        await db.commit()


# ---> WALLETS
# Every write happens inside the shared lock and in a single statement, so two
# plugins spending at the same moment cannot both pass a "can they afford it?"
# check and leave the balance negative.

async def get_balance(user_id: int) -> int:
    """A member's balance. Someone with no wallet yet simply has nothing."""
    async with _db_lock:
        db = await _connect()
        async with db.execute("SELECT balance FROM wallets WHERE user_id = ?", (int(user_id),)) as cursor:
            row = await cursor.fetchone()
    return int(row[0]) if row else 0


async def add_balance(user_id: int, amount: int) -> int:
    """Credit a wallet, creating it if this is the member's first coin."""
    amount = int(amount)
    if amount <= 0:
        raise ValueError("add_balance expects a positive amount.")

    async with _db_lock:
        db = await _connect()
        await db.execute(
            "INSERT INTO wallets (user_id, balance) VALUES (?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET balance = balance + excluded.balance",
            (int(user_id), amount),
        )
        await db.commit()
        async with db.execute("SELECT balance FROM wallets WHERE user_id = ?", (int(user_id),)) as cursor:
            row = await cursor.fetchone()
    return int(row[0]) if row else amount


async def take_balance(user_id: int, amount: int) -> int | None:
    """Debit a wallet. Returns the new balance, or None if it could not pay.

    The guard is in the UPDATE itself rather than a read followed by a write:
    between those two a second plugin could spend the same coins.
    """
    amount = int(amount)
    if amount <= 0:
        raise ValueError("take_balance expects a positive amount.")

    async with _db_lock:
        db = await _connect()
        cursor = await db.execute(
            "UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND balance >= ?",
            (amount, int(user_id), amount),
        )
        if cursor.rowcount == 0:
            await db.rollback()
            return None
        await db.commit()
        async with db.execute("SELECT balance FROM wallets WHERE user_id = ?", (int(user_id),)) as check:
            row = await check.fetchone()
    return int(row[0]) if row else 0


async def transfer_balance(from_user_id: int, to_user_id: int, amount: int) -> bool:
    """Move currency between two wallets, or do nothing at all."""
    amount = int(amount)
    if amount <= 0:
        raise ValueError("transfer_balance expects a positive amount.")
    if int(from_user_id) == int(to_user_id):
        raise ValueError("A member cannot pay themselves.")

    async with _db_lock:
        db = await _connect()
        cursor = await db.execute(
            "UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND balance >= ?",
            (amount, int(from_user_id), amount),
        )
        if cursor.rowcount == 0:
            await db.rollback()
            return False
        await db.execute(
            "INSERT INTO wallets (user_id, balance) VALUES (?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET balance = balance + excluded.balance",
            (int(to_user_id), amount),
        )
        await db.commit()
    return True


async def top_balances(limit: int | None = 10, include_empty: bool = False) -> list[tuple[int, int]]:
    """Wallets as (user_id, balance), richest first.

    `limit=None` returns the whole table, which is what a plugin building its
    own ranking wants. Empty wallets are left out by default: a member who has
    never earned anything has a row only because something once read their
    balance, and a leaderboard of zeros is noise.
    """
    query = "SELECT user_id, balance FROM wallets"
    params: list = []
    if not include_empty:
        query += " WHERE balance > 0"
    query += " ORDER BY balance DESC, user_id ASC"
    if limit is not None:
        query += " LIMIT ?"
        params.append(max(1, int(limit)))

    async with _db_lock:
        db = await _connect()
        async with db.execute(query, tuple(params)) as cursor:
            rows = await cursor.fetchall()
    return [(int(user_id), int(balance)) for user_id, balance in rows]


async def set_balance(user_id: int, amount: int) -> int:
    """Overwrite a balance outright. For corrections, not for gameplay."""
    amount = max(0, int(amount))
    async with _db_lock:
        db = await _connect()
        await db.execute(
            "INSERT INTO wallets (user_id, balance) VALUES (?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET balance = excluded.balance",
            (int(user_id), amount),
        )
        await db.commit()
    return amount
