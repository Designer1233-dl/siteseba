(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const token = () => localStorage.getItem('lost-token') || '';
  const profile = () => { try { return JSON.parse(localStorage.getItem('lost-profile') || '{}'); } catch { return {}; } };
  const isAdmin = p => p && (p.role === 'admin' || String(p.username || '').toLowerCase() === 'vsevolod67');
  const setHeaderVerified = verified => { const sub = $('#headSub'); if (!sub) return; sub.parentElement.querySelector('.headVerified')?.remove(); if (verified) { const badge = document.createElement('span'); badge.className='headVerified verifiedMark'; badge.textContent='✓'; badge.title='Верифицировано'; sub.after(badge); } };
  const notifyEnabled = () => profile().notifications !== false;
  const toast = msg => window.toast ? window.toast(msg) : alert(msg);
  let messages = [], previousIds = new Set(), selectedImage = '', replyTo = null, initialized = false;
  const authHeaders = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });
  const originalFetch = window.fetch.bind(window);
  const fetchWithTimeout = (url, options={}, timeout=12000) => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
    return originalFetch(url, {...options, signal: controller.signal}).finally(() => clearTimeout(timer));
  };

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0].url;
      if (url.includes('/api/messages?with=')) {
        const data = await response.clone().json();
        const next = data.messages || [];
        if (initialized && document.hidden && notifyEnabled() && 'Notification' in window && Notification.permission === 'granted') {
          next.filter(m => !m.mine && !previousIds.has(m.id)).forEach(m => new Notification('Новое сообщение', { body: m.text || 'Изображение' }));
        }
        messages = next;
        previousIds = new Set(next.map(m => m.id));
        initialized = true;
        setTimeout(enhanceMessages, 0);
      }
    } catch (_) {}
    return response;
  };

  function enhanceMessages() {
    if ($('#composer')?.dataset.community) return;
    const bubbles = [...document.querySelectorAll('#messages .bubble')];
    const shown = messages.slice(-bubbles.length);
    bubbles.forEach((bubble, i) => {
      const m = shown[i]; if (!m) return;
      bubble.dataset.messageId = m.id;
      const meta = bubble.querySelector('.bubbleMeta');
      if (meta && m.mine) meta.textContent = `${new Date(m.createdAt).toLocaleTimeString('ru', {hour:'2-digit', minute:'2-digit'})} ${m.readAt ? '✓✓' : '✓'}`;
      if (m.replyTo && !bubble.querySelector('.featureReplyRef')) {
        const parent = messages.find(x => x.id === m.replyTo);
        if (parent) { const ref = document.createElement('div'); ref.className = 'featureReplyRef'; ref.textContent = `↪ ${parent.text || 'Изображение'}`; bubble.prepend(ref); }
      }
      if (m.image && !bubble.querySelector('.featureImage, .featureOnce')) {
        if (m.viewOnce) {
          const button = document.createElement('button'); button.className = 'featureOnce'; button.type = 'button'; button.textContent = 'Фото · открыть один раз';
          button.onclick = () => { const img = document.createElement('img'); img.className = 'featureImage'; img.src = m.image; img.alt = 'Изображение'; button.replaceWith(img); };
          bubble.insertBefore(button, meta || null);
        } else { const img = document.createElement('img'); img.className = 'featureImage'; img.src = m.image; img.alt = 'Изображение'; bubble.insertBefore(img, meta || null); }
      }
      if (!bubble.dataset.replyBound) { bubble.dataset.replyBound = '1'; bubble.addEventListener('click', e => { if (e.target.closest('button,img,.bubbleMeta')) return; replyTo = m.id; showReply(m); }); }
    });
  }

  function showReply(m) {
    const bar = $('#featureReply'); if (!bar) return;
    bar.textContent = `Ответ: ${(m.text || 'Изображение').slice(0, 80)}`; bar.classList.add('on');
  }
  window.setReplyTarget = m => { replyTo = m?.id || null; if (m) showReply(m); };

  function ensureComposer() {
    const composer = $('#composer'), input = $('#message'); if (!composer || !input || $('#featureAttach')) return;
    // The legacy inline handler used to submit the same message a second time.
    // The feature handler below is now the single source of truth.
    composer.onsubmit = null;
    const attach = document.createElement('button'); attach.type = 'button'; attach.id = 'featureAttach'; attach.className = 'icon'; attach.textContent = '📎';
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true; file.id = 'featureFile';
    const once = document.createElement('label'); once.className = 'onceLabel'; once.innerHTML = '<input type="checkbox" id="featureOnce"> 1×';
    const preview = document.createElement('div'); preview.id = 'featureReply'; preview.className = 'featureReply';
    composer.insertBefore(attach, composer.firstChild); composer.append(file, once); composer.parentElement.insertBefore(preview, composer);
    attach.onclick = () => file.click();
    file.onchange = () => { const f = file.files[0]; if (!f) return; if (f.size > 2500000) return toast('Изображение должно быть меньше 2,5 МБ'); const reader = new FileReader(); reader.onload = () => { selectedImage = reader.result; toast('Изображение прикреплено'); }; reader.readAsDataURL(f); };
    async function refreshPersonalChat(username) {
      const r = await Promise.race([
        window.fetch(`/api/messages?with=${encodeURIComponent(username)}`, {headers: authHeaders()}),
        new Promise((_, reject) => setTimeout(() => reject(Error('Истекло время обновления чата')), 12000))
      ]);
      const data = await r.json(); if (!r.ok) throw Error(data.error || 'Не удалось обновить чат');
      const items = data.messages || [];
      $('#headName').textContent = data.user.name; $('#headSub').textContent = '@' + data.user.username; setHeaderVerified(data.user.verified);
      $('#headAvatar').innerHTML = data.user.avatar ? `<img src="${data.user.avatar}">` : esc(data.user.name[0]);
      $('#messages').innerHTML = items.length ? '<div class="day">Сегодня</div>' + items.map(m => `<div class="bubble ${m.mine?'me':''}" data-message-id="${m.id}">${esc(m.text)}<span class="bubbleMeta">${new Date(m.createdAt).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}${m.mine?(m.readAt?' ✓✓':' ✓'):''}</span></div>`).join('') : '<div class="emptyChat">Начало общения</div>';
      $('#messages').scrollTop = $('#messages').scrollHeight;
    }
    composer.addEventListener('submit', async e => {
      e.preventDefault(); e.stopImmediatePropagation();
      const community = composer.dataset.community || ''; const recipient = ($('#headSub')?.textContent || '').replace(/^@/, '').trim(); const text = input.value.trim();
      if (!recipient || (!text && !selectedImage)) return;
      const send = composer.querySelector('.send'); if (send) send.disabled = true;
      try {
        const endpoint = community ? `/api/communities/${encodeURIComponent(community)}/messages` : '/api/messages';
        const payload = community ? { text, image: selectedImage, viewOnce: !!$('#featureOnce')?.checked, replyTo } : { to: recipient, text, image: selectedImage, viewOnce: !!$('#featureOnce')?.checked, replyTo };
        const r = await fetchWithTimeout(endpoint, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
        if (!r.ok) { const v = await r.json(); throw new Error(v.error || 'Не удалось отправить'); }
        input.value = ''; selectedImage = ''; replyTo = null; file.value = ''; $('#featureOnce').checked = false; preview.classList.remove('on');
        // Never block the submit event on a redraw or long-poll request.
        const redraw = community && window.loadCommunityMessages ? window.loadCommunityMessages() : refreshPersonalChat(recipient);
        Promise.resolve(redraw).catch(err => toast(err.message));
      } catch (err) { toast(err.message); }
      finally { if (send) send.disabled = false; }
    }, true);
  }

  function observeProfile() {
    const modal = [...document.querySelectorAll('.modal')].find(x => x.textContent.includes('Профиль'));
    if (!modal || modal.querySelector('#notifyToggle')) return;
    const label = document.createElement('label'); label.className = 'notifySetting'; label.innerHTML = '<input type="checkbox" id="notifyToggle"> Получать уведомления';
    const save = modal.querySelector('.save'); modal.insertBefore(label, save); const check = label.querySelector('input'); check.checked = notifyEnabled();
    check.onchange = async () => {
      if (check.checked && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      const p = profile(); try { const r = await originalFetch('/api/me', { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ name: p.name, username: p.username, avatar: p.avatar || '', notifications: check.checked }) }); const v = await r.json(); if (!r.ok) throw new Error(v.error); localStorage.setItem('lost-profile', JSON.stringify(v.user)); toast(check.checked ? 'Уведомления включены' : 'Уведомления выключены'); } catch (e) { toast(e.message); }
    };
  }

  const style = document.createElement('style'); style.textContent = `.featureImage{display:block;max-width:260px;max-height:280px;border-radius:12px;margin:2px 0 6px;object-fit:cover}.featureOnce{display:block;background:#712238;color:#fff;border-radius:10px;padding:9px 12px;margin:3px 0 5px}.featureReplyRef{font-size:12px;color:#ff9aaa;border-left:2px solid #ee334f;padding-left:7px;margin-bottom:5px}.featureReply{display:none;background:#27282f;color:#ff8b9a;padding:6px 12px;font-size:12px;border-top:1px solid #393a43}.featureReply.on{display:block}.onceLabel{font-size:11px;color:#c9a0a8;white-space:nowrap;display:flex;align-items:center;gap:3px}.notifySetting{display:flex;align-items:center;gap:8px;color:#eee;font-size:14px;margin:10px 0;padding:10px;background:#24252a;border-radius:10px}.verifiedMark{display:inline-grid;place-items:center;width:16px;height:16px;margin-left:5px;border-radius:50%;background:#2f9fcb;color:#fff;font-size:11px;font-style:normal;font-weight:900;vertical-align:middle}.headVerified{display:inline-grid;margin:0 0 0 2px;vertical-align:middle}.adminMenu{display:none!important}.adminMenu.isAdmin{display:grid!important}`; document.head.appendChild(style);
  const observer = new MutationObserver(() => { ensureComposer(); observeProfile(); enhanceMessages(); });
  observer.observe(document.body, { childList: true, subtree: true });
  ensureComposer();
})();

