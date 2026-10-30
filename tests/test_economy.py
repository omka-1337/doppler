import asyncio
import logging
from types import SimpleNamespace

import pytest

from dopplerbot import database
from dopplerbot.plugins.api import EconomyAccess, EconomyError, InsufficientFunds

ALICE, BOB, CAROL = 101, 202, 303


@pytest.fixture(autouse=True)
async def fresh_db(tmp_path, monkeypatch):
    """A database of its own for every test, and a lock for this test's loop."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "bot.db")
    monkeypatch.setattr(database, "_db", None)
    monkeypatch.setattr(database, "_db_lock", asyncio.Lock())
    yield
    await database.close_db()


# --- the wallet table ----------------------------------------------------

async def test_no_wallet_means_nothing():
    assert await database.get_balance(ALICE) == 0


async def test_add_and_take():
    assert await database.add_balance(ALICE, 100) == 100
    assert await database.add_balance(ALICE, 50) == 150
    assert await database.take_balance(ALICE, 30) == 120
    assert await database.get_balance(ALICE) == 120


async def test_take_never_overdraws():
    await database.add_balance(ALICE, 10)
    assert await database.take_balance(ALICE, 11) is None
    assert await database.take_balance(BOB, 1) is None
    assert await database.get_balance(ALICE) == 10


@pytest.mark.parametrize("call", [
    lambda: database.add_balance(ALICE, 0),
    lambda: database.take_balance(ALICE, -5),
    lambda: database.transfer_balance(ALICE, BOB, 0),
    lambda: database.transfer_balance(ALICE, ALICE, 5),
])
async def test_rejects_meaningless_amounts(call):
    with pytest.raises(ValueError):
        await call()


async def test_transfer_is_all_or_nothing():
    await database.add_balance(ALICE, 50)

    assert await database.transfer_balance(ALICE, BOB, 20)
    assert (await database.get_balance(ALICE), await database.get_balance(BOB)) == (30, 20)

    assert not await database.transfer_balance(ALICE, BOB, 31)
    assert (await database.get_balance(ALICE), await database.get_balance(BOB)) == (30, 20)


async def test_set_balance_floors_at_zero():
    assert await database.set_balance(ALICE, 500) == 500
    assert await database.set_balance(ALICE, -3) == 0
    assert await database.get_balance(ALICE) == 0


async def test_concurrent_spending_cannot_overdraw():
    """Ten plugins spending 30 each from 100 at the same moment: three can pay."""
    await database.add_balance(ALICE, 100)
    results = await asyncio.gather(*(database.take_balance(ALICE, 30) for _ in range(10)))

    assert sum(r is not None for r in results) == 3
    assert await database.get_balance(ALICE) == 10


async def test_concurrent_transfers_conserve_money():
    await database.add_balance(ALICE, 100)
    await database.add_balance(BOB, 100)
    await asyncio.gather(*(
        database.transfer_balance(*pair, 7)
        for _ in range(20) for pair in ((ALICE, BOB), (BOB, ALICE), (ALICE, CAROL))
    ))
    balances = [await database.get_balance(u) for u in (ALICE, BOB, CAROL)]
    assert sum(balances) == 200
    assert min(balances) >= 0


async def test_top_balances():
    await database.set_balance(ALICE, 50)
    await database.set_balance(BOB, 80)
    await database.set_balance(CAROL, 50)
    await database.get_balance(404)  # a read creates nothing
    await database.set_balance(505, 0)

    assert await database.top_balances() == [(BOB, 80), (ALICE, 50), (CAROL, 50)]
    assert await database.top_balances(limit=1) == [(BOB, 80)]
    assert await database.top_balances(limit=None, include_empty=True) == [
        (BOB, 80), (ALICE, 50), (CAROL, 50), (505, 0),
    ]


# --- what plugins see: ctx.economy -----------------------------------------

class FakeBot:
    def __init__(self, *users):
        self._users = {u.id: u for u in users}

    def get_user(self, user_id):
        return self._users.get(user_id)


def member(user_id, bot=False):
    return SimpleNamespace(id=user_id, bot=bot)


@pytest.fixture
def economy():
    return EconomyAccess(FakeBot(member(ALICE), member(999, bot=True)), logging.getLogger("test"))


async def test_economy_accepts_members_and_ids(economy):
    await economy.add(member(ALICE), 40)
    await economy.add(ALICE, 2)
    assert await economy.balance(member(ALICE)) == 42


async def test_economy_take_raises_instead_of_none(economy):
    await economy.add(ALICE, 5)
    with pytest.raises(InsufficientFunds, match="Needed 10, has 5"):
        await economy.take(ALICE, 10)
    assert await economy.take(ALICE, 5) == 0


async def test_economy_transfer(economy):
    await economy.add(ALICE, 10)
    await economy.transfer(member(ALICE), BOB, 4)
    assert await economy.balance(BOB) == 4
    with pytest.raises(InsufficientFunds):
        await economy.transfer(ALICE, BOB, 100)


async def test_bots_have_no_wallets(economy):
    with pytest.raises(EconomyError, match="Bots"):
        await economy.add(member(1, bot=True), 5)
    # Known to the bot as a bot, even when passed as a bare id.
    with pytest.raises(EconomyError, match="Bots"):
        await economy.balance(999)


async def test_economy_needs_something_with_an_id(economy):
    with pytest.raises(EconomyError, match="Cannot work out"):
        await economy.balance("alice")


async def test_economy_top(economy):
    await economy.set(ALICE, 7)
    assert await economy.top() == [{"user_id": ALICE, "balance": 7}]


async def test_currency_defaults_and_settings(economy):
    assert await economy.currency() == {"symbol": "", "name": "coins"}
    await database.set_settings("currency_symbol", " <:gem:123> ", category="Main")
    await database.set_settings("currency_name", "gems", category="Main")
    assert await economy.currency() == {"symbol": "<:gem:123>", "name": "gems"}
