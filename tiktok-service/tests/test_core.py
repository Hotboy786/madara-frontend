"""Unit checks; browser/cloud interactions are mocked, not integration-tested."""
import asyncio
import importlib
import io
import json
import sys
import tarfile
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# Core tests do not launch or install Chromium.
if 'playwright.async_api' not in sys.modules:
    sys.modules['playwright'] = types.ModuleType('playwright')
    stub = types.ModuleType('playwright.async_api')
    stub.async_playwright = lambda: None
    sys.modules['playwright.async_api'] = stub
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
import httpx
import app as module
from vault import pack_profile, unpack_profile

class VaultTests(unittest.TestCase):
    def test_roundtrip_and_cache_exclusion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original = root / 'original'
            (original/'Default/Cache').mkdir(parents=True)
            (original/'Default/Cookies').write_bytes(b'secret-session')
            (original/'Default/Cache/trash').write_bytes(b'not-needed')
            key = Fernet.generate_key().decode()
            payload = pack_profile(original, key)
            self.assertNotIn(b'secret-session', payload)
            unpack_profile(payload, root/'restored', key)
            self.assertEqual((root/'restored/Default/Cookies').read_bytes(), b'secret-session')
            self.assertFalse((root/'restored/Default/Cache').exists())
            with self.assertRaises(InvalidToken):
                unpack_profile(payload, root/'wrong', Fernet.generate_key().decode())

    def test_path_traversal_rejected(self):
        key = Fernet.generate_key()
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
            member = tarfile.TarInfo('../escape')
            member.size = 1
            archive.addfile(member, io.BytesIO(b'x'))
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                unpack_profile(Fernet(key).encrypt(buffer.getvalue()), Path(tmp), key.decode())

class BrowserTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_takeover_blocks_previous_tab_without_closing_browser(self):
        browser = module.Browser(None)
        existing_context = object()
        browser.context = existing_context
        browser.claim({'id':'owner'}, 'old-tab')
        browser.claim({'id':'owner'}, 'new-tab', takeover=True)
        self.assertEqual(browser.holder, ('owner','new-tab'))
        self.assertIs(browser.context, existing_context)
        with self.assertRaises(HTTPException):
            browser.claim({'id':'owner'}, 'old-tab')

    async def test_control_lease(self):
        browser = module.Browser(None)
        browser.claim({'id':'one'}, 'tab-one')
        with self.assertRaises(HTTPException) as caught:
            browser.claim({'id':'two'}, 'tab-two')
        self.assertEqual(caught.exception.status_code, 409)
        browser.lease_until = 0
        browser.claim({'id':'two'}, 'tab-two')
        self.assertEqual(browser.holder, ('two','tab-two'))

    async def test_failed_backup_blocks_switch_and_retries(self):
        store = types.SimpleNamespace(backup=AsyncMock(side_effect=RuntimeError('offline')))
        browser = module.Browser(store)
        context = types.SimpleNamespace(close=AsyncMock())
        ident = str(uuid4())
        browser.context = context
        browser.active = ident
        with self.assertRaises(RuntimeError):
            await browser.open({'id':str(uuid4())})
        self.assertEqual(browser.pending, ident)
        self.assertIsNone(browser.context)
        context.close.assert_awaited_once()
        store.backup.side_effect = None
        await browser.flush()
        self.assertIsNone(browser.pending)
        self.assertIsNone(browser.active)

    async def test_backup_upload_before_pointer_update(self):
        store = module.Store()
        events = []
        async def call(method, path, **kwargs):
            events.append(method)
            return httpx.Response(200, json={})
        store.call = call
        store.account = AsyncMock(return_value={'profile_key':'old/key.enc'})
        async def update(ident, values):
            events.append('PATCH')
            return values
        store.patch = update
        try:
            with tempfile.TemporaryDirectory() as tmp, patch.object(module,'ENCRYPTION',Fernet.generate_key().decode()):
                Path(tmp, 'Cookies').write_bytes(b'cookie')
                await store.backup(str(uuid4()), Path(tmp))
            self.assertEqual(events, ['POST','PATCH','DELETE'])
        finally:
            await store.http.aclose()

class AccessTests(unittest.IsolatedAsyncioTestCase):
    async def test_embedding_only_when_explicitly_allowed(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=module.app),base_url='http://test') as client:
            with patch.object(module,'EMBED_ORIGINS',[]):
                response = await client.get('/')
                self.assertEqual(response.headers['x-frame-options'],'DENY')
                self.assertIn("frame-ancestors 'none'", response.headers['content-security-policy'])
            with patch.object(module,'EMBED_ORIGINS',['https://panel.example.com']):
                response = await client.get('/')
                self.assertNotIn('x-frame-options',response.headers)
                self.assertIn('frame-ancestors https://panel.example.com;',response.headers['content-security-policy'])

    async def test_unauthenticated_and_unapproved_users_rejected(self):
        settings = {'SB_URL':'https://example.supabase.co','ANON':'anon','SERVICE':'server',
                    'ENCRYPTION':Fernet.generate_key().decode(),'ALLOWED':{'approved@example.com'}}
        with patch.multiple(module, **settings), tempfile.TemporaryDirectory() as tmp, patch.object(module,'PROFILE_ROOT',Path(tmp)):
            async with module.lifespan(module.app):
                transport = httpx.ASGITransport(app=module.app)
                async with httpx.AsyncClient(transport=transport,base_url='http://test') as client:
                    response = await client.get('/api/accounts')
                    self.assertEqual(response.status_code,401)
                    module.app.state.store.http.get = AsyncMock(return_value=httpx.Response(200,json={
                        'id':'other','email':'other@example.com','email_confirmed_at':'2026-01-01'}))
                    response = await client.get('/api/accounts',headers={'Authorization':'Bearer valid-but-not-approved'})
                    self.assertEqual(response.status_code,403)
                    self.assertEqual(response.headers['x-frame-options'],'DENY')

    async def test_account_limit(self):
        with patch.object(module,'user',AsyncMock(return_value={'id':'approved'})):
            module.app.state.browser = module.Browser(None)
            module.app.state.store = types.SimpleNamespace(accounts=AsyncMock(return_value=[{}]*20))
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=module.app),base_url='http://test') as client:
                response = await client.post('/api/accounts',json={'name':'Twenty-first'})
                self.assertEqual(response.status_code,400)

if __name__ == '__main__':
    unittest.main(verbosity=2)