/* Accounts, channels, groups, community conversations and notifications. */
(() => {
  'use strict';
  const q = s => document.querySelector(s);
  const token = () => localStorage.getItem('lost-token') || '';
  const profile = () => { try { return JSON.parse(localStorage.getItem('lost-profile') || '{}'); } catch { return {}; } };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const request = async (url, options={}) => { options.headers={...(options.headers||{}),Authorization:`Bearer ${token()}`}; if(options.body)options.headers['Content-Type']='application/json'; const r=await fetch(url,options); const v=await r.json(); if(!r.ok)throw Error(v.error||'Ошибка'); return v; };
  let currentCommunity = '';
  const isMobile = () => innerWidth <= 700;
  const openMobile = () => { if(isMobile()){q('#side')?.classList.add('off');q('#main')?.classList.add('open');} };
  const renderCommunityMessages = data => {
    const items=data.messages||[]; q('#headName').textContent=data.community.name; q('#headSub').textContent='@'+data.community.username; setHeaderVerified(data.community.verified); q('#headAvatar').innerHTML=data.community.avatar?`<img src="${data.community.avatar}">`:data.community.type==='channel'?'📢':'👥';
    const composer=q('#composer'); const locked=data.community.type==='group'&&data.community.isMember===false; if(composer){composer.classList.toggle('on',!locked); composer.dataset.community=locked?'':data.community.username;}
    q('#messages').innerHTML=(data.community.isMember===false&&data.community.type==='group'?`<button class="primary joinCommunity">Вступить в группу</button>`:'')+(items.length?'<div class="day">Сегодня</div>'+items.map(m=>`<div class="bubble ${m.mine?'me':''}" data-message-id="${m.id}">${m.replyTo?`<div class="featureReplyRef">↪ ответ</div>`:''}${m.image?(m.viewOnce?`<button class="featureOnce" data-message-id="${m.id}">Фото · открыть один раз</button>`:`<img class="featureImage" src="${m.image}" alt="Изображение">`):''}${esc(m.text)}<span class="bubbleMeta">${esc(m.fromUser?.name||'')} · ${new Date(m.createdAt).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}${m.mine?(m.readAt?' ✓✓':' ✓'):''}</span></div>`).join(''):'<div class="emptyChat">Пока нет сообщений</div>');
    q('#messages').querySelector('.joinCommunity')?.addEventListener('click',async()=>{try{await request(`/api/communities/${encodeURIComponent(data.community.username)}/join`);await loadCommunityMessages()}catch(e){if(window.toast)window.toast(e.message)}});
    q('#messages').querySelectorAll('.featureOnce').forEach(b=>b.onclick=()=>{const m=items.find(x=>x.id===b.dataset.messageId);if(!m)return;const img=document.createElement('img');img.className='featureImage';img.src=m.image;b.replaceWith(img)});
    q('#messages').querySelectorAll('.bubble').forEach(b=>b.addEventListener('click',e=>{if(e.target.closest('button,img,.bubbleMeta'))return;const m=items.find(x=>x.id===b.dataset.messageId);if(m)window.setReplyTarget?.(m)}));
    q('#messages').scrollTop=q('#messages').scrollHeight;
  };
  async function loadCommunityMessages(){ if(!currentCommunity)return; try{renderCommunityMessages(await request(`/api/communities/${encodeURIComponent(currentCommunity)}/messages`));}catch(e){if(window.toast)window.toast(e.message)} }
  window.loadCommunityMessages=loadCommunityMessages;
  async function openCommunity(username){
    currentCommunity=username.toLowerCase(); if(typeof active!=='undefined')active=null; const composer=q('#composer'); if(composer){composer.dataset.community=currentCommunity;composer.classList.add('on');} openMobile();
    try{const data=await request(`/api/communities/${encodeURIComponent(currentCommunity)}`); if(!data.community)return; renderCommunityMessages({community:data.community,messages:[]}); await loadCommunityMessages();}catch(e){if(window.toast)window.toast(e.message)}
  }
  window.openCommunity=openCommunity;
  const originalOpenChat=window.openChat;
  if(originalOpenChat){ const wrappedOpenChat=async username=>{currentCommunity='';const composer=q('#composer');if(composer){delete composer.dataset.community;composer.classList.add('on')}q('#featureReply')?.classList.remove('on');return originalOpenChat(username)}; window.openChat=wrappedOpenChat; try{openChat=wrappedOpenChat}catch(_){} }
  async function findUsersWithCommunities(query){
    try{const data=await request('/api/users?q='+encodeURIComponent(query));const rows=[...(data.users||[]).map(u=>({kind:'user',value:u})),...(data.communities||[]).map(c=>({kind:'community',value:c}))]; if(!rows.length){if(window.empty)empty('Никого не нашли','Проверь написание username.');return;}
      q('#list').innerHTML=rows.map(({kind:valueKind,value:x})=>valueKind==='user'?`<div class="row person" data-user="${esc(x.username)}"><div class="avatar">${x.avatar?`<img src="${x.avatar}">`:esc(x.name[0])}</div><div class="ri"><div class="line"><b>${esc(x.name)}</b><span class="tag">@${esc(x.username)}${x.verified?'<i class="verifiedMark" title="Верифицировано">✓</i>':''}</span></div><div class="preview">${x.bio?'Пользователь':'Личный аккаунт'}</div></div></div>`:`<div class="row community" data-community="${esc(x.username)}"><div class="avatar">${x.type==='channel'?'📢':'👥'}</div><div class="ri"><div class="line"><b>${esc(x.name)}</b><span class="tag">@${esc(x.username)}${x.verified?'<i class="verifiedMark" title="Верифицировано">✓</i>':''}</span></div><div class="preview">${x.type==='channel'?'Канал':'Группа'} · ${x.memberCount} участников</div></div></div>`).join('');
      q('#list').querySelectorAll('.person').forEach(r=>r.onclick=()=>window.openChat(r.dataset.user));q('#list').querySelectorAll('.community').forEach(r=>r.onclick=()=>openCommunity(r.dataset.community));
    }catch(e){if(window.toast)window.toast(e.message)}
  }
  try{findUsers=findUsersWithCommunities}catch(_){} window.findUsers=findUsersWithCommunities;
  async function syncDialogsWithCommunities(){
    try{const data=await request('/api/conversations'), rows=[];(data.conversations||[]).forEach(x=>rows.push(`<div class="row dialog" data-user="${esc(x.user.username)}"><div class="avatar">${x.user.avatar?`<img src="${x.user.avatar}">`:esc(x.user.name[0])}</div><div class="ri"><div class="line"><b>${esc(x.user.name)}</b><span class="tag">@${esc(x.user.username)}${x.user.verified?'<i class="verifiedMark" title="Верифицировано">✓</i>':''}</span><time>${x.last?new Date(x.last.createdAt).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}):''}</time></div><div class="preview">${esc(x.last?.text||'Диалог')}</div></div></div>`));(data.communities||[]).forEach(x=>rows.push(`<div class="row community" data-community="${esc(x.community.username)}"><div class="avatar">${x.community.type==='channel'?'📢':'👥'}</div><div class="ri"><div class="line"><b>${esc(x.community.name)}</b><span class="tag">@${esc(x.community.username)}${x.community.verified?'<i class="verifiedMark" title="Верифицировано">✓</i>':''}</span><time>${x.last?new Date(x.last.createdAt).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}):''}</time></div><div class="preview">${x.community.type==='channel'?'Канал':'Группа'}${x.last?' · '+esc(x.last.text):''}</div></div></div>`));if(!rows.length){if(window.empty)empty('Пока нет диалогов','Найди пользователя, канал или группу по username.');}else{q('#list').innerHTML=rows.join('');q('#list').querySelectorAll('.dialog').forEach(r=>r.onclick=()=>window.openChat(r.dataset.user));q('#list').querySelectorAll('.community').forEach(r=>r.onclick=()=>openCommunity(r.dataset.community));}if(currentCommunity)await loadCommunityMessages();}catch(e){if(window.toast)window.toast(e.message)}
  }
  try{syncDialogs=syncDialogsWithCommunities}catch(_){} window.syncDialogs=syncDialogsWithCommunities;
  function communityModal(){
    const layer=document.createElement('div');layer.className='modalLayer';layer.innerHTML='<div class="modal"><div class="modalHead"><h2>Создать канал или группу</h2><button class="close">×</button></div><div class="switch"><button class="on" data-kind="group">Группа</button><button data-kind="channel">Канал</button></div><div class="field"><label>НАЗВАНИЕ</label><input class="cn" placeholder="Название"></div><div class="field"><label>USERNAME</label><input class="cu" placeholder="my_group"></div><div class="field"><label>ОПИСАНИЕ</label><input class="cd" placeholder="О чём это сообщество?"></div><button class="primary createCommunity">Создать</button><div class="error"></div></div>';document.body.append(layer);let kind='group';layer.onclick=e=>{if(e.target===layer)layer.remove()};layer.querySelector('.close').onclick=()=>layer.remove();layer.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.kind;layer.querySelectorAll('[data-kind]').forEach(x=>x.classList.toggle('on',x===b))});layer.querySelector('.createCommunity').onclick=async()=>{try{const v=await request('/api/communities',{method:'POST',body:JSON.stringify({type:kind,name:layer.querySelector('.cn').value,username:layer.querySelector('.cu').value,description:layer.querySelector('.cd').value})});layer.remove();await syncDialogsWithCommunities();openCommunity(v.community.username)}catch(e){layer.querySelector('.error').textContent=e.message}};
  }
  const fab=q('#fab');if(fab)fab.onclick=()=>{const layer=document.createElement('div');layer.className='modalLayer';layer.innerHTML='<div class="modal"><div class="modalHead"><h2>Новое</h2><button class="close">×</button></div><button class="choice findChoice"><span class="choiceIcon">⌕</span><span><b>Найти пользователя</b><small>Поиск по username</small></span></button><button class="choice createChoice"><span class="choiceIcon">＋</span><span><b>Создать канал или группу</b><small>Общение и публикации</small></span></button></div>';document.body.append(layer);layer.onclick=e=>{if(e.target===layer)layer.remove()};layer.querySelector('.close').onclick=()=>layer.remove();layer.querySelector('.findChoice').onclick=()=>{layer.remove();q('#search').focus()};layer.querySelector('.createChoice').onclick=()=>{layer.remove();communityModal()}};
  async function showPinned(){try{const v=await request('/api/pinned');if(!v.community)return;let card=q('#pinnedCommunity');if(!card){card=document.createElement('button');card.id='pinnedCommunity';card.className='pinnedCommunity';q('.brand')?.after(card)}card.textContent=`📌 ${v.community.name} · @${v.community.username}`;card.onclick=()=>openCommunity(v.community.username)}catch(_){} }
  showPinned();
  let notified=new Set();
  async function pollUnread(){if(!token()||profile().notifications===false)return;try{const v=await request('/api/unread');for(const m of v.messages||[]){if(notified.has(m.id))continue;notified.add(m.id);if(document.hidden&&'Notification' in window&&Notification.permission==='granted')new Notification('Новое сообщение',{body:m.text||'Изображение'});}}catch(_){} }
  setInterval(pollUnread,5000);pollUnread();
})();

