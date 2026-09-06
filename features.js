(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const token = () => localStorage.getItem('lost-token') || '';
  const profile = () => { try { return JSON.parse(localStorage.getItem('lost-profile') || '{}'); } catch { return {}; } };
  const isAdmin = p => p && (p.role === 'admin' || String(p.username || '').toLowerCase() === 'vsevolod67');
  const notifyEnabled = () => profile().notifications !== false;
  const toast = msg => window.toast ? window.toast(msg) : alert(msg);
  let messages = [], previousIds = new Set(), selectedImage = '', replyTo = null, initialized = false;
  const authHeaders = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });
  const originalFetch = window.fetch.bind(window);

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

  function ensureComposer() {
    const composer = $('#composer'), input = $('#message'); if (!composer || !input || $('#featureAttach')) return;
    const attach = document.createElement('button'); attach.type = 'button'; attach.id = 'featureAttach'; attach.className = 'icon'; attach.textContent = '📎';
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true; file.id = 'featureFile';
    const once = document.createElement('label'); once.className = 'onceLabel'; once.innerHTML = '<input type="checkbox" id="featureOnce"> 1×';
    const preview = document.createElement('div'); preview.id = 'featureReply'; preview.className = 'featureReply';
    composer.insertBefore(attach, composer.firstChild); composer.append(file, once); composer.parentElement.insertBefore(preview, composer);
    attach.onclick = () => file.click();
    file.onchange = () => { const f = file.files[0]; if (!f) return; if (f.size > 2500000) return toast('Изображение должно быть меньше 2,5 МБ'); const reader = new FileReader(); reader.onload = () => { selectedImage = reader.result; toast('Изображение прикреплено'); }; reader.readAsDataURL(f); };
    composer.addEventListener('submit', async e => {
      e.preventDefault(); e.stopImmediatePropagation();
      const recipient = ($('#headSub')?.textContent || '').replace(/^@/, '').trim(); const text = input.value.trim();
      if (!recipient || (!text && !selectedImage)) return;
      const send = composer.querySelector('.send'); if (send) send.disabled = true;
      try {
        const r = await originalFetch('/api/messages', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ to: recipient, text, image: selectedImage, viewOnce: !!$('#featureOnce')?.checked, replyTo }) });
        if (!r.ok) { const v = await r.json(); throw new Error(v.error || 'Не удалось отправить'); }
        input.value = ''; selectedImage = ''; replyTo = null; file.value = ''; $('#featureOnce').checked = false; preview.classList.remove('on');
        if (window.loadMessages) await window.loadMessages(); else $('#refresh')?.click();
        if (window.syncDialogs) await window.syncDialogs();
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

  const style = document.createElement('style'); style.textContent = `.featureImage{display:block;max-width:260px;max-height:280px;border-radius:12px;margin:2px 0 6px;object-fit:cover}.featureOnce{display:block;background:#712238;color:#fff;border-radius:10px;padding:9px 12px;margin:3px 0 5px}.featureReplyRef{font-size:12px;color:#ff9aaa;border-left:2px solid #ee334f;padding-left:7px;margin-bottom:5px}.featureReply{display:none;background:#27282f;color:#ff8b9a;padding:6px 12px;font-size:12px;border-top:1px solid #393a43}.featureReply.on{display:block}.onceLabel{font-size:11px;color:#c9a0a8;white-space:nowrap;display:flex;align-items:center;gap:3px}.notifySetting{display:flex;align-items:center;gap:8px;color:#eee;font-size:14px;margin:10px 0;padding:10px;background:#24252a;border-radius:10px}.switch [data-mode="register"]{display:none}.adminMenu{display:none!important}.adminMenu.isAdmin{display:grid!important}`; document.head.appendChild(style);
  setTimeout(() => document.querySelector('[data-mode="login"]')?.click(), 0);
  const observer = new MutationObserver(() => { ensureComposer(); observeProfile(); enhanceMessages(); });
  observer.observe(document.body, { childList: true, subtree: true });
  ensureComposer();
})();

