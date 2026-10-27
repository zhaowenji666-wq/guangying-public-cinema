/* 电视直播页：频道清单来自 /live-channels.js（构建期由 live-sources.json 生成） */
(function () {
  'use strict';

  const data = window.LIVE_CHANNELS || { channels: [] };
  const ALL = (data.channels || []).filter(c => c && c.name && c.url);
  const groups = [];
  for (const c of ALL) if (!groups.includes(c.group)) groups.push(c.group);

  const $ = id => document.getElementById(id);
  const grid = $('live-grid');
  const statusEl = $('live-status');
  const emptyEl = $('live-empty');
  const countEl = $('live-count');
  const titleEl = $('live-title');
  const noteEl = $('live-note');
  const groupBar = $('live-groups');
  const queryInput = $('live-query');

  const FAV_KEY = 'guangying.live.favorites.v1';
  const LAST_KEY = 'guangying.live.last.v1';

  let activeGroup = '';
  let keyword = '';
  let view = ALL.slice();
  let current = null;
  let hls = null;
  let retried = false;

  const video = $('live-video');
  const dialog = $('live-player');
  const playTitle = $('live-play-title');
  const playInfo = $('live-play-info');
  const playStatus = $('live-player-status');
  const bufferEl = $('live-buffer');

  function favorites() {
    try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function saveFavorites(set) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); } catch {}
  }

  function hostOf(url) {
    try { return new URL(url).hostname; } catch { return ''; }
  }

  function render() {
    const k = keyword.trim().toLowerCase();
    view = ALL.filter(c => {
      if (activeGroup === '收藏') { if (!favorites().has(c.name)) return false; }
      else if (activeGroup && c.group !== activeGroup) return false;
      if (k && !(c.name.toLowerCase().includes(k) || hostOf(c.url).includes(k))) return false;
      return true;
    });

    titleEl.textContent = activeGroup ? (activeGroup === '收藏' ? '我的收藏' : activeGroup) : '全部频道';
    countEl.textContent = view.length + ' 个频道';
    grid.innerHTML = '';
    emptyEl.hidden = view.length > 0;

    const favs = favorites();
    for (const c of view) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'live-card' + (current && current.name === c.name ? ' playing' : '');
      card.dataset.name = c.name;
      const badge = c.group === '央视与CGTN' ? '央视 / CGTN' : c.group;
      card.innerHTML =
        '<b>' + escapeHtml(c.name) + '</b>' +
        '<span class="live-badge">' + escapeHtml(badge) + '</span>' +
        '<small>' + escapeHtml(hostOf(c.url)) + (favs.has(c.name) ? ' · ♡' : '') + '</small>';
      card.addEventListener('click', () => play(c));
      grid.appendChild(card);
    }

    statusEl.textContent = view.length
      ? '点击频道开始播放。直播为实时流，起播通常需要 2–5 秒。'
      : '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function renderGroups() {
    const favs = favorites();
    const list = groups.map(g => ({ g, n: ALL.filter(c => c.group === g).length }));
    groupBar.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.textContent = '全部 ' + ALL.length;
    allBtn.className = activeGroup === '' ? 'on' : '';
    allBtn.addEventListener('click', () => { activeGroup = ''; renderGroups(); render(); });
    groupBar.appendChild(allBtn);

    for (const { g, n } of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = g + ' ' + n;
      b.className = activeGroup === g ? 'on' : '';
      b.addEventListener('click', () => { activeGroup = g; renderGroups(); render(); });
      groupBar.appendChild(b);
    }

    if (favs.size) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '♡ 收藏 ' + favs.size;
      b.className = activeGroup === '收藏' ? 'on' : '';
      b.addEventListener('click', () => { activeGroup = '收藏'; renderGroups(); render(); });
      groupBar.appendChild(b);
    }
  }

  function destroy() {
    if (hls) { try { hls.destroy(); } catch {} hls = null; }
    try { video.removeAttribute('src'); video.load(); } catch {}
  }

  function setState(text) { playStatus.textContent = text; }
  function setBuffer(text) { bufferEl.textContent = text; }

  function attach(src) {
    destroy();
    retried = false;
    setBuffer('连接中');

    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({
        lowLatencyMode: false,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        maxBufferLength: 40,
        maxMaxBufferLength: 90,
        backBufferLength: 30,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 2,
        levelLoadingTimeOut: 15000,
        fragLoadingTimeOut: 25000,
        fragLoadingMaxRetry: 3,
        startLevel: -1,
      });
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        setState('清单已就绪，正在缓冲画面…');
        video.play().catch(() => setState('浏览器阻止了自动播放，请点播放按钮。'));
      });
      hls.on(window.Hls.Events.FRAG_BUFFERED, () => setBuffer('缓冲中'));
      hls.on(window.Hls.Events.ERROR, (_, info) => {
        if (!info || !info.fatal) return;
        if (info.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          if (!retried) {
            retried = true;
            setState('网络中断，正在重试一次…');
            try { hls.startLoad(); return; } catch {}
          }
          setState('这一路直播断了。点“下一台”或“随机换台”换一路。');
        } else if (info.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          setState('流格式异常，正在尝试恢复…');
          try { hls.recoverMediaError(); return; } catch {}
        } else {
          setState('播放失败：' + (info.details || '未知原因'));
        }
        setBuffer('已中断');
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.play().catch(() => {});
      setState('使用系统原生 HLS 播放');
    } else {
      setState('当前浏览器不支持 HLS 播放，请换用 Chrome / Edge / Safari。');
    }
  }

  function play(ch) {
    if (!ch) return;
    current = ch;
    playTitle.textContent = ch.name;
    playInfo.textContent = ch.group + ' · ' + hostOf(ch.url);
    if (!dialog.open) dialog.showModal();
    try { localStorage.setItem(LAST_KEY, ch.name); } catch {}
    updateFavButton();
    attach(ch.url);
    for (const el of grid.children) {
      el.classList.toggle('playing', el.dataset.name === ch.name);
    }
  }

  function updateFavButton() {
    const btn = $('live-fav');
    if (!current) return;
    const on = favorites().has(current.name);
    btn.classList.toggle('live-fav-on', on);
    btn.textContent = on ? '♥ 已收藏' : '♡ 收藏';
  }

  function indexOfCurrent() {
    if (!current) return -1;
    return view.findIndex(c => c.name === current.name);
  }

  function step(delta) {
    if (!view.length) return;
    let i = indexOfCurrent();
    if (i < 0) i = 0;
    else i = (i + delta + view.length) % view.length;
    play(view[i]);
  }

  // 换台随机但避开当前
  function randomNext() {
    if (view.length < 2) { step(1); return; }
    let c;
    do { c = view[Math.floor(Math.random() * view.length)]; } while (c.name === (current && current.name));
    play(c);
  }

  $('live-search').addEventListener('submit', e => { e.preventDefault(); keyword = queryInput.value || ''; render(); });
  queryInput.addEventListener('input', () => { keyword = queryInput.value || ''; render(); });
  $('live-reset').addEventListener('click', () => { queryInput.value = ''; keyword = ''; activeGroup = ''; renderGroups(); render(); });

  $('live-close').addEventListener('click', () => { destroy(); dialog.close(); });
  dialog.addEventListener('close', destroy);
  $('live-retry').addEventListener('click', () => { if (current) { setState('重新连接…'); attach(current.url); } });
  $('live-next').addEventListener('click', () => step(1));
  $('live-prev').addEventListener('click', () => step(-1));
  $('live-random').addEventListener('click', randomNext);

  $('live-fav').addEventListener('click', () => {
    if (!current) return;
    const set = favorites();
    if (set.has(current.name)) set.delete(current.name); else set.add(current.name);
    saveFavorites(set);
    updateFavButton();
    renderGroups();
    render();
  });

  $('live-copy').addEventListener('click', async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.url);
      setState('源地址已复制，可用 VLC / PotPlayer 打开。');
    } catch {
      setState('复制失败，源地址：' + current.url);
    }
  });

  $('live-fullscreen').addEventListener('click', () => {
    const stage = $('live-stage');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen();
  });

  $('live-pip').addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch { setState('当前浏览器不支持画中画。'); }
  });

  video.addEventListener('playing', () => { setBuffer('播放中'); setState('正在播放'); });
  video.addEventListener('waiting', () => setBuffer('缓冲中'));
  video.addEventListener('stalled', () => setBuffer('卡住了'));
  video.addEventListener('error', () => setBuffer('播放出错'));

  document.addEventListener('keydown', e => {
    if (!dialog.open) return;
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
  });

  // 初始
  if (!ALL.length) {
    statusEl.textContent = '频道清单为空，请先运行 scripts/build-live.mjs 生成 live-channels.js。';
    return;
  }
  if (data.updatedAt) noteEl.textContent += ' 清单更新于 ' + data.updatedAt + '，共 ' + ALL.length + ' 个频道。';
  const eyebrow = $('live-eyebrow');
  if (eyebrow) eyebrow.textContent = 'LIVE TV · ' + ALL.length + ' CHANNELS';
  renderGroups();
  render();
})();
