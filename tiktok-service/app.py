import asyncio
import hashlib
import ipaddress
import logging
import os
import secrets
import shutil
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID, uuid4

import httpx
from cryptography.fernet import Fernet
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from playwright.async_api import async_playwright
from vault import pack_profile, unpack_profile

ROOT = Path(__file__).resolve().parent
PROFILE_ROOT = Path(os.getenv('PROFILE_ROOT', '/tmp/tiktok-profiles')).resolve()
SB_URL = os.getenv('SUPABASE_URL', '').rstrip('/')
ANON = os.getenv('SUPABASE_ANON_KEY', '')
SERVICE = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
ENCRYPTION = os.getenv('PROFILE_ENCRYPTION_KEY', '')
ALLOWED = {x.strip().lower() for x in os.getenv('ALLOWED_EMAILS', '').split(',') if x.strip()}
EMBED_ORIGINS = []
for candidate in os.getenv('ALLOWED_EMBED_ORIGINS', '').split(','):
    candidate = candidate.strip().rstrip('/')
    parsed = urlparse(candidate)
    if parsed.scheme == 'https' and parsed.netloc and not parsed.username and not parsed.password and not parsed.path and not parsed.query and not parsed.fragment:
        EMBED_ORIGINS.append(candidate)
DESTINATIONS = {'login': 'https://www.tiktok.com/login', 'home': 'https://www.tiktok.com/',
                'upload': 'https://www.tiktok.com/tiktokstudio/upload'}
log = logging.getLogger('studio')

def configured():
    return bool(SB_URL.startswith('https://') and ANON and SERVICE and ENCRYPTION and ALLOWED)

def account_id(value):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError):
        raise HTTPException(400, 'Invalid account ID')

def utcnow():
    return datetime.now(timezone.utc).isoformat()

class Store:
    def __init__(self):
        self.http = httpx.AsyncClient(timeout=60)

    async def call(self, method, path, *, auth=None, raw=None, **kwargs):
        headers = {'apikey': ANON if auth else SERVICE,
                   'Authorization': 'Bearer ' + (auth or SERVICE)}
        headers.update(kwargs.pop('headers', {}))
        response = await self.http.request(method, SB_URL + path, headers=headers,
                                           content=raw, **kwargs)
        if not response.is_success:
            # No upstream bodies in errors: they may contain sensitive values.
            log.warning('Supabase request failed: status=%s', response.status_code)
            raise HTTPException(502, 'Supabase request failed. Check the service configuration.')
        return response

    async def accounts(self):
        return (await self.call('GET', '/rest/v1/studio_accounts?select=*&order=created_at.asc')).json()

    async def account(self, ident):
        rows = (await self.call('GET', f'/rest/v1/studio_accounts?id=eq.{ident}&select=*')).json()
        if not rows:
            raise HTTPException(404, 'Account not found')
        return rows[0]

    async def patch(self, ident, values):
        return (await self.call('PATCH', f'/rest/v1/studio_accounts?id=eq.{ident}',
                json=values, headers={'Prefer': 'return=representation'})).json()[0]

    async def backup(self, ident, folder):
        payload = await asyncio.to_thread(pack_profile, folder, ENCRYPTION)
        key = f'{ident}/{uuid4()}.enc'
        old = (await self.account(ident)).get('profile_key')
        await self.call('POST', '/storage/v1/object/tiktok-profiles/' + key,
                        raw=payload, headers={'Content-Type': 'application/octet-stream'})
        # Point to the new object only after upload succeeds.
        row = await self.patch(ident, {'profile_key': key, 'saved_at': utcnow()})
        if old:
            try:
                await self.call('DELETE', '/storage/v1/object/tiktok-profiles', json={'prefixes': [old]})
            except Exception:
                log.warning('Old backup cleanup failed; current backup is intact.')
        return row

    async def restore(self, row, folder):
        if row.get('profile_key'):
            response = await self.call('GET', '/storage/v1/object/authenticated/tiktok-profiles/' + row['profile_key'])
            await asyncio.to_thread(unpack_profile, response.content, folder, ENCRYPTION)