/* Transparent moderation tools: visible only to the administrator and every view/action is audited. */
(() => {
  'use strict';
  const q = s => document.querySelector(s);
  const profile = () => { try { return JSON.parse(localStorage.getItem('lost-profile') || '{}'); } catch { return {}; } };
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
    const layer=document.createElement('div'); layer.className='modalLayer'; layer.innerHTML='<div class="modal modPanel"><div class="modalHead"><h2>Модерация</h2><button class="close">×</button></div><div class="modNote">Доступ владельца. Просмотр сообщений фиксируется в журнале.</div><div class="modTabs"><button data-tab="users">Пользователи</button><button data-tab="messages">Сообщения</button><button data-tab="audit">Журнал</button><button data-tab="pin">Закрепить</button></div><div class="modBody">Загрузка…</div></div>'; document.body.append(layer); layer.querySelector('.close').onclick=()=>layer.remove(); layer.onclick=e=>{if(e.target===layer)layer.remove()}; layer.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>loadTab(layer,b.dataset.tab)); loadTab(layer,'users');
  }
  async function loadTab(layer,tab){
    const out=layer.querySelector('.modBody'); out.innerHTML='Загрузка…'; try{const data=await request('/api/moderation/overview');
      if(tab==='users') out.innerHTML='<div class="modRows">'+data.users.map(u=>`<div class="modRow"><div><b>${esc(u.name)}</b> <span>@${esc(u.username)}</span><small>${u.role}${u.verified?' · ✓ '+(u.verifiedType||'user'):''}${u.blocked?' · заблокирован':''}</small></div><div class="modActions"><button data-act="verify" data-id="${u.id}">${u.verified?'Снять ✓':'Выдать ✓'}</button><button data-act="${u.blocked?'unblock':'block'}" data-id="${u.id}">${u.blocked?'Разблокировать':'Заблокировать'}</button></div></div>`).join('')+'</div>';
      if(tab==='messages') out.innerHTML='<div class="modRows">'+data.messages.slice().reverse().map(m=>`<div class="modMessage"><small>${new Date(m.createdAt).toLocaleString('ru')} · @${esc(m.fromUser?.username||'?')} → @${esc(m.toUser?.username||'?')}</small><div>${m.image?'🖼 Изображение ':''}${esc(m.text||'')}</div></div>`).join('')+'</div>';
      if(tab==='audit') out.innerHTML='<div class="modRows">'+data.audit.map(a=>`<div class="modMessage"><small>${new Date(a.createdAt).toLocaleString('ru')} · @${esc(a.actorUsername)}</small><div>${esc(a.action)} ${esc(JSON.stringify(a.details||{}))}</div></div>`).join('')+'</div>';
      if(tab==='pin') out.innerHTML=`<div class="field"><label>ТЕКСТ ЗАКРЕПЛЁННОГО ОБЪЯВЛЕНИЯ</label><textarea class="modPin" maxlength="300" placeholder="Сообщение для всех">${esc(data.settings?.pinned||'')}</textarea></div><button class="primary modPinSave">Сохранить закрепление</button>`;
      out.querySelectorAll('[data-act]').forEach(b=>b.onclick=async()=>{try{await request('/api/moderation/action',{method:'POST',body:JSON.stringify({action:b.dataset.act,userId:b.dataset.id,value:b.dataset.act==='verify',type:'user'})});loadTab(layer,'users')}catch(e){alert(e.message)}});
      out.querySelector('.modPinSave')?.addEventListener('click',async()=>{try{await request('/api/moderation/action',{method:'POST',body:JSON.stringify({action:'pin',text:out.querySelector('.modPin').value})});alert('Закрепление сохранено')}catch(e){alert(e.message)}});
    }catch(e){out.textContent=e.message}
  }
  const style=document.createElement('style'); style.textContent='.moderationOpen{margin-top:8px}.modNote{color:#a9aab2;font-size:12px;margin:-4px 0 12px}.modTabs{display:flex;gap:5px;overflow:auto;margin-bottom:10px}.modTabs button{background:#292a30;color:#ddd;border-radius:9px;padding:8px 10px;font-size:12px;white-space:nowrap}.modTabs button:hover{background:#5a1f2d}.modBody{max-height:58vh;overflow:auto}.modRow,.modMessage{padding:10px 0;border-bottom:1px solid #303139}.modRow{display:flex;justify-content:space-between;gap:8px;align-items:center}.modRow b{font-size:14px}.modRow span{color:#ff8a9a;font-size:12px}.modRow small{display:block;color:#92939d;margin-top:3px}.modActions{display:flex;gap:5px}.modActions button{background:#33252b;color:#ff9baa;border-radius:8px;padding:6px;font-size:10px}.modMessage small{color:#92939d;font-size:10px}.modMessage div{margin-top:4px;font-size:13px;word-break:break-word}.modPin{width:100%;min-height:90px;resize:vertical;background:#23242a;color:#fff;border:1px solid #34353c;border-radius:10px;padding:10px}'; document.head.appendChild(style);
  const adminObserver=new MutationObserver(()=>{addOwnerButton();addAdminMenu()}); adminObserver.observe(document.body,{childList:true,subtree:true}); addOwnerButton(); addAdminMenu();
})();