/* Transparent moderation tools: visible only to the administrator and every view/action is audited. */
(() => {
  'use strict';
  const q = s => document.querySelector(s);
  const profile = () => { try { return JSON.parse(localStorage.getItem('lost-profile') || '{}'); } catch { return {}; } };
  const isAdmin = p => p && (p.role === 'admin' || String(p.username || '').toLowerCase() === 'vsevolod67');
  const setHeaderVerified = verified => { const sub = q('#headSub'); if (!sub) return; sub.parentElement.querySelector('.headVerified')?.remove(); if (verified) { const badge = document.createElement('span'); badge.className='headVerified verifiedMark'; badge.textContent='✓'; badge.title='Верифицировано'; sub.after(badge); } };
  const token = () => localStorage.getItem('lost-token') || '';
  const request = async (url, options={}) => { options.headers = {...(options.headers||{}), Authorization:`Bearer ${token()}`, 'Content-Type':'application/json'}; const r=await fetch(url,options); const v=await r.json(); if(!r.ok) throw Error(v.error||'Ошибка'); return v; };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let added=false;
  function addAdminMenu(){
    const p=profile(); if(!isAdmin(p)) return;
    const head=q('.head'); if(!head||head.querySelector('.adminMenu')) return;
    const b=document.createElement('button'); b.className='icon adminMenu isAdmin'; b.textContent='☰'; b.title='Панель администратора'; b.setAttribute('aria-label','Панель администратора');
    b.onclick=()=>openPanel(); head.append(b);
  }
  function addOwnerButton(){
    const modal=[...document.querySelectorAll('.modal')].find(x=>x.textContent.includes('Профиль'));
    if(!modal){ added=false; return; }
    const p=profile(); if(added||!isAdmin(p)) return;
    const b=document.createElement('button'); b.className='primary moderationOpen'; b.textContent='☰  Панель модерации'; b.type='button'; modal.querySelector('.save')?.after(b); b.onclick=()=>{modal.closest('.modalLayer')?.remove();openPanel()}; added=true;
  }
  function openPanel(){
    const layer=document.createElement('div'); layer.className='modalLayer adminLayer'; layer.innerHTML='<div class="modal modPanel adminShell"><div class="adminTop"><div><div class="adminEyebrow">CONTROL CENTER</div><h2>Админ-панель</h2><div class="modNote">Управление пользователями, каналами и сообщениями</div></div><button class="close adminClose">×</button></div><div class="adminStats"><div><b data-stat="users">—</b><span>пользователей</span></div><div><b data-stat="communities">—</b><span>каналов и групп</span></div><div><b data-stat="messages">—</b><span>сообщений</span></div><div><b data-stat="verified">—</b><span>верифицировано</span></div></div><div class="modTabs adminTabs"><button data-tab="users">Пользователи</button><button data-tab="communities">Каналы и группы</button><button data-tab="messages">Сообщения</button><button data-tab="audit">Журнал</button><button data-tab="pin">Закрепление</button></div><div class="modBody adminBody">Загрузка…</div></div>'; document.body.append(layer); layer.querySelector('.adminClose').onclick=()=>layer.remove(); layer.onclick=e=>{if(e.target===layer)layer.remove()}; layer.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>loadTab(layer,b.dataset.tab)); loadTab(layer,'users');
  }
  async function loadTab(layer,tab){
    const out=layer.querySelector('.modBody'); out.innerHTML='Загрузка…'; try{const data=await request('/api/moderation/overview');
      layer.querySelector('[data-stat="users"]').textContent=data.users.length; layer.querySelector('[data-stat="communities"]').textContent=data.communities.length; layer.querySelector('[data-stat="messages"]').textContent=data.messages.length; layer.querySelector('[data-stat="verified"]').textContent=data.users.filter(u=>u.verified).length+data.communities.filter(c=>c.verified).length;
      layer.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
      if(tab==='users') out.innerHTML='<div class="adminSectionHead"><div><h3>Пользователи</h3><p>Выдача и снятие верификации, блокировка аккаунтов</p></div><span class="sectionCount">'+data.users.length+'</span></div><div class="modRows">'+(data.users.length?data.users.map(u=>`<div class="modRow userRow"><div class="entityIcon">${esc((u.name||'П')[0].toUpperCase())}</div><div class="entityMain"><b>${esc(u.name)}</b><span>@${esc(u.username)}</span><small>${u.role}${u.verified?' · <i class="verifiedBadge">✓ Верифицирован</i>':''}${u.blocked?' · заблокирован':''}</small></div><div class="modActions"><button class="actionVerify ${u.verified?'isVerified':''}" data-act="verify" data-id="${u.id}" data-value="${!u.verified}">${u.verified?'Снять верификацию':'Выдать верификацию'}</button><button class="actionDanger" data-act="${u.blocked?'unblock':'block'}" data-id="${u.id}">${u.blocked?'Разблокировать':'Заблокировать'}</button></div></div>`).join(''):'<div class="adminEmpty">Пользователей пока нет</div>')+'</div>';
      if(tab==='communities') out.innerHTML='<div class="adminSectionHead"><div><h3>Каналы и группы</h3><p>Проверка, верификация и закрепление сообщества</p></div><span class="sectionCount">'+data.communities.length+'</span></div><div class="modRows">'+(data.communities.length?data.communities.map(c=>`<div class="modRow"><div class="entityIcon communityIcon">${c.type==='channel'?'📢':'👥'}</div><div class="entityMain"><b>${esc(c.name)}</b><span>@${esc(c.username)}</span><small>${c.type==='channel'?'Канал':'Группа'} · ${c.memberCount} участников${c.verified?' · <i class="verifiedBadge">✓ Верифицировано</i>':''}</small></div><div class="modActions"><button class="actionVerify ${c.verified?'isVerified':''}" data-community-act="verifyCommunity" data-id="${c.id}" data-value="${!c.verified}">${c.verified?'Снять верификацию':'Выдать верификацию'}</button><button class="actionSecondary" data-community-act="pinCommunity" data-id="${c.id}">📌 В закреп</button></div></div>`).join(''):'<div class="adminEmpty">Каналов и групп пока нет</div>')+'</div>';
      if(tab==='messages') out.innerHTML='<div class="modRows">'+data.messages.slice().reverse().map(m=>`<div class="modMessage"><small>${new Date(m.createdAt).toLocaleString('ru')} · @${esc(m.fromUser?.username||'?')} → @${esc(m.toUser?.username||m.toType||'?')}</small><div>${m.image?'🖼 Изображение ':''}${esc(m.text||'')}</div>${m.fromUser&&m.toUser?`<button class="modReply" data-mid="${m.id}" data-from="${m.toUser.id}" data-to="${esc(m.fromUser.username)}">Ответить от имени @${esc(m.toUser.username)}</button>`:''}</div>`).join('')+'</div>';
      if(tab==='audit') out.innerHTML='<div class="modRows">'+data.audit.map(a=>`<div class="modMessage"><small>${new Date(a.createdAt).toLocaleString('ru')} · @${esc(a.actorUsername)}</small><div>${esc(a.action)} ${esc(JSON.stringify(a.details||{}))}</div></div>`).join('')+'</div>';
      if(tab==='pin') out.innerHTML=`<div class="field"><label>ТЕКСТ ЗАКРЕПЛЁННОГО ОБЪЯВЛЕНИЯ</label><textarea class="modPin" maxlength="300" placeholder="Сообщение для всех">${esc(data.settings?.pinned||'')}</textarea></div><button class="primary modPinSave">Сохранить закрепление</button>`;
      out.querySelectorAll('[data-act]').forEach(b=>b.onclick=async()=>{try{await request('/api/moderation/action',{method:'POST',body:JSON.stringify({action:b.dataset.act,userId:b.dataset.id,value:b.dataset.value==='true',type:'user'})});loadTab(layer,'users')}catch(e){alert(e.message)}});
      out.querySelectorAll('[data-community-act]').forEach(b=>b.onclick=async()=>{try{await request('/api/moderation/action',{method:'POST',body:JSON.stringify({action:b.dataset.communityAct,communityId:b.dataset.id,value:b.dataset.value==='true'})});loadTab(layer,'communities')}catch(e){alert(e.message)}});
      out.querySelectorAll('.modReply').forEach(b=>b.onclick=async()=>{const text=prompt('Текст ответа:');if(!text)return;try{await request('/api/moderation/action',{method:'POST',body:JSON.stringify({action:'reply',fromUserId:b.dataset.from,to:b.dataset.to,replyTo:b.dataset.mid,text})});alert('Ответ отправлен');loadTab(layer,'messages')}catch(e){alert(e.message)}});
      out.querySelector('.modPinSave')?.addEventListener('click',async()=>{try{await request('/api/moderation/action',{method:'POST',body:JSON.stringify({action:'pin',text:out.querySelector('.modPin').value})});alert('Закрепление сохранено')}catch(e){alert(e.message)}});
    }catch(e){out.textContent=e.message}
  }
  const style=document.createElement('style'); style.textContent=`
    .adminLayer{background:rgba(4,5,9,.78);backdrop-filter:blur(12px);padding:24px}
    .adminShell{width:min(900px,100%);max-height:min(820px,94vh);overflow:hidden;padding:0;background:linear-gradient(145deg,#181a22,#111218);border:1px solid #353846;border-radius:26px;box-shadow:0 28px 100px #000b}
    .adminTop{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:28px 30px 20px;background:radial-gradient(circle at 0 0,#5b1d2d55,transparent 42%)}
    .adminEyebrow{color:#ff788a;font-size:10px;font-weight:800;letter-spacing:2px;margin-bottom:7px}.adminTop h2{font-size:27px;margin:0 0 5px;letter-spacing:-.7px}.adminTop .modNote{margin:0;color:#989ba9;font-size:13px}.adminClose{width:38px;height:38px;background:#292c35;border-radius:12px}
    .adminStats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:0 30px 22px}.adminStats>div{padding:14px 15px;background:#22242d;border:1px solid #30333e;border-radius:15px}.adminStats b{display:block;font-size:22px}.adminStats span{display:block;color:#9699a6;font-size:11px;margin-top:3px}
    .adminTabs{padding:0 30px;border-bottom:1px solid #30333e;gap:7px}.adminTabs button{border:1px solid transparent;background:transparent;color:#999daa;border-radius:11px 11px 0 0;padding:12px 13px;font-size:12px;transition:.18s}.adminTabs button:hover{color:#fff;background:#242630}.adminTabs button.active{color:#ff8292;background:#29202a;border-color:#49303b;border-bottom-color:#ee334f}
    .adminBody{max-height:52vh;overflow:auto;padding:24px 30px 30px}.adminSectionHead{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.adminSectionHead h3{margin:0;font-size:19px}.adminSectionHead p{margin:4px 0 0;color:#9296a5;font-size:12px}.sectionCount{min-width:32px;height:27px;display:grid;place-items:center;border-radius:9px;background:#31212a;color:#ff8796;font-weight:800;font-size:12px}
    .modRows{display:grid;gap:9px}.modRow{display:flex;align-items:center;gap:12px;padding:13px 14px;background:#20222a;border:1px solid #2d303a;border-radius:15px}.modRow:hover{border-color:#4a3540;background:#252731}.entityIcon{width:40px;height:40px;flex:none;border-radius:13px;display:grid;place-items:center;background:linear-gradient(145deg,#642033,#321822);color:#fff;font-weight:800;font-size:16px}.communityIcon{background:linear-gradient(145deg,#263b5e,#20293c);font-size:19px}.entityMain{min-width:0;flex:1}.entityMain b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.entityMain span{display:block;color:#ff92a0;font-size:11px;margin-top:2px}.entityMain small{display:block;color:#9195a3;font-size:11px;margin-top:5px}.verifiedBadge{color:#74d9b0;font-style:normal}.modActions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}.modActions button,.modReply{border:1px solid #49303a;background:#34222b;color:#ff9baa;border-radius:9px;padding:8px 10px;font-size:10px;font-weight:700}.modActions .actionVerify.isVerified{background:#17382f;border-color:#2d6d5b;color:#7de2bc}.modActions .actionDanger{background:#302329;color:#ff8c8c}.modActions .actionSecondary{background:#252d42;border-color:#3b4c71;color:#a9c4ff}.adminEmpty{padding:35px 15px;text-align:center;color:#858996;border:1px dashed #3b3e4b;border-radius:15px}.modMessage{padding:14px;background:#20222a;border:1px solid #2d303a;border-radius:14px}.modMessage small{color:#9599a8;font-size:10px}.modMessage div{margin-top:6px;font-size:13px;line-height:1.4;word-break:break-word}.modReply{margin-top:10px}.modPin{width:100%;min-height:120px;resize:vertical;background:#20222a;color:#fff;border:1px solid #3a3d48;border-radius:13px;padding:13px;outline:none}.modPin:focus{border-color:#d83d5a}
    @media(max-width:700px){.adminLayer{padding:0;align-items:end}.adminShell{max-height:94dvh;border-radius:24px 24px 0 0}.adminTop{padding:23px 18px 16px}.adminTop h2{font-size:23px}.adminStats{padding:0 18px 16px;grid-template-columns:repeat(2,1fr)}.adminTabs{padding:0 18px;overflow:auto}.adminTabs button{white-space:nowrap}.adminBody{padding:19px 18px 25px;max-height:51dvh}.modRow{align-items:flex-start;flex-wrap:wrap}.entityMain{min-width:calc(100% - 55px)}.modActions{width:100%;justify-content:flex-start;margin-left:52px}}
  `; document.head.appendChild(style);
  const adminObserver=new MutationObserver(()=>{addOwnerButton();addAdminMenu()}); adminObserver.observe(document.body,{childList:true,subtree:true}); addOwnerButton(); addAdminMenu();
})();
