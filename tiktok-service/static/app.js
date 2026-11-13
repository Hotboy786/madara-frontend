'use strict';
const $ = s => document.querySelector(s);
const client = crypto.randomUUID();
let token = '', refreshToken = '', refreshAt = 0, refreshPromise;
let accounts = [], active = null, filter = '', mode = 'add', busy = false, imageURL = '', toastTimer, frameTimer, streamGeneration = 0;
let embeddedVisible = true;
let blockedAccount = null;
const takeoverButton = document.createElement('button');
takeoverButton.id = 'takeover'; takeoverButton.className = 'secondary';
takeoverButton.textContent = 'Take control'; takeoverButton.hidden = true;
$('#save').after(takeoverButton);
function blocked(id, error) {
  if (error.status !== 409) return;
  blockedAccount = id; takeoverButton.hidden = false;
}
document.addEventListener('visibilitychange', () => {
  streamGeneration++; clearTimeout(frameTimer);
  if (!document.hidden && active && !busy) pollFrame();
});
window.addEventListener('pagehide', () => {
  streamGeneration++; clearTimeout(frameTimer);
  if (token) fetch('/api/release', {method:'POST',keepalive:true,
    headers:{'Authorization':'Bearer '+token,'X-Client-ID':client}}).catch(() => {});
});
window.addEventListener('message', event => {
  if (window.parent === window || event.source !== window.parent || event.data?.type !== 'madara-tiktok-visibility') return;
  embeddedVisible = event.data.visible === true;
  if (!embeddedVisible) { streamGeneration++; clearTimeout(frameTimer); }
  else if (active && !busy) selectAccount(active);
});
const escapeHTML = value => String(value).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 9000); }
function session(value) { token = value.access_token; refreshToken = value.refresh_token; refreshAt = Date.now() + Math.max(1, value.expires_in - 90) * 1000; }
async function refresh() {
  if (Date.now() < refreshAt) return;
  if (!refreshPromise) refreshPromise = fetch('/api/refresh', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({refresh_token:refreshToken}) }).then(async r => {
    if (!r.ok) throw Error('Panel session expired. Sign in again.'); session(await r.json());
  }).finally(() => { refreshPromise = null; });
  await refreshPromise;
}
async function api(path, data, raw = false) {
  await refresh();
  const response = await fetch('/api/' + path, { method:data === undefined ? 'GET':'POST', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json','X-Client-ID':client}, ...(data === undefined ? {} : {body:JSON.stringify(data)}) });
  if (!response.ok) { const value = await response.json().catch(() => ({})); const error = Error(value.detail || 'Request failed'); error.status = response.status; throw error; }
  return raw ? response.blob() : response.json();
}
async function loadAccounts() {
  const value = await api('accounts'); accounts = value.accounts; $('#member').textContent = value.email; render();
}
function render() {
  $('#count').textContent = accounts.length + ' / 20';
  $('#add').disabled = accounts.length >= 20;
  $('#accounts').innerHTML = accounts.filter(a => [a.name,a.handle,a.notes].join(' ').toLowerCase().includes(filter)).map((a, i) => `<button class="account ${active === a.id ? 'selected':''}" data-id="${a.id}"><span class="avatar">${String(i+1).padStart(2,'0')}</span><span><strong>${escapeHTML(a.name)}</strong><small>${escapeHTML(a.handle || (a.saved_at ? 'Profile saved':'First login needed'))}</small></span></button>`).join('') || '<p class="small">No accounts here yet.</p>';
  const row = accounts.find(a => a.id === active); $('#title').textContent = row ? row.name : 'Choose an account';
  $('#subtitle').textContent = row ? (row.saved_at ? 'Last backup: ' + new Date(row.saved_at).toLocaleString() : 'Sign in on TikTok, then save this profile.') : 'Add a TikTok account to get started.';
  $('#edit').disabled = !row;
}
function controls(enabled) { document.querySelectorAll('[data-nav],#save').forEach(b => b.disabled = !enabled); $('#inputbar').hidden = !enabled; }
async function selectAccount(id, takeControl = false) {
  if (busy) return; busy = true; streamGeneration++; clearTimeout(frameTimer); controls(false); $('#status').textContent = 'Opening profile…';
  $('#screen').hidden = true; $('#empty').hidden = false; $('#empty').textContent = 'Saving previous profile and opening this account…';
  try {
    await api(takeControl ? 'takeover' : 'open', {id}); active = id; blockedAccount = null; takeoverButton.hidden = true; await loadAccounts(); $('#empty').hidden = true; controls(true); $('#screen').hidden = false; $('#status').textContent = 'Browser open · login status not checked'; await pollFrame();
  } catch (e) { blocked(id, e); active = null; render(); $('#status').textContent = 'Could not open'; $('#empty').textContent = e.message; toast(e.message); }
  finally { busy = false; }
}
async function pollFrame(generation = streamGeneration) {
  if (!active || !token || !embeddedVisible || document.hidden) return;
  const id = active;
  try {
    const blob = await api('frame/' + id, undefined, true); if (active !== id || generation !== streamGeneration || !embeddedVisible) return;
    const next = URL.createObjectURL(blob); $('#screen').src = next; if (imageURL) URL.revokeObjectURL(imageURL); imageURL = next;
  } catch(e) {
    if (generation !== streamGeneration) return;
    if (e.status === 409 || e.status === 401) { blocked(id, e); active = null; controls(false); $('#screen').hidden = true; $('#empty').hidden = false; $('#empty').textContent = e.message; render(); toast(e.message); return; }
    $('#status').textContent = 'Connection interrupted · retrying';
  }
  if (generation === streamGeneration) frameTimer = setTimeout(() => pollFrame(generation), document.hidden ? 8000 : 1600);
}
takeoverButton.onclick = () => {
  if (!blockedAccount || busy) return;
  if (window.confirm('Take control of the shared browser? The other tab or person will lose control. TikTok will remain signed in.')) selectAccount(blockedAccount, true);
};
async function action(data) {
  if (!active || busy) return;
  try { await api('action', {id:active,...data}); } catch(e) { toast(e.message); }
}
$('#loginForm').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; $('#loginError').textContent = '';
  try {
    const response = await fetch('/api/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('#email').value,password:$('#password').value})});
    const value = await response.json(); if (!response.ok) throw Error(value.detail || 'Sign-in failed'); session(value); $('#password').value = ''; await loadAccounts(); $('#loginScreen').hidden = true; $('#workspace').hidden = false;
  } catch(e) { $('#loginError').textContent = e.message; } finally { button.disabled = false; }
};
function showAdd() { mode = 'add'; $('#dialogTitle').textContent = 'Add TikTok account'; $('#dialogHelp').textContent = 'Name this space, then sign in on TikTok inside its browser.'; $('#accountName').value = ''; $('#extraFields').hidden = true; $('#submitDetails').textContent = 'Add account'; $('#dialog').showModal(); }
$('#add').onclick = showAdd; $('#emptyAdd').onclick = showAdd;
$('#cancel').onclick = () => $('#dialog').close();
$('#edit').onclick = () => { const row = accounts.find(a => a.id === active); if (!row) return; mode = 'edit'; $('#dialogTitle').textContent = 'Edit account'; $('#dialogHelp').textContent = 'Your changes are shared with workspace members.'; $('#accountName').value = row.name; $('#handle').value = row.handle; $('#notes').value = row.notes; $('#extraFields').hidden = false; $('#submitDetails').textContent = 'Save details'; $('#dialog').showModal(); };
$('#detailsForm').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const row = mode === 'add' ? await api('accounts', {name:$('#accountName').value}) : await api('details',{id:active,name:$('#accountName').value,handle:$('#handle').value,notes:$('#notes').value});
    $('#dialog').close(); await loadAccounts(); if (mode === 'add') await selectAccount(row.id);
  } catch(e) { toast(e.message); } finally { button.disabled = false; }
};
$('#search').oninput = event => { filter = event.target.value.toLowerCase(); render(); };
$('#accounts').onclick = event => { const b = event.target.closest('[data-id]'); if(b) selectAccount(b.dataset.id); };
document.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => action(b.dataset.nav === 'back' ? {action:'back'} : {action:'navigate',target:b.dataset.nav}));
document.querySelectorAll('[data-key]').forEach(b => b.onclick = () => action({action:'key',key:b.dataset.key}));
$('#screen').onclick = event => { const bounds = event.target.getBoundingClientRect(); action({action:'click',x:(event.clientX-bounds.left)*1280/bounds.width,y:(event.clientY-bounds.top)*800/bounds.height}); };
$('#screen').addEventListener('wheel',event => { event.preventDefault(); action({action:'scroll',delta:Math.max(-1800,Math.min(1800,event.deltaY))}); },{passive:false});
let keyboardQueue = Promise.resolve();
$('#screen').onkeydown = event => {
  const special = ['Enter','Tab','Backspace','Delete','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
  let value;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') value = {action:'key',key:'Control+A'};
  else if (special.includes(event.key)) value = {action:'key',key:event.key === 'Tab' && event.shiftKey ? 'Shift+Tab':event.key};
  else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) value = {action:'text',text:event.key};
  if (value) { event.preventDefault(); keyboardQueue = keyboardQueue.then(() => action(value)); }
};
$('#screen').onpaste = event => { event.preventDefault(); action({action:'text',text:event.clipboardData.getData('text')}); };
async function sendText() { const text = $('#remoteText').value; if (!text) return; $('#remoteText').value = ''; await action({action:'text',text}); }
$('#sendText').onclick = sendText; $('#remoteText').onkeydown = event => { if(event.key === 'Enter') { event.preventDefault(); sendText(); } };
$('#save').onclick = async () => {
  if (busy || !active) return; busy = true; streamGeneration++; clearTimeout(frameTimer); controls(false); $('#status').textContent = 'Saving encrypted profile…';
  try { await api('save',{id:active}); active = null; $('#screen').hidden = true; $('#empty').hidden = false; $('#empty').textContent = 'Profile saved to Supabase. Choose an account to continue.'; $('#status').textContent = 'Saved · browser released'; await loadAccounts(); toast('Profile saved. Your teammate can now use the browser.'); }
  catch(e) { toast(e.message); $('#status').textContent = 'Backup failed · retry Save'; $('#save').disabled = false; }
  finally { busy = false; }
};
$('#logout').onclick = async () => {
  if (busy) return;
  if (active) { try { await api('save',{id:active}); } catch(e) { toast('Could not save profile before sign-out: '+e.message); return; } }
  clearTimeout(frameTimer); token = ''; refreshToken = ''; active = null; accounts = []; if(imageURL) URL.revokeObjectURL(imageURL); location.reload();
};