class Browser:
    def __init__(self, store):
        self.store = store
        self.lock = asyncio.Lock()
        self.context = None
        self.page = None
        self.active = None
        self.holder = None
        self.lease_until = 0
        self.last_use = time.monotonic()
        self.pending = None
        self.playwright = None
        self.dns_cache = {}

    def claim(self, user, client, *, takeover=False):
        if not client or len(client) > 80:
            raise HTTPException(400, 'Missing browser client ID')
        identity = (user['id'], client)
        now = time.monotonic()
        if not takeover and self.holder and self.holder != identity and now < self.lease_until:
            raise HTTPException(409, 'The browser is being used in another panel. Ask them to release it, or wait 90 seconds after they disconnect.')
        self.holder = identity
        self.lease_until = now + 90
        self.last_use = now

    def current(self, ident):
        if self.active != ident or not self.context:
            raise HTTPException(409, 'This account is not open. Select it again.')

    async def public_route(self, route):
        url = route.request.url
        parts = urlparse(url)
        if parts.scheme not in ('http', 'https'):
            return await route.continue_() if parts.scheme in ('data', 'blob', 'about') else await route.abort()
        host = parts.hostname or ''
        if parts.port not in (None, 80, 443):
            return await route.abort()
        try:
            if host not in self.dns_cache:
                addresses = await asyncio.get_running_loop().getaddrinfo(host, None)
                self.dns_cache[host] = bool(addresses) and all(ipaddress.ip_address(a[4][0]).is_global for a in addresses)
            if not self.dns_cache[host]:
                return await route.abort()
        except (OSError, ValueError):
            return await route.abort()
        await route.continue_()

    async def flush(self):
        if self.context:
            self.pending = self.active
            context = self.context
            self.context = None
            self.page = None
            await context.close()
        if self.pending:
            await self.store.backup(self.pending, PROFILE_ROOT / self.pending)
            self.pending = None
        self.active = None

    async def open(self, row):
        ident = row['id']
        if self.active == ident and self.context:
            return
        await self.flush()  # Fail closed if the previous profile cannot be saved.
        folder = PROFILE_ROOT / ident
        if not folder.exists():
            try:
                await self.store.restore(row, folder)
            except Exception:
                if folder.exists():
                    await asyncio.to_thread(shutil.rmtree, folder)
                raise
        folder.mkdir(parents=True, exist_ok=True)
        if not self.playwright:
            self.playwright = await async_playwright().start()
        self.context = await self.playwright.chromium.launch_persistent_context(
            str(folder), headless=True, viewport={'width': 1280, 'height': 800},
            accept_downloads=False, service_workers='block',
            args=['--disable-dev-shm-usage', '--password-store=basic', '--disable-quic',
                  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'])
        self.active = ident
        await self.context.route('**/*', self.public_route)
        self.page = self.context.pages[0] if self.context.pages else await self.context.new_page()
        await self.navigate('home' if row.get('saved_at') else 'login')

    async def navigate(self, target):
        if target not in DESTINATIONS:
            raise HTTPException(400, 'Unknown destination')
        try:
            await self.page.goto(DESTINATIONS[target], wait_until='domcontentloaded', timeout=30000)
        except Exception:
            # Screenshot can still show a slow-loading page; do not mark it logged in.
            log.info('Page navigation did not finish within the initial load period.')

    async def frame(self):
        if self.page.is_closed():
            pages = [p for p in self.context.pages if not p.is_closed()]
            self.page = pages[-1] if pages else await self.context.new_page()
        # OAuth popups open within this same account context.
        pages = [p for p in self.context.pages if not p.is_closed()]
        if pages:
            self.page = pages[-1]
        return await self.page.screenshot(type='jpeg', quality=65, timeout=12000)

    async def idle(self):
        while True:
            await asyncio.sleep(20)
            if (self.context or self.pending) and time.monotonic() - self.last_use > 120:
                try:
                    async with self.lock:
                        if time.monotonic() - self.last_use > 120:
                            await self.flush()
                            self.holder = None
                except Exception:
                    log.warning('Idle backup failed. Profile retained locally for retry.')

@asynccontextmanager
async def lifespan(app):
    if configured():
        Fernet(ENCRYPTION.encode())
    PROFILE_ROOT.mkdir(parents=True, exist_ok=True)
    app.state.store = Store()
    app.state.browser = Browser(app.state.store)
    app.state.auth_cache = {}
    task = asyncio.create_task(app.state.browser.idle())
    yield
    task.cancel()
    try:
        async with app.state.browser.lock:
            await app.state.browser.flush()
    except Exception:
        log.warning('Shutdown backup failed; the last successful cloud backup remains available.')
    if app.state.browser.playwright:
        await app.state.browser.playwright.stop()
    await app.state.store.http.aclose()

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

@app.middleware('http')
async def security(request: Request, call_next):
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    if not EMBED_ORIGINS:
        response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    ancestors = ' '.join(EMBED_ORIGINS) if EMBED_ORIGINS else "'none'"
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors " + ancestors + "; base-uri 'none'; form-action 'self'"
    return response

async def user(request):
    if not configured():
        raise HTTPException(503, 'Hosting setup is incomplete. Follow README.md to connect Supabase.')
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer ') or len(auth) > 10000:
        raise HTTPException(401, 'Sign in to the panel first')
    token = auth[7:]
    digest = hashlib.sha256(token.encode()).hexdigest()
    cache = app.state.auth_cache
    if digest in cache and cache[digest][0] > time.monotonic():
        return cache[digest][1]
    response = await app.state.store.http.get(SB_URL + '/auth/v1/user',
                      headers={'apikey': ANON, 'Authorization': auth})
    if response.status_code != 200:
        raise HTTPException(401, 'Panel login expired. Sign in again.')
    identity = response.json()
    if identity.get('email', '').lower() not in ALLOWED or not identity.get('email_confirmed_at'):
        raise HTTPException(403, 'This email is not an approved workspace member.')
    now = time.monotonic()
    app.state.auth_cache = {k: v for k, v in cache.items() if v[0] > now}
    app.state.auth_cache[digest] = (now + 30, identity)
    return identity

async def body(request):
    raw = await request.body()
    if len(raw) > 12000:
        raise HTTPException(413, 'Request too large')
    try:
        import json
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, TypeError):
        raise HTTPException(400, 'Invalid request')

@app.get('/')
async def home():
    return FileResponse(ROOT / 'static' / 'index.html')

@app.get('/health')
async def health():
    return {'ok': True, 'configured': configured()}

@app.post('/api/login')
async def login(request: Request):
    if not configured():
        raise HTTPException(503, 'Connect Supabase and set the hosting environment variables first.')
    data = await body(request)
    email = str(data.get('email', '')).strip().lower()
    if email not in ALLOWED:
        raise HTTPException(401, 'Sign-in failed. Check your email and password.')
    response = await app.state.store.http.post(SB_URL + '/auth/v1/token?grant_type=password',
               headers={'apikey': ANON}, json={'email': email, 'password': str(data.get('password', ''))})
    if response.status_code != 200:
        raise HTTPException(401, 'Sign-in failed. Check your email and password.')
    value = response.json()
    return {key: value[key] for key in ('access_token', 'refresh_token', 'expires_in')}

@app.post('/api/refresh')
async def refresh(request: Request):
    if not configured():
        raise HTTPException(503, 'Setup incomplete')
    data = await body(request)
    response = await app.state.store.http.post(SB_URL + '/auth/v1/token?grant_type=refresh_token',
               headers={'apikey': ANON}, json={'refresh_token': str(data.get('refresh_token', ''))})
    if response.status_code != 200:
        raise HTTPException(401, 'Sign in again')
    value = response.json()
    return {key: value[key] for key in ('access_token', 'refresh_token', 'expires_in')}

def public_account(row):
    return {k: v for k, v in row.items() if k != 'profile_key'}

@app.get('/api/accounts')
async def accounts(request: Request):
    identity = await user(request)
    return {'accounts': [public_account(a) for a in await app.state.store.accounts()], 'email': identity['email']}

@app.post('/api/accounts')
async def add_account(request: Request):
    await user(request)
    data = await body(request)
    name = str(data.get('name', '')).strip()
    if not 1 <= len(name) <= 60:
        raise HTTPException(400, 'Choose an account name, up to 60 characters.')
    async with app.state.browser.lock:
        if len(await app.state.store.accounts()) >= 20:
            raise HTTPException(400, 'This workspace supports 20 saved accounts.')
        response = await app.state.store.call('POST', '/rest/v1/studio_accounts', json={'name': name},
                                             headers={'Prefer': 'return=representation'})
        return public_account(response.json()[0])

@app.post('/api/details')
async def details(request: Request):
    await user(request)
    data = await body(request)
    ident = account_id(data.get('id'))
    values = {}
    for key, limit in [('name', 60), ('handle', 60), ('notes', 2000)]:
        if key in data:
            if not isinstance(data[key], str) or len(data[key]) > limit or (key == 'name' and not data[key].strip()):
                raise HTTPException(400, 'Invalid account details')
            values[key] = data[key].strip()
    if not values:
        raise HTTPException(400, 'No details supplied')
    await app.state.store.account(ident)
    return public_account(await app.state.store.patch(ident, values))

@app.post('/api/open')
async def open_account(request: Request):
    identity = await user(request)
    ident = account_id((await body(request)).get('id'))
    browser = app.state.browser
    async with browser.lock:
        browser.claim(identity, request.headers.get('X-Client-ID'))
        await browser.open(await app.state.store.account(ident))
    return {'id': ident}

@app.get('/api/frame/{ident}')
async def frame(ident: str, request: Request):
    identity = await user(request)
    ident = account_id(ident)
    browser = app.state.browser
    async with browser.lock:
        browser.claim(identity, request.headers.get('X-Client-ID'))
        browser.current(ident)
        image = await browser.frame()
    return Response(image, media_type='image/jpeg')

@app.post('/api/takeover')
async def takeover(request: Request):
    identity = await user(request)
    ident = account_id((await body(request)).get('id'))
    browser = app.state.browser
    row = await app.state.store.account(ident)
    async with browser.lock:
        browser.claim(identity, request.headers.get('X-Client-ID'), takeover=True)
        await browser.open(row)
    return {'id': ident}

@app.post('/api/release')
async def release(request: Request):
    identity = await user(request)
    browser = app.state.browser
    async with browser.lock:
        if browser.holder == (identity['id'], request.headers.get('X-Client-ID')):
            browser.holder = None
            browser.lease_until = 0
    return {'ok': True}

@app.post('/api/action')
async def action(request: Request):
    identity = await user(request)
    data = await body(request)
    ident = account_id(data.get('id'))
    browser = app.state.browser
    async with browser.lock:
        browser.claim(identity, request.headers.get('X-Client-ID'))
        browser.current(ident)
        kind = data.get('action')
        if kind == 'click':
            x, y = data.get('x'), data.get('y')
            if type(x) not in (int, float) or type(y) not in (int, float) or not (0 <= x <= 1280 and 0 <= y <= 800):
                raise HTTPException(400, 'Invalid click')
            await browser.page.mouse.click(x, y)
        elif kind == 'text':
            text = data.get('text')
            if not isinstance(text, str) or len(text) > 4000:
                raise HTTPException(400, 'Text too long')
            await browser.page.keyboard.insert_text(text)
        elif kind == 'key':
            key = data.get('key')
            if key not in {'Enter', 'Tab', 'Shift+Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Control+A', 'Space'}:
                raise HTTPException(400, 'Unsupported key')
            await browser.page.keyboard.press(key)
        elif kind == 'scroll':
            delta = data.get('delta')
            if type(delta) not in (int, float) or not -2000 <= delta <= 2000:
                raise HTTPException(400, 'Invalid scroll')
            await browser.page.mouse.wheel(0, delta)
        elif kind == 'navigate':
            await browser.navigate(data.get('target'))
        elif kind == 'back':
            await browser.page.go_back(wait_until='domcontentloaded', timeout=20000)
        else:
            raise HTTPException(400, 'Unknown action')
    return {'ok': True}

@app.post('/api/save')
async def save(request: Request):
    identity = await user(request)
    ident = account_id((await body(request)).get('id'))
    browser = app.state.browser
    async with browser.lock:
        browser.claim(identity, request.headers.get('X-Client-ID'))
        if browser.active != ident and browser.pending != ident:
            raise HTTPException(409, 'Select this account first')
        await browser.flush()
        browser.holder = None
    return {'ok': True, 'message': 'Profile backed up. Select an account to continue.'}

@app.exception_handler(Exception)
async def unexpected(request, exc):
    log.error('Request failed (%s).', type(exc).__name__)
    return JSONResponse({'detail': 'The browser action failed. Retry, or check the host logs and memory limits.'}, status_code=500)

app.mount('/static', StaticFiles(directory=ROOT / 'static'), name='static')
