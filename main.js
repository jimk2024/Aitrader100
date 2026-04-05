// 动态文本框：自动从币安拉取数据并生成中文报告（支持多币种）
(function () {
  // 保存各交易对的最新文本，供AI模块选择发送
  const latestTextMap = {};
  // 保存各交易对的最新标记价（供合约模拟盘使用）
  const latestPriceMap = {};
  const endpoints = [
    'https://api.binance.com',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api3.binance.com',
  ];
  // 币安期货（USDⓈ-M 永续）端点
  const futuresEndpoints = [
    'https://fapi.binance.com',
    'https://api.binance.com',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api3.binance.com',
  ];

  const signedFuturesEndpoints = [
    'https://fapi.binance.com',
    'https://api.binance.com',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api3.binance.com',
  ];

  // 顶部价格栏元素与状态
  const topbarEls = {
    BTCUSDT: document.getElementById('pr_BTCUSDT'),
    ETHUSDT: document.getElementById('pr_ETHUSDT'),
    SOLUSDT: document.getElementById('pr_SOLUSDT'),
    BNBUSDT: document.getElementById('pr_BNBUSDT'),
    DOGEUSDT: document.getElementById('pr_DOGEUSDT'),
    XRPUSDT: document.getElementById('pr_XRPUSDT'),
    ZECUSDT: document.getElementById('pr_ZECUSDT'),
    SOONUSDT: document.getElementById('pr_SOONUSDT'),
    DASHUSDT: document.getElementById('pr_DASHUSDT'),
    LTCUSDT: document.getElementById('pr_LTCUSDT'),
    ASTERUSDT: document.getElementById('pr_ASTERUSDT'),
    SUIUSDT: document.getElementById('pr_SUIUSDT'),
  };

  // 底部价格栏元素与状态
  const bottombarEls = {
    BTCUSDT: document.getElementById('pr2_BTCUSDT'),
    ETHUSDT: document.getElementById('pr2_ETHUSDT'),
    SOLUSDT: document.getElementById('pr2_SOLUSDT'),
    BNBUSDT: document.getElementById('pr2_BNBUSDT'),
    DOGEUSDT: document.getElementById('pr2_DOGEUSDT'),
    XRPUSDT: document.getElementById('pr2_XRPUSDT'),
    ZECUSDT: document.getElementById('pr2_ZECUSDT'),
    SOONUSDT: document.getElementById('pr2_SOONUSDT'),
    DASHUSDT: document.getElementById('pr2_DASHUSDT'),
    LTCUSDT: document.getElementById('pr2_LTCUSDT'),
    ASTERUSDT: document.getElementById('pr2_ASTERUSDT'),
    SUIUSDT: document.getElementById('pr2_SUIUSDT'),
  };
  const statusDots = { ws: document.getElementById('wsDot'), api: document.getElementById('apiDot') };
  const _prevTop = {}; const _prevBottom = {};

  try {
    const tb = document.querySelector('.topbar');
    const bb = document.querySelector('.bottombar');
    setupMarquee(tb);
    setupMarquee(bb);
    startMarquee(tb);
    startMarquee(bb);
    updateBinanceStatus();
  } catch {}

  function setupMarquee(el){
    if (!el) return;
    const kids = Array.from(el.children);
    const track = document.createElement('div');
    track.className = 'marquee-track';
    kids.forEach(ch=> {
      // 给原始值节点打上 data-symbol，便于镜像更新
      try {
        const v = ch.querySelector('.value');
        const id = v?.id || '';
        const sym = id.replace(/^pr2?_/, '').toUpperCase();
        if (v && sym) v.setAttribute('data-symbol', sym);
      } catch {}
      track.appendChild(ch);
    });
    const dup = document.createDocumentFragment();
    kids.forEach(ch=>{
      const c = ch.cloneNode(true);
      try { c.querySelectorAll('[id]').forEach(n=> n.removeAttribute('id')); } catch {}
      try {
        const v2 = c.querySelector('.value');
        const v1 = ch.querySelector('.value');
        const sym = v1?.getAttribute('data-symbol');
        if (v2 && sym) v2.setAttribute('data-symbol', sym);
      } catch {}
      dup.appendChild(c);
    });
    track.appendChild(dup);
    el.appendChild(track);
  }

  function getSpeedSeconds(el){
    try {
      const v = getComputedStyle(el).getPropertyValue('--price-speed') || '';
      const n = parseFloat(v);
      return (isFinite(n) && n>0) ? n : 18;
    } catch { return 18; }
  }
  function startMarquee(el){
    const track = el && el.querySelector('.marquee-track');
    if (!el || !track) return;
    let offset = 0; let last = 0;
    const loop = (ts)=>{
      if (!last){ last = ts; requestAnimationFrame(loop); return; }
      const dt = ts - last; last = ts;
      const half = track.scrollWidth / 2;
      const sec = getSpeedSeconds(el);
      const v = half / (sec * 1000);
      offset -= v * dt;
      if (offset <= -half) offset += half;
      track.style.transform = `translateX(${offset}px)`;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  function syncMarquee(containerEl, symbol, text, cls){
    if (!containerEl) return;
    const nodes = containerEl.querySelectorAll(`.marquee-track .value[data-symbol="${symbol}"]`);
    nodes.forEach(n=>{
      if (n.id) return; // 跳过原始节点，保留渲染逻辑
      n.textContent = text;
      n.className = `value${cls?(' '+cls):''}`;
    });
  }

  let binanceWsConnected = false;
  let lastWsMsg = 0;
  let lastApiOk = 0;
  let lastApiErr = 0;
  // 全自动状态：AI解析自动执行开关 + 定时自动发送循环
  let autoExecEnabled = false; // 跟随AI刷新自动执行（第二列开关）
  let autoTimer = null;       // 定时自动发送计时器（第二列开关）

  // 去除模拟盘模式选择，保留自动执行与定时发送功能

  // ====== 实盘（U本位）配置与状态 ======
  let liveEnabled = false;
  // 实盘轮询器（用于第三列展示真实账户/持仓/委托）
  let livePollTimer = null;
  let livePollInFlight = false;
  let latestLiveEquity = null;
  let latestLiveAccount = null;
  let latestLiveRisks = [];
  let latestLiveOpenOrders = [];
  let latestMakerRate = null;
  let latestTakerRate = null;
  let autoCloseEnabled = false;
  let autoCloseThreshold = 0;
  // 解析百分数字符串到小数费率（如 "0.02%" -> 0.0002，"0.0002" -> 0.0002）
  function parsePercentRate(str){
    if (str==null) return null;
    const s = String(str).trim();
    if (!s) return null;
    if (s.endsWith('%')){
      const v = Number(s.slice(0, -1).trim());
      if (!isFinite(v)) return null;
      return v / 100; // 百分比转小数
    }
    const v = Number(s);
    return isFinite(v) ? v : null;
  }
  function updateLatestFeeRatesFromInputs(){
    try {
      const mkEl = document.getElementById('feeMakerInput');
      const tkEl = document.getElementById('feeTakerInput');
      const mkV = parsePercentRate(mkEl?.value || '');
      const tkV = parsePercentRate(tkEl?.value || '');
      if (mkV!=null) latestMakerRate = mkV;
      if (tkV!=null) latestTakerRate = tkV;
    } catch{}
  }
  // 交易对过滤器缓存：来自 /fapi/v1/exchangeInfo，用于精度与最小值校验
  const symbolFiltersCache = {}; // symbol -> { tickSize, minPrice, stepSize, minQty, mktStepSize, mktMinQty, minNotional }
  const LIVE_STORE_KEYS = {
    apiKey: 'live_api_key',
    apiSecret: 'live_api_secret'
  };
  const liveEls = {
    apiKey: document.getElementById('liveApiKey'),
    apiSecret: document.getElementById('liveApiSecret'),
    saveBtn: document.getElementById('saveLiveCfgBtn'),
    toggleBtn: document.getElementById('liveToggleBtn'),
    status: document.getElementById('liveStatus')
  };

  function loadLiveCfg(){
    try {
      const key = localStorage.getItem(LIVE_STORE_KEYS.apiKey) || '';
      const sec = localStorage.getItem(LIVE_STORE_KEYS.apiSecret) || '';
      if (liveEls.apiKey) liveEls.apiKey.value = key;
      if (liveEls.apiSecret) liveEls.apiSecret.value = sec;
      // 初次加载时同步一次手续费输入到内存
      updateLatestFeeRatesFromInputs();
      // 监听手动手续费修改
      try {
        document.getElementById('feeMakerInput')?.addEventListener('change', updateLatestFeeRatesFromInputs);
        document.getElementById('feeTakerInput')?.addEventListener('change', updateLatestFeeRatesFromInputs);
      } catch{}
    } catch {}
  }

  // 从后端配置自动调取（不暴露密钥，仅可能提供 serverUrl 与默认开关）
async function applyBackendCfg(){
  try {
    const res = await fetch('/config');
    if (res.ok) {
      const cfg = await res.json();
      const isTradingPage = /trading\.html$/i.test(location.pathname);
      const defLive = !!(cfg?.defaults?.liveEnabled);
      if (isTradingPage && defLive) setLiveEnabled(true);
    }
  } catch {}
}

  function saveLiveCfg(){
    try {
      const key = (liveEls.apiKey && liveEls.apiKey.value || '').trim();
      const sec = (liveEls.apiSecret && liveEls.apiSecret.value || '').trim();
      localStorage.setItem(LIVE_STORE_KEYS.apiKey, key);
      localStorage.setItem(LIVE_STORE_KEYS.apiSecret, sec);
      if (liveEls.status) liveEls.status.textContent = '已保存';
      // 保存配置后自动开启实盘模式
      setLiveEnabled(true);
    } catch {}
  }

  async function setLiveEnabled(val){
    liveEnabled = !!val;
    try {
      if (liveEls.toggleBtn) {
        liveEls.toggleBtn.textContent = liveEnabled ? '实盘：开启' : '实盘：关闭';
        liveEls.toggleBtn.classList.toggle('toggle-on', liveEnabled);
        liveEls.toggleBtn.classList.toggle('toggle-off', !liveEnabled);
        // 开启时按钮变红更醒目
        liveEls.toggleBtn.classList.toggle('live-on', liveEnabled);
      }
      if (liveEls.status) liveEls.status.textContent = liveEnabled ? '实盘已启用' : '实盘未启用';
    } catch{}
    try { updateContractPanelTitle(); } catch {}
    try { applyLiveUiToggles(); } catch {}
    
    // 实盘启用时，初始展示占位符，待首次快照刷新后填充
    if (liveEnabled) {
      if (simEls.accEquity) simEls.accEquity.textContent = '—';
      if (simEls.accAvail) simEls.accAvail.textContent = '—';
      startLivePolling(); 
      try { startLiveUserStream(); } catch {}
    } else {
      stopLivePolling();
      try { stopLiveUserStream(); } catch {}
    }
  }

  function updateContractPanelTitle(){
    const el = document.querySelector('.contract-panel .panel__title');
    if (!el) return;
    el.textContent = '合约实盘（USDT本位·全仓模式）';
  }

  function applyLiveUiToggles(){
    try {
      const rowInit = simEls.initBalance && simEls.initBalance.closest('.form-row');
      if (rowInit) rowInit.style.display = 'none';
      if (simEls.saveBalanceBtn) simEls.saveBalanceBtn.style.display = 'none';
      if (simEls.placeBtn) simEls.placeBtn.style.display = 'none';
      if (simEls.resetBtn) simEls.resetBtn.style.display = 'none';
      const balItem = simEls.accBalance && simEls.accBalance.closest('.item');
      if (balItem) balItem.style.display = 'none';
      // 保持手续费输入在设置面板，无需在账户框中显示费率文本
    } catch{}
  }

  

async function fetchLiveSnapshot(){
  const recv = 30000;
      const [account, risks, openOrders] = await Promise.all([
        binanceSignedDirect('GET', '/fapi/v2/account', { recvWindow: recv }),
        binanceSignedDirect('GET', '/fapi/v2/positionRisk', { recvWindow: recv }),
        binanceSignedDirect('GET', '/fapi/v1/openOrders', { recvWindow: recv })
      ]);
      return { account, risks: Array.isArray(risks)?risks:[], openOrders: Array.isArray(openOrders)?openOrders:[] };
}

  function selectedSymbolsForLiveHistory(){
    const fromPos = (latestLiveRisks||[]).map(r=> String(r.symbol||'').toUpperCase()).filter(Boolean);
    const fromOpen = (latestLiveOpenOrders||[]).map(o=> String(o.symbol||'').toUpperCase()).filter(Boolean);
    const set = new Set([...fromPos, ...fromOpen]);
    const list = Array.from(set);
    return list.length ? list : ['BTCUSDT'];
  }

  // 轻量级延迟（用于顺序请求以避免限速/权重峰值）
  function wait(ms){ return new Promise(r=> setTimeout(r, ms)); }

async function fetchLiveOrderHistory(symbols, limit=50){
    return [];
}

async function fetchLiveTrades(symbols, limit=50){
    return [];
}

  function renderLiveAccount(account){
    if (!account) return;
    try {
      latestLiveAccount = account;
      const balance = Number(account.totalWalletBalance || account.totalMarginBalance || 0);
      const equity = Number(account.totalMarginBalance || balance);
      const upnl = Number(account.totalUnrealizedProfit || 0);
      const avail = Number(account.availableBalance || balance);
      // 估算已用保证金：遍历 positions 结合标记价
      let used = 0;
      (account.positions||[]).forEach(p=>{
        const sym = String(p.symbol||'').toUpperCase();
        const qty = Math.abs(Number(p.positionAmt||0));
        const lev = Math.max(1, Number(p.leverage||1));
        const mp = Number(latestPriceMap[sym] || p.markPrice || p.entryPrice || 0);
        if (qty>0 && mp>0) used += (qty * mp) / lev;
      });
      latestLiveEquity = equity;
      if (simEls.accBalance) simEls.accBalance.textContent = fmt(balance, 2);
      if (simEls.accEquity) simEls.accEquity.textContent = fmt(equity, 2);
      if (simEls.accUsedMargin) simEls.accUsedMargin.textContent = fmt(used, 2);
      if (simEls.accAvail) simEls.accAvail.textContent = fmt(avail, 2);
      if (simEls.accUpnl) simEls.accUpnl.textContent = fmt(upnl, 2);
      if (simEls.accRpnl) simEls.accRpnl.textContent = '—';
      // 通知收益曲线进行一次即时采样（在模拟盘模块中监听此事件）
      try { window.dispatchEvent(new CustomEvent('equity_update')); } catch {}
      // 使用手动输入手续费作为来源（不再读取账户返回的费率）
      updateLatestFeeRatesFromInputs();
      try { maybeAutoClose(); } catch {}
    } catch{}
  }

  function renderLivePositions(risks){
    try {
      const tbodyPos = simEls.posTable.querySelector('tbody');
      tbodyPos.innerHTML = '';
      risks.forEach(it=>{
        const symbol = String(it.symbol||'');
        const amt = Number(it.positionAmt||0);
        if (!symbol || !amt) return;
        const tr = document.createElement('tr');
        const side = amt>0 ? '多' : '空';
        const qtyAbs = Math.abs(amt);
        const entry = Number(it.entryPrice||0);
        const lev = Number(it.leverage||1);
        const upnl = Number((typeof it.unRealizedProfit!=='undefined' ? it.unRealizedProfit : it.unrealizedProfit)||0);
        const mp = Number(latestPriceMap[symbol] || it.markPrice || entry);
        const used = mp>0 ? (qtyAbs * mp) / Math.max(1, lev) : 0;
        const td = (t)=>{ const el=document.createElement('td'); el.textContent=t; return el; };
        tr.appendChild(td(symbol));
        tr.appendChild(td(side));
        tr.appendChild(td(fmt(qtyAbs, 4)));
        tr.appendChild(td(fmt(entry, decimalsForSymbol(symbol))));
        tr.appendChild(td(`${lev}x`));
        tr.appendChild(td(fmt(upnl, 2)));
        tr.appendChild(td(fmt(used, 2)));
        const op = document.createElement('td');
        const a = document.createElement('span'); a.className='action-link'; a.textContent='平仓';
        const posSide = String(it.positionSide || (amt>0?'LONG':'SHORT'));
        a.addEventListener('click', ()=> execLiveOp({ action:'close', symbol, positionSide: posSide }));
        op.appendChild(a); tr.appendChild(op);
        tbodyPos.appendChild(tr);
      });
    } catch{}
  }

  function renderLiveOpenOrders(openOrders){
    try {
      const tbodyOpen = simEls.openOrdersTable.querySelector('tbody');
      tbodyOpen.innerHTML = '';
      openOrders.forEach(o=>{
        const tr = document.createElement('tr');
        const td = (t)=>{ const el=document.createElement('td'); el.textContent=t; return el; };
        const ts = Number(o.updateTime || o.time || Date.now());
        tr.appendChild(td(new Date(ts).toLocaleString()));
        const symbol = String(o.symbol||'');
        tr.appendChild(td(symbol));
        const type = String(o.type||'').toUpperCase();
        tr.appendChild(td(String(o.side||'').toUpperCase()));
        tr.appendChild(td(type));
        // 止盈/止损类订单显示触发价；跟踪止损显示激活价
        let dispPrice = 0;
        if (type==='TAKE_PROFIT_MARKET' || type==='STOP_MARKET') {
          dispPrice = Number(o.stopPrice || o.activatePrice || 0);
        } else if (type==='TAKE_PROFIT' || type==='STOP') {
          dispPrice = Number(o.stopPrice || o.price || 0);
        } else if (type==='TRAILING_STOP_MARKET') {
          dispPrice = Number(o.activatePrice || o.stopPrice || 0);
        } else {
          dispPrice = Number(o.price || 0);
        }
        tr.appendChild(td(fmt(dispPrice, decimalsForSymbol(symbol))));
        const qtyRaw = Number(o.origQty||o.quantity||0);
        const qtyText = (qtyRaw>0)
          ? fmt(qtyRaw, 4)
          : ((type.indexOf('STOP')>=0 || type.indexOf('TAKE_PROFIT')>=0) && (o.closePosition===true)) ? '全部' : '—';
        tr.appendChild(td(qtyText));
        tr.appendChild(td(String(o.status||'NEW')));
        const op = document.createElement('td');
        const c = document.createElement('span'); c.className='action-link'; c.textContent='撤销';
        c.addEventListener('click', async ()=>{
          try{
            await binanceSignedDirect('DELETE', '/fapi/v1/order', {
              symbol,
              orderId: o.orderId,
              origClientOrderId: o.clientOrderId || o.origClientOrderId,
              recvWindow: 30000
            });
            setSimStatus('状态：已撤销委托');
          } catch(e){ setSimStatus(`状态：撤销失败：${e?.message||e}`); }
        });
        op.appendChild(c); tr.appendChild(op);
        tbodyOpen.appendChild(tr);
      });
    } catch{}
  }

function renderLiveOrderHistory(list){
    return;
}

function renderLiveTradeHistory(list){
    return;
}

  async function refreshLive(){
    if (Date.now() < liveBackoffUntil){ setSimStatus('状态：IP限流冷却中，稍后自动重试'); return; }
    if (!liveEnabled || livePollInFlight) return;
    livePollInFlight = true;
    try {
      const snap = await fetchLiveSnapshot();
      latestLiveRisks = Array.isArray(snap.risks) ? snap.risks : [];
      latestLiveOpenOrders = Array.isArray(snap.openOrders) ? snap.openOrders : [];
      renderLiveAccount(snap.account);
      renderLivePositions(snap.risks);
      renderLiveOpenOrders(snap.openOrders);
      
      setSimStatus('状态：实盘数据已刷新');
    } catch(e){ setSimStatus(`状态：实盘刷新失败：${e?.message||e}`); }
    finally { livePollInFlight = false; }
  }

  async function refreshLiveLight(){
    if (Date.now() < liveBackoffUntil){ setSimStatus('状态：IP限流冷却中，稍后自动重试'); return; }
    if (!liveEnabled || livePollInFlight) return;
    livePollInFlight = true;
    try {
      const snap = await fetchLiveSnapshot();
      latestLiveRisks = Array.isArray(snap.risks) ? snap.risks : [];
      latestLiveOpenOrders = Array.isArray(snap.openOrders) ? snap.openOrders : [];
      renderLiveAccount(snap.account);
      renderLivePositions(snap.risks);
      renderLiveOpenOrders(snap.openOrders);
      setSimStatus('状态：实盘数据已刷新');
    } catch(e){ setSimStatus(`状态：实盘刷新失败：${e?.message||e}`); }
    finally { livePollInFlight = false; }
  }

  function startLivePolling(){
    stopLivePolling();
    // 首次立即刷新，随后每5秒刷新一次
    refreshLive();
    livePollTimer = setInterval(refreshLive, 2000);
  }
  function stopLivePolling(){
    if (livePollTimer){ clearInterval(livePollTimer); livePollTimer = null; }
  }

  let liveListenKey = null;
  let liveUserWs = null;
  let liveUserKeepaliveTimer = null;
  let liveUserRefreshTimer = null;
  let lastHistFetchAt = 0;
  let liveBackoffUntil = 0;
  async function createListenKey(){
    const apiKey = (liveEls.apiKey && liveEls.apiKey.value) || localStorage.getItem(LIVE_STORE_KEYS.apiKey) || '';
    if (!apiKey) throw new Error('Missing apiKey');
    let last = '';
    for (const base of signedFuturesEndpoints){
      try {
        const res = await fetch(base + '/fapi/v1/listenKey', { method: 'POST', headers: { 'X-MBX-APIKEY': apiKey } });
        const d = await res.json();
        const lk = d && (d.listenKey || d.data && d.data.listenKey) || '';
        if (lk) return lk;
        last = lk;
      } catch(e){ }
    }
    return last;
  }
  async function keepaliveListenKey(){
    const apiKey = (liveEls.apiKey && liveEls.apiKey.value) || localStorage.getItem(LIVE_STORE_KEYS.apiKey) || '';
    if (!apiKey || !liveListenKey) return;
    for (const base of signedFuturesEndpoints){
      try { await fetch(base + '/fapi/v1/listenKey', { method: 'PUT', headers: { 'X-MBX-APIKEY': apiKey } }); return; } catch {}
    }
  }
  function scheduleUserKeepalive(){
    if (liveUserKeepaliveTimer){ clearInterval(liveUserKeepaliveTimer); liveUserKeepaliveTimer = null; }
    liveUserKeepaliveTimer = setInterval(keepaliveListenKey, 55*60*1000);
  }
  function triggerImmediateLiveRefresh(){
    if (livePollInFlight){
      if (liveUserRefreshTimer) return;
      liveUserRefreshTimer = setTimeout(()=>{ liveUserRefreshTimer = null; try { refreshLiveLight(); } catch {} }, 200);
    } else {
      try { refreshLiveLight(); } catch {}
    }
  }
  async function startLiveUserStream(){
    try {
      liveListenKey = await createListenKey();
      if (!liveListenKey) return;
      const url = `wss://fstream.binance.com/ws/${liveListenKey}`;
      liveUserWs = new WebSocket(url);
      liveUserWs.onopen = ()=>{ binanceWsConnected = true; updateBinanceStatus(); scheduleUserKeepalive(); };
      liveUserWs.onmessage = (ev)=>{
        try {
          const obj = JSON.parse(ev.data||'{}');
          const data = obj && (obj.data || obj) || {};
          const et = String(data.e || data.eventType || '');
          if (et){ lastWsMsg = Date.now(); updateBinanceStatus(); }
          if (et==='ACCOUNT_UPDATE' || et==='ORDER_TRADE_UPDATE') triggerImmediateLiveRefresh();
          if (et && et.toLowerCase().includes('listenkey')){ try { stopLiveUserStream(); startLiveUserStream(); } catch {} }
        } catch {}
      };
      liveUserWs.onerror = ()=>{ binanceWsConnected = false; updateBinanceStatus(); };
      liveUserWs.onclose = ()=>{ binanceWsConnected = false; updateBinanceStatus(); setTimeout(()=>{ try { stopLiveUserStream(); startLiveUserStream(); } catch {} }, 3000); };
    } catch {}
  }
  function stopLiveUserStream(){
    try { if (liveUserKeepaliveTimer){ clearInterval(liveUserKeepaliveTimer); liveUserKeepaliveTimer = null; } } catch {}
    try { if (liveUserRefreshTimer){ clearTimeout(liveUserRefreshTimer); liveUserRefreshTimer = null; } } catch {}
    try { if (liveUserWs){ liveUserWs.close(); liveUserWs = null; } } catch {}
    liveListenKey = null;
  }

  let binanceTimeOffsetMs = 0;
  async function refreshBinanceTimeOffset(){
    try {
      const d = await binanceFutures('/fapi/v1/time');
      const t = Number(d && (d.serverTime || d.server_time) || 0);
      if (t && isFinite(t)) binanceTimeOffsetMs = t - Date.now();
    } catch {}
  }
  async function hmacSha256Hex(secret, msg){
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
    const bytes = new Uint8Array(sig);
    let out = '';
    for (let i=0;i<bytes.length;i++){ out += bytes[i].toString(16).padStart(2,'0'); }
    return out;
  }
  async function binanceSignedDirect(method, path, params={}){
    if (!(typeof isSecureContext !== 'undefined' ? isSecureContext : (location.protocol === 'https:')) || !(crypto && crypto.subtle)){
      throw new Error('浏览器未启用WebCrypto或非HTTPS环境，无法签名请求');
    }
    const apiKey = (liveEls.apiKey && liveEls.apiKey.value) || localStorage.getItem(LIVE_STORE_KEYS.apiKey) || '';
    const apiSecret = (liveEls.apiSecret && liveEls.apiSecret.value) || localStorage.getItem(LIVE_STORE_KEYS.apiSecret) || '';
    if (!apiKey || !apiSecret) throw new Error('Missing apiKey/apiSecret');
    const m = String(method||'GET').toUpperCase();
    let lastErr = null;
    for (const base of signedFuturesEndpoints){
      try {
        const ts1 = Date.now() + binanceTimeOffsetMs;
        const data1 = Object.assign({}, params || {}, { timestamp: ts1 });
        const qs1 = new URLSearchParams(data1).toString();
        const sig1 = await hmacSha256Hex(apiSecret, qs1);
        const url1 = base + String(path || '') + '?' + qs1 + '&signature=' + sig1;
        const headers = { 'X-MBX-APIKEY': apiKey };
        let res = await fetch(url1, { method: m, headers });
        if (!res.ok){
          if (res.status === 418){
            liveBackoffUntil = Date.now() + 2*60*1000;
            let txt = ''; try { txt = await res.text(); } catch {}
            throw new Error(txt || 'Binance返回418：IP已被临时限制，请稍后再试');
          }
          let payload = null; try { payload = await res.json(); } catch {}
          const code = (payload && (payload.code || payload.detail && payload.detail.code)) || null;
          if (code === -1021 || code === -1022) {
            await refreshBinanceTimeOffset();
            const ts2 = Date.now() + binanceTimeOffsetMs;
            const data2 = Object.assign({}, params || {}, { timestamp: ts2 });
            const qs2 = new URLSearchParams(data2).toString();
            const sig2 = await hmacSha256Hex(apiSecret, qs2);
            const url2 = base + String(path || '') + '?' + qs2 + '&signature=' + sig2;
            const res2 = await fetch(url2, { method: m, headers });
            if (!res2.ok){
              let txt=''; let p2=null; try{ p2=await res2.json(); }catch{}
              if (p2 && (p2.code || p2.msg || p2.message)) throw new Error(`${p2.code??res2.status} ${p2.msg||p2.message||res2.statusText}`);
              try{ txt=await res2.text(); }catch{}
              throw new Error(txt || (res2.status+' '+res2.statusText));
            }
            return await res2.json();
          }
          if (payload && (payload.code || payload.msg || payload.message)){
            throw new Error(`${payload.code??res.status} ${payload.msg||payload.message||res.statusText}`);
          }
          let txt = ''; try { txt = await res.text(); } catch {}
          throw new Error(txt || (res.status+' '+res.statusText));
        }
        return await res.json();
      } catch(e){ lastErr = e; }
    }
    if (lastErr) throw lastErr;
    throw new Error('请求失败');
  }

  function oppositeSide(side){ return side==='long' ? 'SELL' : 'BUY'; }
  function openSide(side){ return side==='short' ? 'SELL' : 'BUY'; }
  // 数量步进静态后备（在未拉取到 filters 前使用）
  function qtyStepFallback(symbol, isMarket){
    const s = String(symbol||'').toUpperCase();
    if (s==='BTCUSDT') return isMarket ? 0.001 : 0.001;
    if (s==='ETHUSDT') return isMarket ? 0.01 : 0.01;
    if (s==='SOLUSDT') return isMarket ? 0.1 : 0.1;
    if (s==='BNBUSDT') return isMarket ? 0.01 : 0.01;
    if (s==='DOGEUSDT') return isMarket ? 1 : 1;
    if (s==='XRPUSDT') return isMarket ? 1 : 1;
    return isMarket ? 0.001 : 0.001;
  }
  function _decimalsFromStep(step){
    const s = String(step||'');
    if (!s) return 8;
    if (s.includes('e-')){ const n = Number(s.split('e-')[1]||'0'); return Number.isFinite(n)?n:8; }
    const i = s.indexOf('.');
    return i>=0 ? (s.length - i - 1) : 0;
  }
  function roundStep(val, step){
    const s = Number(step||0.001);
    if (!isFinite(val) || s<=0) return val;
    const raw = Math.floor(val / s + 1e-9) * s;
    const digits = _decimalsFromStep(step);
    return Number(raw.toFixed(digits));
  }

  function roundTick(val, tick){
    const t = Number(tick||0.01);
    if (!isFinite(val) || t<=0) return val;
    return Math.floor(val / t + 1e-9) * t;
  }

  function getFiltersForSymbol(symbol){
    return symbolFiltersCache[String(symbol||'').toUpperCase()] || null;
  }

  async function ensureExchangeInfoFor(symbols){
    const need = symbols.filter(s=> !symbolFiltersCache[String(s).toUpperCase()]);
    if (!need.length) return;
    const info = await binanceFutures('/fapi/v1/exchangeInfo');
    const arr = Array.isArray(info?.symbols)? info.symbols : [];
    for (const s of arr){
      const sym = String(s?.symbol||'').toUpperCase();
      if (!need.includes(sym)) continue;
      const filters = Array.isArray(s?.filters)? s.filters : [];
      const byType = {};
      for (const f of filters) byType[f.filterType] = f;
      const pf = byType.PRICE_FILTER || {};
      const lot = byType.LOT_SIZE || {};
      const mkt = byType.MARKET_LOT_SIZE || {};
      const mn = byType.MIN_NOTIONAL || byType.NOTIONAL || {};
      symbolFiltersCache[sym] = {
        tickSize: Number(pf.tickSize||0) || null,
        minPrice: Number(pf.minPrice||0) || null,
        maxPrice: Number(pf.maxPrice||0) || null,
        stepSize: Number(lot.stepSize||0) || null,
        minQty: Number(lot.minQty||0) || null,
        mktStepSize: Number(mkt.stepSize||0) || null,
        mktMinQty: Number(mkt.minQty||0) || null,
        minNotional: Number(mn.minNotional||0) || null,
      };
    }
  }

  function qtyStepForSymbol(symbol, isMarket){
    const f = getFiltersForSymbol(symbol);
    if (!f) return qtyStepFallback(symbol, !!isMarket);
    const step = isMarket ? (f.mktStepSize || f.stepSize || 0.001) : (f.stepSize || 0.001);
    return step;
  }

  function tickSizeForSymbol(symbol){
    const f = getFiltersForSymbol(symbol);
    return f?.tickSize || 0.01;
  }

  function minQtyForSymbol(symbol, isMarket){
    const f = getFiltersForSymbol(symbol);
    if (!f) return 0;
    return isMarket ? (f.mktMinQty || f.minQty || 0) : (f.minQty || 0);
  }

  function minNotionalForSymbol(symbol){
    const f = getFiltersForSymbol(symbol);
    return f?.minNotional || 0;
  }

  async function fetchIsHedgeMode(){
    try {
      const r = await binanceSignedDirect('GET', '/fapi/v1/positionSide/dual', {});
      if (typeof r?.dualSidePosition !== 'undefined') return !!r.dualSidePosition;
    } catch {}
    try {
      const acc = await binanceSignedDirect('GET', '/fapi/v2/account', {});
      if (typeof acc?.dualSidePosition !== 'undefined') return !!acc.dualSidePosition;
    } catch {}
    try {
      const risks = await binanceSignedDirect('GET', '/fapi/v2/positionRisk', {});
      const arr = Array.isArray(risks) ? risks : [];
      const sideSet = new Set(arr.map(it=> String(it.positionSide||'').toUpperCase()));
      if (sideSet.has('LONG') || sideSet.has('SHORT')) return true;
      if (sideSet.has('BOTH')) return false;
    } catch {}
    return null; // 无法确认
  }

  // 下单辅助：遇到 -4061（持仓模式不匹配）时自动切换携带 positionSide 与否重试
  async function postOrderWithHedgeFallback(params, { isHedge, posSide }){
    const isPosSideErr = (e)=>{
      const s = String(e?.message||e||'');
      return s.includes('-4061') || /position side does not match/i.test(s);
    };
    try {
      await binanceSignedDirect('POST', '/fapi/v1/order', params);
    } catch (e) {
      if (!isPosSideErr(e)) throw e;
      if (isHedge){
        const p = { ...params }; delete p.positionSide;
        await binanceSignedDirect('POST', '/fapi/v1/order', p);
        return;
      } else {
        const p = { ...params };
        if (posSide) p.positionSide = posSide;
        await binanceSignedDirect('POST', '/fapi/v1/order', p);
        return;
      }
    }
  }

  // 设置杠杆（若提供 lev），失败不阻断下单
  async function setLeverageIfNeeded(symbol, lev){
    const raw = Number(lev||0);
    if (!isFinite(raw) || raw < 1) return;
    const leverage = Math.max(1, Math.min(125, Math.floor(raw)));
    try {
      await binanceSignedDirect('POST', '/fapi/v1/leverage', { symbol, leverage, recvWindow: 30000 });
    } catch (e){
      // 不中断流程，仅提示
      try { setSimStatus(`状态：设置杠杆失败 ${symbol} ${leverage}x：${e?.message||e}`); } catch {}
    }
  }

  async function execLiveOp(op){
    const act = String(op?.action||'').toLowerCase();
    if (act==='open'){
      // 确保加载过滤器
      const symbol = String(op.symbol||'').toUpperCase();
      const side = openSide(op.side==='short'?'short':'long');
      const type = op.type==='limit' ? 'LIMIT' : 'MARKET';
      const qty = Number(op.qty||0);
      if (!symbol || !qty || qty<=0) throw new Error('指令错误：数量或交易对无效');
      // 账户模式：对冲/单向（稳妥检测）
      let isHedge = await fetchIsHedgeMode();
      if (isHedge === null) isHedge = false; // 无法确认时默认按单向试；若报 -4061 再人工处理
      await ensureExchangeInfoFor([symbol]);
      // 精度与最小值校验
      const step = qtyStepForSymbol(symbol, type==='MARKET');
      const tick = tickSizeForSymbol(symbol);
      const minQty = minQtyForSymbol(symbol, type==='MARKET');
      const qNorm = roundStep(qty, step);
      if (qNorm < minQty - 1e-12) throw new Error(`数量过小：最小 ${minQty}`);
      // 若提供 lev，则在开仓前尝试设置杠杆
      await setLeverageIfNeeded(symbol, op.lev);
      const baseParams = { symbol, side, type, recvWindow: 30000 };
      const posSide = (op.side==='short') ? 'SHORT' : 'LONG';
      if (isHedge) baseParams.positionSide = posSide;
      if (type==='MARKET') {
        baseParams.quantity = qNorm;
        const mn = minNotionalForSymbol(symbol);
        if (mn>0){
          const mp = Number(latestPriceMap[symbol]||0);
          if (mp>0 && mp * baseParams.quantity < mn - 1e-9){
            throw new Error(`名义金额过小：需≥${mn}`);
          }
        }
      } else {
        const price = Number(op.price||0);
        if (!price || price<=0) throw new Error('限价需有效价格');
        baseParams.timeInForce = 'GTC';
        baseParams.quantity = qNorm;
        baseParams.price = roundTick(price, tick);
        const f = getFiltersForSymbol(symbol) || {};
        if (isFinite(Number(f.minPrice)) && Number(f.minPrice) > 0 && baseParams.price < Number(f.minPrice) - 1e-12) {
          throw new Error(`价格过低：最低 ${f.minPrice}`);
        }
        if (isFinite(Number(f.maxPrice)) && Number(f.maxPrice) > 0 && baseParams.price > Number(f.maxPrice) + 1e-12) {
          throw new Error(`价格过高：最高 ${f.maxPrice}`);
        }
        // MIN_NOTIONAL 校验（price * qty）
        const mn = minNotionalForSymbol(symbol);
        if (mn>0 && baseParams.price * baseParams.quantity < mn - 1e-9) {
          throw new Error(`名义金额过小：需≥${mn}`);
        }
      }
      await binanceSignedDirect('POST', '/fapi/v1/order', baseParams);
      // 附加TP/SL（使用MARK_PRICE触发，平掉全部持仓）
      const tp = Number(op.sl_tp?.tp||op.tp||'') || null;
      const sl = Number(op.sl_tp?.sl||op.sl||'') || null;
      const tpSide = oppositeSide(op.side==='short'?'short':'long');
      if (tp){
        await postOrderWithHedgeFallback({
          symbol,
          side: tpSide,
          type: 'TAKE_PROFIT_MARKET',
          stopPrice: roundTick(tp, tickSizeForSymbol(symbol)),
          closePosition: true,
          workingType: 'MARK_PRICE',
          ...(isHedge ? { positionSide: posSide } : {}),
          recvWindow: 30000
        }, { isHedge, posSide });
      }
      if (sl){
        await postOrderWithHedgeFallback({
          symbol,
          side: tpSide,
          type: 'STOP_MARKET',
          stopPrice: roundTick(sl, tickSizeForSymbol(symbol)),
          closePosition: true,
          workingType: 'MARK_PRICE',
          ...(isHedge ? { positionSide: posSide } : {}),
          recvWindow: 30000
        }, { isHedge, posSide });
      }
      setSimStatus(`状态：实盘下单成功 ${symbol} ${side} qty=${qty}`);
      return;
    }
    if (act==='set_brackets' && op.symbol){
      const symbol = String(op.symbol||'').toUpperCase();
      const tp = Number(op?.tp || op?.sl_tp?.tp || '') || null;
      const sl = Number(op?.sl || op?.sl_tp?.sl || '') || null;
      if (tp==null && sl==null){ setSimStatus('状态：未提供TP/SL'); return; }
      // 检测持仓模式
      let isHedge = await fetchIsHedgeMode();
      if (isHedge === null) isHedge = false;
      await ensureExchangeInfoFor([symbol]);
      // 先撤该交易对对应的TP/SL（对冲模式按positionSide过滤）
      try {
        let openOrders = [];
        openOrders = await binanceSignedDirect('GET', '/fapi/v1/openOrders', { symbol, recvWindow: 30000 }) || [];
        const tpslTypes = new Set(['TAKE_PROFIT','TAKE_PROFIT_MARKET','STOP','STOP_MARKET','TRAILING_STOP_MARKET']);
        const cancelList = (Array.isArray(openOrders)?openOrders:[]).filter(o=>{
          const t = String(o.type||'').toUpperCase();
          if (!tpslTypes.has(t)) return false;
          return true; // 统一撤掉全部保护单
        });
        for (const o of cancelList){
          try { await binanceSignedDirect('DELETE','/fapi/v1/order',{ symbol, orderId: o.orderId, recvWindow: 30000 }); } catch(e){}
          await wait(100);
        }
      } catch {}
      // 为当前持仓（可能LONG/SHORT各一）设置新的保护单
      let risks = [];
      risks = await binanceSignedDirect('GET', '/fapi/v2/positionRisk', { recvWindow: 30000 }) || [];
      const list = (Array.isArray(risks)?risks:[]).filter(r=> String(r.symbol||'').toUpperCase()===symbol && Number(r.positionAmt||0)!==0);
      if (!list.length){ setSimStatus('状态：无持仓可设置保护'); return; }
      for (const it of list){
        const amt = Number(it.positionAmt||0);
        const posSide = amt>0 ? 'LONG' : 'SHORT';
        const tpSide = amt>0 ? 'SELL' : 'BUY'; // 保护单方向与持仓相反
        const tick = tickSizeForSymbol(symbol);
        if (tp!=null){
          await postOrderWithHedgeFallback({
            symbol,
            side: tpSide,
            type: 'TAKE_PROFIT_MARKET',
            stopPrice: roundTick(tp, tick),
            closePosition: true,
            workingType: 'MARK_PRICE',
            ...(isHedge ? { positionSide: posSide } : {}),
            recvWindow: 30000
          }, { isHedge, posSide });
          await wait(120);
        }
        if (sl!=null){
          await postOrderWithHedgeFallback({
            symbol,
            side: tpSide,
            type: 'STOP_MARKET',
            stopPrice: roundTick(sl, tick),
            closePosition: true,
            workingType: 'MARK_PRICE',
            ...(isHedge ? { positionSide: posSide } : {}),
            recvWindow: 30000
          }, { isHedge, posSide });
          await wait(120);
        }
      }
      setSimStatus(`状态：已重置保护单 ${symbol} ${list.length}个方向`);
      return;
    }
    if (act==='close' && op.symbol){
      const symbol = String(op.symbol).toUpperCase();
      // 查询持仓方向与数量
      let risks = [];
      try { risks = await binanceSignedDirect('GET', '/fapi/v2/positionRisk', { recvWindow: 30000 }) || []; } catch(_){ }
      const list = (Array.isArray(risks)?risks:[]).filter(r=> String(r.symbol).toUpperCase()===symbol);
      if (!list.length){ setSimStatus('状态：实盘无持仓'); return; }
      // 对冲模式优先按参数 positionSide；否则取非零的那一个
      let isHedge = await fetchIsHedgeMode();
      if (isHedge === null) isHedge = false;
      let chosen = null;
      if (isHedge && op.positionSide){
        chosen = list.find(r=> String(r.positionSide||'').toUpperCase()===String(op.positionSide||'').toUpperCase());
      }
      if (!chosen){
        chosen = list.find(r=> Number(r.positionAmt||0) !== 0) || list[0];
      }
      const amt = Number(chosen?.positionAmt||0);
      if (!amt){ setSimStatus('状态：实盘无持仓'); return; }
      const qty = Math.abs(amt);
      const side = amt>0 ? 'SELL' : 'BUY';
      const posSide = amt>0 ? 'LONG' : 'SHORT';
      await ensureExchangeInfoFor([symbol]);
      // 先撤对应TP/SL（避免触发）
      try {
        let openOrders = [];
        try { openOrders = await binanceSignedDirect('GET', '/fapi/v1/openOrders', { symbol, recvWindow: 30000 }) || []; } catch(_){ openOrders = []; }
        const tpslTypes = new Set(['TAKE_PROFIT','TAKE_PROFIT_MARKET','STOP','STOP_MARKET','TRAILING_STOP_MARKET']);
        const cancelList = (Array.isArray(openOrders)?openOrders:[]).filter(o=>{
          const t = String(o.type||'').toUpperCase();
          if (!tpslTypes.has(t)) return false;
          if (isHedge) return String(o.positionSide||'').toUpperCase()===posSide;
          return true;
        });
        for (const o of cancelList){
          try {
            await binanceSignedDirect('DELETE','/fapi/v1/order',{
              symbol,
              orderId: o.orderId,
              origClientOrderId: o.clientOrderId || o.origClientOrderId,
              recvWindow: 30000
            });
          } catch(e){}
        }
      } catch(e){
        // 忽略撤单错误，继续平仓
      }
      const qNorm = roundStep(qty, qtyStepForSymbol(symbol, true));
      // 单向模式使用 reduceOnly；对冲模式通过 positionSide 精确平仓
      const params = { symbol, side, type:'MARKET', quantity: qNorm, recvWindow: 30000 };
      if (isHedge) params.positionSide = posSide;
      // 仅在单向模式发送 reduceOnly，避免 -1106 错误
      if (!isHedge) params.reduceOnly = true;
      await binanceSignedDirect('POST', '/fapi/v1/order', params);
      setSimStatus(`状态：实盘平仓成功 ${symbol} qty=${qty}`);
      return;
    }
    if (act==='cancel_all'){
      const symbol = String(op.symbol||'').toUpperCase();
      await binanceSignedDirect('DELETE', '/fapi/v1/allOpenOrders', { symbol, recvWindow: 30000 });
      setSimStatus(`状态：实盘撤销全部委托 ${symbol}`);
      return;
    }
    if (act==='close_all'){
      let risks = [];
      try { risks = await binanceSignedDirect('GET', '/fapi/v2/positionRisk', {}) || []; } catch(_){ }
      const arr = Array.isArray(risks)?risks:[];
      try { await ensureExchangeInfoFor(arr.map(it=> String(it.symbol||'')).filter(Boolean)); } catch {}
      // 检测持仓模式
      let isHedge = await fetchIsHedgeMode();
      if (isHedge === null) isHedge = false;
      for (const it of arr){
        const symbol = String(it.symbol||'');
        const amt = Number(it.positionAmt||0);
        if (!symbol || !amt) continue;
        const qty = Math.abs(amt);
        const side = amt>0 ? 'SELL' : 'BUY';
        const posSide = amt>0 ? 'LONG' : 'SHORT';
        // 先撤该交易对对应的TP/SL（对冲模式按positionSide过滤）
        try {
          let openOrders = [];
          try { openOrders = await binanceSignedDirect('GET', '/fapi/v1/openOrders', { symbol, recvWindow: 30000 }) || []; } catch(_){ openOrders = []; }
          const tpslTypes = new Set(['TAKE_PROFIT','TAKE_PROFIT_MARKET','STOP','STOP_MARKET','TRAILING_STOP_MARKET']);
          const cancelList = (Array.isArray(openOrders)?openOrders:[]).filter(o=>{
            const t = String(o.type||'').toUpperCase();
            if (!tpslTypes.has(t)) return false;
            if (isHedge) return String(o.positionSide||'').toUpperCase()===posSide;
            return true;
          });
          for (const o of cancelList){
            try {
              await binanceSignedDirect('DELETE','/fapi/v1/order',{
                symbol,
                orderId: o.orderId,
                origClientOrderId: o.clientOrderId || o.origClientOrderId,
                recvWindow: 30000
              });
            } catch(e){}
            await wait(100);
          }
        } catch {}
        // 平仓（reduceOnly；对冲模式附带positionSide）
        const params = { symbol, side, type:'MARKET', quantity: roundStep(qty, qtyStepForSymbol(symbol, true)), recvWindow: 30000 };
        if (isHedge) params.positionSide = posSide;
        // 单向模式才附带 reduceOnly
        if (!isHedge) params.reduceOnly = true;
        await binanceSignedDirect('POST', '/fapi/v1/order', params);
        await wait(120);
      }
      setSimStatus('状态：实盘已平所有持仓（并撤销对应TP/SL）');
      return;
    }
    if (act==='set_balance'){
      // 实盘不支持设置余额，忽略
      setSimStatus('状态：实盘模式忽略设置余额');
      return;
    }
  }

  async function execLiveOps(ops){
    if (!Array.isArray(ops) || !ops.length) return;
    // 重用策略约束过滤
    const { validOps, invalidOps } = enforceAiPolicyOnOps(ops);
        if (!validOps.length){ setSimStatus('状态：策略不合规（全部被过滤：开仓需包含SL）'); return; }
    for (const op of validOps){
      try {
        await execLiveOp(op);
        // 轻微节流，降低快速连续请求导致的漏单/限速风险
        await new Promise(r=>setTimeout(r, 180));
      } catch(e){ setSimStatus(`状态：实盘执行失败：${e?.message||e}`); }
    }
    setSimStatus(`状态：实盘指令已执行（${validOps.length}条，过滤${invalidOps.length}条）`);
  }

  // —— 持久化日志与自动操盘累计时长 ——
  const ORDER_LOG_KEY = 'order_history_log_v1';
  const TRADE_LOG_KEY = 'trade_history_log_v1';
  const AI_CMD_LOG_KEY = 'ai_cmd_exec_log_v1';
  const AUTO_UPTIME_KEY = 'ai_auto_uptime_v1';
  const AUTO_CLOSE_CFG_KEY = 'auto_close_cfg_v1';
  let autoUptimeStart = 0; // 正在计时的起点（0表示未计时）
  let autoUptimeAccum = 0; // 累积毫秒数
  try {
    const u = JSON.parse(localStorage.getItem(AUTO_UPTIME_KEY) || '{}');
    autoUptimeStart = Number(u.start||0) || 0;
    autoUptimeAccum = Number(u.accum||0) || 0;
  } catch {}

  function saveAutoUptime(){
    try { localStorage.setItem(AUTO_UPTIME_KEY, JSON.stringify({ start:autoUptimeStart, accum:autoUptimeAccum })); } catch {}
  }
  function isFullAutoActive(){
    return !!autoTimer || !!autoExecEnabled;
  }
  function fmtDuration(ms){
    if (ms <= 0) return '0分钟';
    const totalMin = Math.floor(ms/60000);
    const d = Math.floor(totalMin / (60*24));
    const h = Math.floor((totalMin % (60*24)) / 60);
    const m = totalMin % 60;
    return `${d}天${h}小时${m}分钟`;
  }
  function autoUptimeText(){
    const runMs = autoUptimeAccum + (isFullAutoActive() && autoUptimeStart ? (Date.now() - autoUptimeStart) : 0);
    return `已执行AI自动操盘${fmtDuration(runMs)}`;
  }
  function recalcAutoUptime(){
    if (isFullAutoActive()){
      if (!autoUptimeStart){ autoUptimeStart = Date.now(); saveAutoUptime(); }
    } else {
      if (autoUptimeStart){ autoUptimeAccum += Math.max(0, Date.now() - autoUptimeStart); autoUptimeStart = 0; saveAutoUptime(); }
    }
  }

  // —— 主题固定为暗色（移除明暗切换相关逻辑） ——
  try {
    // 确保使用暗色变量（不添加 theme-light 类）
    document.documentElement.classList.remove('theme-light');
  } catch{}

  // —— 语言切换与文案 ——
  // —— 语言固定为中文（移除选择与存储） ——
  let lang = 'zh-CN';
  const I18N = {
    'zh-CN': {
      // Global Settings
      settings_title: '全局设置',
      label_theme: '主题',
      btn_theme_dark: '暗色主题',
      btn_theme_light: '明亮主题',
      label_language: '语言',
      lang_zh: '中文',
      lang_en: 'English',

      // AI Interaction
      ai_panel_title: 'AI 交互模块',
      label_choose_ai: '选择AI',
      provider_gemini: 'Gemini 2.5 Pro',
      provider_deepseek: 'DeepSeek V3.2',
      provider_qwen: 'Qwen3 Max',
      provider_openai: 'OpenAI（待定）',
      provider_claude: 'Claude（待定）',
      api_key_placeholder: '粘贴你的API Key',
      btn_save_key: '保存Key',
      label_rule: '自定义策略',
      rule_placeholder: '在此输入你的策略规则，例如：短线机会、中长线稳定获利…',
      btn_save_rule: '保存规则',
      btn_clear_rule: '清空',
      btn_opt_prompt: 'AI优化提示词',
      label_history_rule: '历史规则',
      label_data_select: '交易对选择',
      btn_select_all: '全选',
      btn_select_none: '全不选',
      btn_send_once: '发送一次',
      min_1: '1分钟',
      min_3: '3分钟',
      min_5: '5分钟',
      min_10: '10分钟',
      min_30: '30分钟',
      min_60: '60分钟',
      ai_status_waiting: '状态：等待中',
      ai_output_placeholder: 'AI输出将在此显示…',
      ai_parse_title: 'AI 建议解析与执行',
      btn_parse_once: '解析并执行一次',
      parse_status_wait: '解析状态：等待',
      parse_status_prefix: '解析状态：',
      ai_ops_log_placeholder: '解析日志将显示在此…',
      ai_cmd_log_title: 'AI 命令执行记录',
      ai_cmd_log_placeholder: '暂无记录…',

      // Dynamic statuses/buttons
      auto_send_on: '定时自动发送：开启',
      auto_send_off: '定时自动发送：关闭',
      auto_exec_on: '跟随AI刷新自动执行：开启',
      auto_exec_off: '跟随AI刷新自动执行：关闭',
      exec_on: '自动执行开启',
      exec_off: '自动执行关闭',
      ai_auto_on: 'AI自动操盘：开启',
      ai_auto_off: 'AI自动操盘：关闭',
      status_prefix: '状态：',
      waiting: '等待中',
      next_auto_send: '下次自动发送',
      last_reply: '最后回复：',
      missing_api_key: '缺少API Key',
      ai_sending: '正在向AI发送…',
      ai_replied: 'AI已回复',
      not_supported_ai: '暂未支持所选AI',
      status_saved_key: '状态：已保存Key',
      opt_ready: '优化状态：就绪',
      opt_missing_key: '优化状态：缺少API Key',
      opt_running: '优化状态：进行中…',
      opt_done: '优化状态：完成',
      opt_no_return: '优化状态：AI无返回或格式不匹配',
      opt_failed: '优化状态：失败',
      // Parse result messages
      parse_failed_prefix: '解析状态：失败（',
      parse_invalid_all: '解析状态：失败（均不合规：禁止限价，需市价+TP/SL）',
      parse_partial_prefix: '解析状态：部分合规（可执行',
      parse_partial_mid: '条；过滤',
      parse_partial_suffix: '条不合规）',
      parse_success_prefix: '解析状态：成功，共 ',
      parse_success_suffix: ' 条',
      parse_manual_exec_prefix: '解析状态：已手动执行（',
      parse_manual_exec_mid: '条，过滤',
      parse_manual_exec_suffix: '条）',

      // Binance status
      ws_connected: 'WS：已连接',
      ws_disconnected: 'WS：未连接',
      api_ok: 'API：正常',
      api_error: 'API：错误',
      api_unknown: 'API：未知',

      // Crypto panel fetch
      panel_fetching: '状态：正在获取数据…',
      panel_updated_ok_html: '状态：<span class="ok">已更新</span>',
      panel_updated_err_html: '状态：<span class="err">错误</span>',
      last_updated_prefix: '最后更新：',
      fetch_error_msg_prefix: '获取数据时出错：',
      fetch_error_tip: '提示：若长时间失败，请稍后再试或检查网络。'
    },
    'en-US': {
      // Global Settings
      settings_title: 'Global Settings',
      label_theme: 'Theme',
      btn_theme_dark: 'Dark Theme',
      btn_theme_light: 'Light Theme',
      label_language: 'Language',
      lang_zh: '中文',
      lang_en: 'English',

      // AI Interaction
      ai_panel_title: 'AI Interaction Module',
      label_choose_ai: 'Choose AI',
      provider_gemini: 'Gemini 2.5 Pro',
      provider_deepseek: 'DeepSeek V3.2',
      provider_qwen: 'Qwen3 Max',
      provider_openai: 'OpenAI (TBD)',
      provider_claude: 'Claude (TBD)',
      api_key_placeholder: 'Paste your API Key',
      btn_save_key: 'Save Key',
      label_rule: 'Strategy Rules',
      rule_placeholder: 'Enter your strategy rules here, e.g., short-term opportunities, mid-to-long-term stability…',
      btn_save_rule: 'Save Rule',
      btn_clear_rule: 'Clear',
      btn_opt_prompt: 'Optimize Prompt',
      label_history_rule: 'Rule History',
      label_data_select: 'Data Selection',
      btn_select_all: 'Select All',
      btn_select_none: 'Select None',
      btn_send_once: 'Send Once',
      min_1: '1 min',
      min_3: '3 min',
      min_5: '5 min',
      min_10: '10 min',
      min_30: '30 min',
      min_60: '60 min',
      ai_status_waiting: 'Status: Waiting',
      ai_output_placeholder: 'AI output will appear here…',
      ai_parse_title: 'AI Suggestion Parse & Execute',
      btn_parse_once: 'Parse & Execute Once',
      parse_status_wait: 'Parse Status: Waiting',
      parse_status_prefix: 'Parse Status: ',
      ai_ops_log_placeholder: 'Parse log will appear here…',
      ai_cmd_log_title: 'AI Command Execution Log',
      ai_cmd_log_placeholder: 'No records…',

      // Dynamic statuses/buttons
      auto_send_on: 'Auto Send: On',
      auto_send_off: 'Auto Send: Off',
      auto_exec_on: 'Auto Execute on AI refresh: On',
      auto_exec_off: 'Auto Execute on AI refresh: Off',
      exec_on: 'Auto execute ON',
      exec_off: 'Auto execute OFF',
      ai_auto_on: 'AI Auto Trading: ON',
      ai_auto_off: 'AI Auto Trading: OFF',
      status_prefix: 'Status: ',
      waiting: 'Waiting',
      next_auto_send: 'Next auto send',
      last_reply: 'Last reply: ',
      missing_api_key: 'Missing API Key',
      ai_sending: 'Sending to AI…',
      ai_replied: 'AI replied',
      not_supported_ai: 'Selected AI is not supported yet',
      status_saved_key: 'Status: Key saved',
      opt_ready: 'Optimize Status: Ready',
      opt_missing_key: 'Optimize Status: Missing API Key',
      opt_running: 'Optimize Status: Running…',
      opt_done: 'Optimize Status: Done',
      opt_no_return: 'Optimize Status: No return or format mismatch',
      opt_failed: 'Optimize Status: Failed',
      // Parse result messages
      parse_failed_prefix: 'Parse Status: Failed (',
      parse_invalid_all: 'Parse Status: Failed (All invalid: No limit orders; require market + TP/SL)',
      parse_partial_prefix: 'Parse Status: Partially valid (executable ',
      parse_partial_mid: '; filtered ',
      parse_partial_suffix: ' invalid)',
      parse_success_prefix: 'Parse Status: Success, total ',
      parse_success_suffix: '',
      parse_manual_exec_prefix: 'Parse Status: Executed manually (',
      parse_manual_exec_mid: ', filtered ',
      parse_manual_exec_suffix: ')',

      // Binance status
      ws_connected: 'WS: Connected',
      ws_disconnected: 'WS: Disconnected',
      api_ok: 'API: OK',
      api_error: 'API: Error',
      api_unknown: 'API: Unknown',

      // Crypto panel fetch
      panel_fetching: 'Status: Fetching data…',
      panel_updated_ok_html: 'Status: <span class="ok">Updated</span>',
      panel_updated_err_html: 'Status: <span class="err">Error</span>',
      last_updated_prefix: 'Last updated: ',
      fetch_error_msg_prefix: 'Error fetching data: ',
      fetch_error_tip: 'Tip: If failures persist, try later or check the network.'
    }
  };
  function tr(key){ const d = I18N[lang] || I18N['zh-CN']; return d[key] ?? key; }
  function applyLang(){
    try {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const k = el.getAttribute('data-i18n');
        if (k) el.textContent = tr(k);
      });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const k = el.getAttribute('data-i18n-placeholder');
        if (k) el.setAttribute('placeholder', tr(k));
      });
      // Buttons reflecting runtime state
      const autoSendBtn = document.getElementById('autoSendBtn');
      if (autoSendBtn) autoSendBtn.textContent = tr((autoTimer?'auto_send_on':'auto_send_off'));
      const autoExecBtn = document.getElementById('autoExecBtn');
      if (autoExecBtn) autoExecBtn.textContent = tr((autoExecEnabled?'auto_exec_on':'auto_exec_off'));
      const aiAutoSwitchBtn = document.getElementById('aiAutoSwitchBtn');
      if (aiAutoSwitchBtn) aiAutoSwitchBtn.textContent = tr(autoExecEnabled ? 'ai_auto_on' : 'ai_auto_off');
      // Initial AI status placeholder
      const aiStatusEl = document.getElementById('aiStatus');
      if (aiStatusEl) aiStatusEl.textContent = tr('ai_status_waiting');
    } catch{}
  }
  // 移除 setLang，语言固定为中文

  // 通用本地日志追加
  function pushLocalLog(key, line){
    try {
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      const tsStr = new Date().toLocaleString();
      const withTs = /^\s*\[[^\]]+\]/.test(line) ? line : `[${tsStr}] ${line}`;
      arr.push(withTs);
      // 简单限制大小，避免localStorage过大（保留最近10000条）
      const trimmed = arr.slice(-10000);
      localStorage.setItem(key, JSON.stringify(trimmed));
    } catch {}
  }

  function updateBinanceStatus(){
    const now = Date.now();
    const wsOk = !!binanceWsConnected && (now - (lastWsMsg||0) < 5000);
    const apiOk = (lastApiOk || 0) > (lastApiErr || 0) && (now - (lastApiOk||0) < 60000);
    if (statusDots.ws) statusDots.ws.className = `status-dot ${wsOk ? 'ok' : 'err'}`;
    if (statusDots.api) statusDots.api.className = `status-dot ${apiOk ? 'ok' : 'err'}`;
  }

  // —— 通用：表格行选中绑定 ——
  function bindRowSelection(tableEl){
    try {
      const tbody = tableEl?.querySelector('tbody');
      if (!tbody) return;
      tbody.addEventListener('click', (e)=>{
        if (e.target.closest('.action-link')) return; // 操作链接不触发行选中
        const tr = e.target.closest('tr');
        if (!tr) return;
        const selected = tr.classList.contains('selected');
        tbody.querySelectorAll('tr.selected').forEach(r=>r.classList.remove('selected'));
        tr.classList.toggle('selected', !selected);
      });
    } catch{}
  }

  function renderTopbar(){
    ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','DOGEUSDT','XRPUSDT','ZECUSDT','SOONUSDT','DASHUSDT','LTCUSDT','ASTERUSDT','SUIUSDT'].forEach(s=>{
      const el = topbarEls[s];
      if (!el) return;
      const p = latestPriceMap[s];
      const prev = _prevTop[s];
      el.textContent = fmt(p, decimalsForSymbol(s));
      if (Number.isFinite(prev) && Number.isFinite(p)){
        const prevCls = el.classList.contains('up') ? 'up' : (el.classList.contains('down') ? 'down' : '');
        const cls = p>prev ? 'up' : (p<prev ? 'down' : prevCls);
        el.className = `value${cls?(' '+cls):''}`;
        try { syncMarquee(document.querySelector('.topbar'), s, el.textContent, cls); } catch {}
      }
      _prevTop[s] = p;
    });
  }

  function renderBottombar(){
    ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','DOGEUSDT','XRPUSDT','ZECUSDT','SOONUSDT','DASHUSDT','LTCUSDT','ASTERUSDT','SUIUSDT'].forEach(s=>{
      const el = bottombarEls[s];
      if (!el) return;
      const p = latestPriceMap[s];
      const prev = _prevBottom[s];
      el.textContent = fmt(p, decimalsForSymbol(s));
      if (Number.isFinite(prev) && Number.isFinite(p)){
        const prevCls = el.classList.contains('up') ? 'up' : (el.classList.contains('down') ? 'down' : '');
        const cls = p>prev ? 'up' : (p<prev ? 'down' : prevCls);
        el.className = `value${cls?(' '+cls):''}`;
        try { syncMarquee(document.querySelector('.bottombar'), s, el.textContent, cls); } catch {}
      }
      _prevBottom[s] = p;
    });
  }

  const fmt = (n, d = 4) => {
    if (n === undefined || n === null || Number.isNaN(n)) return '—';
    return Number(n).toLocaleString('zh-CN', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  };

  // 按交易对控制价格显示的小数位（避免低价币被四舍五入丢精度）
  function decimalsForSymbol(symbol){
    const s = String(symbol||'').toUpperCase();
    if (s==='XRPUSDT' || s==='DOGEUSDT' || s==='SOONUSDT' || s==='ASTERUSDT') return 5;
    return 2;
  }

  const fmt2 = (n, d = 2) => fmt(n, d);

  function nowStr() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }

  async function binance(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const opts = { cache: 'no-store' };
    for (const base of endpoints) {
      try {
        const url = `${base}${path}${qs ? `?${qs}` : ''}`;
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return await res.json();
      } catch (_) {
        // 尝试下一个端点
      }
    }
    throw new Error('无法连接币安公共接口');
  }

  // 币安期货（USDⓈ-M 永续）公共接口
  async function binanceFutures(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const opts = { cache: 'no-store' };
    for (const base of futuresEndpoints) {
      try {
        const url = `${base}${path}${qs ? `?${qs}` : ''}`;
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return await res.json();
      } catch (_) {
        // 尝试下一个端点
      }
    }
    throw new Error('无法连接币安期货接口');
  }

  function emaSeries(values, period) {
    if (values.length < period) return [];
    const k = 2 / (period + 1);
    const sma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const out = [sma];
    let prev = sma;
    for (let i = period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out.push(prev);
    }
    return out;
  }

  function rsiLast(values, period = 14) {
    if (values.length <= period) return NaN;
    const deltas = [];
    for (let i = 1; i < values.length; i++) deltas.push(values[i] - values[i - 1]);
    let gain = 0, loss = 0;
    for (let i = 0; i < period; i++) {
      const d = deltas[i];
      if (d >= 0) gain += d; else loss -= d;
    }
    gain /= period; loss /= period || 1e-12;
    let rs = gain / loss;
    let rsi = 100 - 100 / (1 + rs);
    let prevGain = gain, prevLoss = loss;
    for (let i = period; i < deltas.length; i++) {
      const d = deltas[i];
      const g = d > 0 ? d : 0;
      const l = d < 0 ? -d : 0;
      prevGain = (prevGain * (period - 1) + g) / period;
      prevLoss = (prevLoss * (period - 1) + l) / period || 1e-12;
      rs = prevGain / prevLoss;
      rsi = 100 - 100 / (1 + rs);
    }
    return rsi;
  }

  function macdLast(values, fast = 12, slow = 26, signal = 9) {
    if (values.length < slow + signal) return { macd: NaN, signal: NaN, hist: NaN };
    const fastE = emaSeries(values, fast);
    const slowE = emaSeries(values, slow);
    const align = Math.min(fastE.length, slowE.length);
    const macdLine = [];
    for (let i = 0; i < align; i++) {
      macdLine.push(fastE[fastE.length - align + i] - slowE[slowE.length - align + i]);
    }
    const signalE = emaSeries(macdLine, signal);
    const macd = macdLine[macdLine.length - 1];
    const signalLast = signalE[signalE.length - 1];
    return { macd, signal: signalLast, hist: macd - signalLast };
  }

  function pick(list, count) {
    const n = Math.max(0, list.length - count);
    return list.slice(n);
  }

  function buildText(ctx, symbol) {
    const { price, ema20, ema50, rsi7, rsi14, macd, ticker24h, minutePrices, ema20List, ema50List, rsi14List, rsi7List, macdList, fourHour } = ctx;
    const dp = decimalsForSymbol(symbol);
    const dpMacd = symbol === 'SUIUSDT' ? 5 : dp;

    const lines = [];
    lines.push(`当前价格 = ${fmt(price, dp)}，当前20日均线 = ${fmt(ema20, dp)}`);
    lines.push(`当前MACD = ${fmt(macd.macd, dpMacd)}，当前RSI（7周期） = ${fmt2(rsi7)}`);
    lines.push(`此外，以下是最新${symbol}的统计与波动指标（自动从币安获取）`);

    lines.push(`24小时统计：最新: ${fmt(ticker24h.lastPrice, dp)} 开盘: ${fmt(ticker24h.openPrice, dp)} 最高: ${fmt(ticker24h.highPrice, dp)} 最低: ${fmt(ticker24h.lowPrice, dp)} 成交量: ${fmt(ticker24h.volume, 2)}`);

    lines.push('');
    lines.push('分钟价格列表（按分钟排列，最早->最新）：');
    lines.push(pick(minutePrices, 20).map(v => fmt(v, dp)).join(', '));

    lines.push('');
    lines.push('EMA 指标（20 周期，最早->最新）：');
    lines.push(pick(ema20List, 16).map(v => fmt(v, dp)).join(', '));
    lines.push('EMA 指标（50 周期，最早->最新）：');
    lines.push(pick(ema50List, 16).map(v => fmt(v, dp)).join(', '));

    lines.push('');
    lines.push('MACD 指标（12/26/9，最早->最新）：');
    lines.push(pick(macdList, 16).map(v => fmt(v, dpMacd)).join(', '));

    lines.push('');
    lines.push('RSI 指标（7 周期，最早->最新）：');
    lines.push(pick(rsi7List, 16).map(v => fmt2(v)).join(', '));
    lines.push('RSI 指标（14 周期，最早->最新）：');
    lines.push(pick(rsi14List, 16).map(v => fmt2(v)).join(', '));

    lines.push('');
    lines.push('更长期的背景（4 小时时间范围）：');
    lines.push(`20周期EMA: ${fmt(fourHour.ema20, dp)} vs 50周期EMA: ${fmt(fourHour.ema50, dp)}`);
    lines.push(`当前RSI（14周期）: ${fmt2(fourHour.rsi14)}，当前MACD: ${fmt(fourHour.macd.macd, dpMacd)}，信号: ${fmt(fourHour.macd.signal, dpMacd)}，柱体: ${fmt(fourHour.macd.hist, dpMacd)}`);

    return lines.join('\n');
  }

  async function updateFor(symbol, els) {
    const { textId, statusId, lastId } = els;
    const textEl = document.getElementById(textId);
    const statusEl = document.getElementById(statusId);
    const lastEl = document.getElementById(lastId);
    try {
      statusEl.textContent = tr('panel_fetching');

      const [klines1m, klines4h, ticker24h] = await Promise.all([
        // 使用期货永续（USDⓈ-M）数据源
        binanceFutures('/fapi/v1/klines', { symbol, interval: '1m', limit: 600 }),
        binanceFutures('/fapi/v1/klines', { symbol, interval: '4h', limit: 600 }),
        binanceFutures('/fapi/v1/ticker/24hr', { symbol }),
      ]);

      const closes1m = klines1m.map(k => parseFloat(k[4]));
      const closes4h = klines4h.map(k => parseFloat(k[4]));
      const price = closes1m[closes1m.length - 1];

      const ema20List = emaSeries(closes1m, 20);
      const ema50List = emaSeries(closes1m, 50);
      const rsi7List = []; const rsi14List = [];
      for (let i = closes1m.length - 20; i < closes1m.length; i++) {
        const sub = closes1m.slice(0, i + 1);
        rsi7List.push(rsiLast(sub, 7));
        rsi14List.push(rsiLast(sub, 14));
      }
      const macdList = [];
      for (let i = closes1m.length - 20; i < closes1m.length; i++) {
        const sub = closes1m.slice(0, i + 1);
        macdList.push(macdLast(sub).macd);
      }

      const ema20 = ema20List[ema20List.length - 1];
      const ema50 = ema50List[ema50List.length - 1];
      const rsi7 = rsiLast(closes1m, 7);
      const rsi14 = rsiLast(closes1m, 14);
      const macd = macdLast(closes1m);

      const fourHour = {
        ema20: emaSeries(closes4h, 20).slice(-1)[0],
        ema50: emaSeries(closes4h, 50).slice(-1)[0],
        rsi14: rsiLast(closes4h, 14),
        macd: macdLast(closes4h),
      };

      const txt = buildText({
        price,
        ema20, ema50,
        rsi7, rsi14,
        macd,
        ticker24h,
        minutePrices: closes1m,
        ema20List, ema50List,
        rsi14List, rsi7List,
        macdList,
        fourHour,
      }, symbol);

      textEl.textContent = txt;
      latestTextMap[symbol] = txt;
      latestPriceMap[symbol] = price;
      lastApiOk = Date.now();
      renderTopbar();
      try { renderBottombar(); } catch{}
      updateBinanceStatus();
      statusEl.innerHTML = tr('panel_updated_ok_html');
      lastEl.textContent = `${tr('last_updated_prefix')}${nowStr()}`;
    } catch (err) {
      statusEl.innerHTML = tr('panel_updated_err_html');
      const msg = `${tr('fetch_error_msg_prefix')}${err?.message || err}\n\n${tr('fetch_error_tip')}`;
      const textEl = document.getElementById(textId);
      textEl.textContent = msg;
      lastApiErr = Date.now();
      updateBinanceStatus();
    }
  }

  // 启动两个币种的定时更新
  function start(symbol, els, intervalMs = 10_000) {
    updateFor(symbol, els);
    setInterval(() => updateFor(symbol, els), intervalMs);
  }

  start('BTCUSDT', { textId: 'textBox', statusId: 'status', lastId: 'lastUpdated' });
  start('ETHUSDT', { textId: 'textBoxEth', statusId: 'statusEth', lastId: 'lastUpdatedEth' });
  start('SOLUSDT', { textId: 'textBoxSol', statusId: 'statusSol', lastId: 'lastUpdatedSol' });
  start('BNBUSDT', { textId: 'textBoxBnb', statusId: 'statusBnb', lastId: 'lastUpdatedBnb' });
  start('DOGEUSDT', { textId: 'textBoxDoge', statusId: 'statusDoge', lastId: 'lastUpdatedDoge' });
  start('XRPUSDT', { textId: 'textBoxXrp', statusId: 'statusXrp', lastId: 'lastUpdatedXrp' });
  start('ZECUSDT', { textId: 'textBoxZec', statusId: 'statusZec', lastId: 'lastUpdatedZec' });
  start('SOONUSDT', { textId: 'textBoxSoon', statusId: 'statusSoon', lastId: 'lastUpdatedSoon' });
  start('DASHUSDT', { textId: 'textBoxDash', statusId: 'statusDash', lastId: 'lastUpdatedDash' });
  start('LTCUSDT', { textId: 'textBoxLtc', statusId: 'statusLtc', lastId: 'lastUpdatedLtc' });
  start('ASTERUSDT', { textId: 'textBoxAster', statusId: 'statusAster', lastId: 'lastUpdatedAster' });
  start('SUIUSDT', { textId: 'textBoxSui', statusId: 'statusSui', lastId: 'lastUpdatedSui' });

  // ===== AI 交互模块逻辑 =====
  const apiKeyEl = document.getElementById('apiKey');
  const customBaseUrlEl = document.getElementById('customBaseUrl');
  const customModelIdEl = document.getElementById('customModelId');
  if (apiKeyEl && customBaseUrlEl && customModelIdEl) {
    applyLang();
    const saveKeyBtn = document.getElementById('saveKeyBtn');
    const ruleEl = document.getElementById('ruleInput');
    const saveRuleBtn = document.getElementById('saveRuleBtn');
    const clearRuleBtn = document.getElementById('clearRuleBtn');
    const optPromptBtn = document.getElementById('optPromptBtn');
    const optPromptStatusEl = document.getElementById('optPromptStatus');
    const ruleListEl = document.getElementById('ruleHistoryList');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const selectNoneBtn = document.getElementById('selectNoneBtn');
    const dataGroupEl = document.getElementById('dataSelectGroup');
    const sendOnceBtn = document.getElementById('sendOnceBtn');
    const autoSendBtn = document.getElementById('autoSendBtn');
    const statusEl = document.getElementById('aiStatus');
    const outputEl = document.getElementById('aiOutput');
    const parseOnceBtn = document.getElementById('parseOnceBtn');
    const autoExecBtn = document.getElementById('autoExecBtn');
    const aiOpsStatusEl = document.getElementById('aiOpsStatus');
    const aiOpsLogEl = document.getElementById('aiOpsLog');
    const aiCmdLogView = document.getElementById('aiCmdLog');
    if (aiCmdLogView){
      try {
    const arr = JSON.parse(localStorage.getItem(AI_CMD_LOG_KEY) || '[]');
    aiCmdLogView.textContent = (arr.slice(-200).reverse().join('\n\n')) || tr('ai_cmd_log_placeholder');
      } catch {}
    }

    function extractOpsFromText(text){
      if (!text || typeof text!=='string') return { ops: [], errors: ['空文本'] };
      let jsonStr = '';
      const m = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
      if (m) jsonStr = m[1];
      else {
        const m2 = text.match(/\{[\s\S]*"ops"[\s\S]*\}/);
        if (m2) jsonStr = m2[0];
      }
      if (!jsonStr) return { ops: [], errors: ['未找到JSON指令块（```json ... ```）'] };
      try {
        const obj = JSON.parse(jsonStr);
        const ops = Array.isArray(obj?.ops) ? obj.ops : (Array.isArray(obj) ? obj : []);
        return { ops, errors: [] };
      } catch (e) {
        return { ops: [], errors: ['JSON解析失败：'+(e?.message||e)] };
      }
    }

    function formatOpsPreview(ops){
      if (!ops?.length) return '（无可执行指令）';
      return ops.map((op, i)=>{
        const typeStr = String(op.type||'').toLowerCase();
        const isLimit = typeStr === 'limit';
        const tpVal = (op?.sl_tp && op.sl_tp.tp!=null) ? op.sl_tp.tp : op.tp;
        const slVal = (op?.sl_tp && op.sl_tp.sl!=null) ? op.sl_tp.sl : op.sl;
        const parts = [ `${i+1}. ${op.action} ${op.symbol||''} ${op.side||''} ${typeStr}` ];
        if (isLimit) parts.push(`price=${op.price??'—'}`);
        parts.push(`qty=${op.qty??'—'}`);
        parts.push(`lev=${op.lev??'—'}`);
        parts.push(`tp=${tpVal??'—'}`);
        parts.push(`sl=${slVal??'—'}`);
        return parts.join(' ');
      }).join('\n');
    }

    // 后台策略约束（过滤模式）：允许市价/限价；开仓至少需提供SL（建议同时提供TP）
  function enforceAiPolicyOnOps(ops){
    const invalidOps = [];
    const validOps = [];
    const arr = Array.isArray(ops) ? ops : [];
    arr.forEach((op, i) => {
      const act = String(op?.action||'').toLowerCase();
      if (act === 'open'){
        const type = (op?.type==='limit') ? 'limit' : 'market';
        const tp = Number(op?.sl_tp?.tp || op?.tp || '') || null;
        const sl = Number(op?.sl_tp?.sl || op?.sl || '') || null;
        const reasons = [];
        if (type!=='market' && type!=='limit') reasons.push('类型不支持');
        // 至少有SL（强制风控）；TP 非必需但建议
        if (sl === null) reasons.push('必须提供SL（止损）');
        if (reasons.length) invalidOps.push({ index: i, op, reasons });
        else validOps.push(op);
      } else if (act === 'set_brackets'){
        // 重置保护单：必须提供SL；TP可选
        const tp = Number(op?.tp || op?.sl_tp?.tp || '') || null;
        const sl = Number(op?.sl || op?.sl_tp?.sl || '') || null;
        const reasons = [];
        if (!op?.symbol) reasons.push('缺少交易对');
        if (sl === null) reasons.push('必须提供SL（止损）');
        if (reasons.length) invalidOps.push({ index: i, op, reasons });
        else validOps.push(op);
      } else {
        // cancel_all 在有持仓时必须伴随 set_brackets；否则危险
        if (act === 'cancel_all'){
          const sym = String(op?.symbol||'').toUpperCase();
          const hasPos = (Array.isArray(latestLiveRisks)?latestLiveRisks:[]).some(r=> String(r.symbol||'').toUpperCase()===sym && Number(r.positionAmt||0)!==0);
          if (hasPos){
            const hasReplacement = arr.some(x=> String(x?.action||'').toLowerCase()==='set_brackets' && String(x?.symbol||'').toUpperCase()===sym);
            if (!hasReplacement){
              invalidOps.push({ index: i, op, reasons:['危险：取消保护单但未设置新的TP/SL'] });
            } else {
              validOps.push(op);
            }
          } else {
            validOps.push(op);
          }
        } else {
          // 其他非开仓动作（close/close_all/set_balance）默认合规
          validOps.push(op);
        }
      }
    });
    return { validOps, invalidOps };
  }

    function onAiOutputUpdated(out){
      const { ops, errors } = extractOpsFromText(out);
      if (errors.length){
        aiOpsStatusEl && (aiOpsStatusEl.textContent = `${tr('parse_failed_prefix')}${errors[0]}）`);
        // 解析与执行卡片仅显示纯命令行，不显示反馈文本
        aiOpsLogEl && (aiOpsLogEl.textContent = '');
        return;
      }
      const pol = enforceAiPolicyOnOps(ops);
      const validOps = pol.validOps || [];
      const invalidOps = pol.invalidOps || [];
      if (!validOps.length){
        aiOpsStatusEl && (aiOpsStatusEl.textContent = tr('parse_invalid_all'));
        aiOpsLogEl && (aiOpsLogEl.textContent = formatOpsPreview(ops));
        return;
      }
      const statusMsg = invalidOps.length
        ? `${tr('parse_partial_prefix')}${validOps.length}${tr('parse_partial_mid')}${invalidOps.length}${tr('parse_partial_suffix')}`
        : `${tr('parse_success_prefix')}${validOps.length}${tr('parse_success_suffix')}`;
      aiOpsStatusEl && (aiOpsStatusEl.textContent = statusMsg);
      // 仅显示可执行指令的“纯命令行”预览
      aiOpsLogEl && (aiOpsLogEl.textContent = formatOpsPreview(validOps));
      // 自动执行：需两侧开关均开启；只执行合规部分
        if (autoExecEnabled && validOps.length){
        try {
          const lines = [`[${nowStr()}] 自动执行：${validOps.length}条（过滤${invalidOps.length}条不合规）`, ...validOps.map(o=>`  - 执行 ${JSON.stringify(o)}`)];
          if (invalidOps.length){
            lines.push('  - 跳过不合规：');
            invalidOps.forEach(it=>{ lines.push(`    [第${it.index+1}条] ${JSON.stringify(it.op)} ｜ 原因：${it.reasons.join('，')}`); });
          }
          pushLocalLog(AI_CMD_LOG_KEY, lines.join('\n'));
          if (aiCmdLogView) {
            const arr = JSON.parse(localStorage.getItem(AI_CMD_LOG_KEY) || '[]');
            aiCmdLogView.textContent = arr.slice(-200).reverse().join('\n\n') || tr('ai_cmd_log_placeholder');
          }
        } catch {}
        try {
          if (window.execLiveOps) window.execLiveOps(validOps);
        } catch{}
      }
    }

  function toggleAutoExec(){
      autoExecEnabled = !autoExecEnabled;
      if (autoExecBtn) autoExecBtn.textContent = tr(autoExecEnabled ? 'auto_exec_on' : 'auto_exec_off');
      // 显示开关视觉状态
      try {
        if (autoExecBtn){
          autoExecBtn.classList.toggle('toggle-on', !!autoExecEnabled);
          autoExecBtn.classList.toggle('toggle-off', !autoExecEnabled);
        }
        const aiAutoSwitchBtn = document.getElementById('aiAutoSwitchBtn');
        if (aiAutoSwitchBtn){
          aiAutoSwitchBtn.textContent = tr(autoExecEnabled ? 'ai_auto_on' : 'ai_auto_off');
          aiAutoSwitchBtn.classList.toggle('toggle-on', !!autoExecEnabled);
          aiAutoSwitchBtn.classList.toggle('toggle-off', !autoExecEnabled);
        }
      } catch{}
      if (aiOpsStatusEl) aiOpsStatusEl.textContent = `${tr('parse_status_prefix')}${autoExecEnabled ? tr('exec_on') : tr('exec_off')}`;
    recalcAutoUptime();
  }

  function saveAutoCloseCfg(){
    try { localStorage.setItem(AUTO_CLOSE_CFG_KEY, JSON.stringify({ enabled: autoCloseEnabled, threshold: autoCloseThreshold })); } catch {}
  }
  function updateAutoCloseBtnText(){
    const btn = document.getElementById('autoCloseSwitchBtn');
    if (btn) btn.textContent = autoCloseEnabled ? '自动结单：开启' : '自动结单：关闭';
    try {
      if (btn){
        btn.classList.toggle('toggle-on', !!autoCloseEnabled);
        btn.classList.toggle('toggle-off', !autoCloseEnabled);
      }
    } catch{}
  }
  function toggleAutoClose(){
    autoCloseEnabled = !autoCloseEnabled;
    updateAutoCloseBtnText();
    saveAutoCloseCfg();
  }
  function setAutoCloseThresholdFromInput(){
    const el = document.getElementById('autoCloseThresholdInput');
    const v = Number(el?.value || 0);
    autoCloseThreshold = (Number.isFinite(v) && v > 0) ? v : 0;
    saveAutoCloseCfg();
  }
  async function maybeAutoClose(){
    if (!autoCloseEnabled) return;
    const th = Number(autoCloseThreshold || 0);
    if (!th) return;
    const acc = latestLiveAccount || {};
    const up = Number(acc.totalUnrealizedProfit || 0);
    if (Math.abs(up) < th) return;
    try {
      await execLiveOp({ action:'close_all' });
      const syms = new Set();
      try { (Array.isArray(latestLiveRisks)?latestLiveRisks:[]).forEach(r=>{ const s=String(r.symbol||'').toUpperCase(); if (s) syms.add(s); }); } catch{}
      try { (Array.isArray(latestLiveOpenOrders)?latestLiveOpenOrders:[]).forEach(o=>{ const s=String(o.symbol||'').toUpperCase(); if (s) syms.add(s); }); } catch{}
      for (const s of syms){
        try { await binanceSignedDirect('DELETE', '/fapi/v1/allOpenOrders', { symbol: s, recvWindow: 30000 }); } catch{}
      }
      setSimStatus('状态：已触发自动结单（先平仓后撤单）');
    } catch(e){
      setSimStatus(`状态：自动结单失败：${e?.message||e}`);
    }
  }

    // 本地存储键名
    const KEY_STORAGE = 'ai_api_key';
    const RULES_STORAGE = 'ai_rules_history';
    const CUSTOM_BASE_URL_STORAGE = 'ai_custom_base_url';
    const CUSTOM_MODEL_ID_STORAGE = 'ai_custom_model_id';

    // 加载与显示历史规则
    function loadRuleHistory() {
      let hist = [];
      try { hist = JSON.parse(localStorage.getItem(RULES_STORAGE) || '[]'); } catch {}
      ruleListEl.innerHTML = '';
      hist.slice().reverse().forEach((item, idx) => {
        const li = document.createElement('li');
        li.textContent = `${new Date(item.ts).toLocaleString()} - ${item.text.slice(0, 48)}…`;
        li.title = item.text;
        li.addEventListener('click', () => { ruleEl.value = item.text; });
        ruleListEl.appendChild(li);
      });
    }
    function saveRule() {
      const text = (ruleEl.value || '').trim();
      if (!text) return;
      let hist = [];
      try { hist = JSON.parse(localStorage.getItem(RULES_STORAGE) || '[]'); } catch {}
      hist.push({ ts: Date.now(), text });
      localStorage.setItem(RULES_STORAGE, JSON.stringify(hist).slice(0, 200000));
      loadRuleHistory();
    }

    // API Key 存取
    function loadKey() {
      try { apiKeyEl.value = localStorage.getItem(KEY_STORAGE) || ''; } catch {}
    }
    function saveKey() {
      try { localStorage.setItem(KEY_STORAGE, apiKeyEl.value || ''); } catch {}
      statusEl.textContent = tr('status_saved_key');
      setTimeout(() => statusEl.textContent = tr('ai_status_waiting'), 1200);
    }

    // 自定义模型配置存取
    function loadCustomConfig() {
      try {
        if (customBaseUrlEl) customBaseUrlEl.value = localStorage.getItem(CUSTOM_BASE_URL_STORAGE) || '';
        if (customModelIdEl) customModelIdEl.value = localStorage.getItem(CUSTOM_MODEL_ID_STORAGE) || '';
      } catch {}
    }
    function saveCustomConfig() {
      try {
        if (customBaseUrlEl) localStorage.setItem(CUSTOM_BASE_URL_STORAGE, customBaseUrlEl.value || '');
        if (customModelIdEl) localStorage.setItem(CUSTOM_MODEL_ID_STORAGE, customModelIdEl.value || '');
      } catch {}
    }
    function getCustomConfig() {
      return {
        baseUrl: (customBaseUrlEl?.value || '').trim(),
        modelId: (customModelIdEl?.value || '').trim()
      };
    }

    // 选择数据的交易对
    function selectedSymbols() {
      return Array.from(dataGroupEl.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
    }


    // 实盘快照摘要：含账户费率与预计手续费
  function buildLiveSummary(){
      const acc = latestLiveAccount || {};
      const risks = Array.isArray(latestLiveRisks) ? latestLiveRisks : [];
      const orders = Array.isArray(latestLiveOpenOrders) ? latestLiveOpenOrders : [];
      const balance = Number(acc.totalWalletBalance || acc.totalMarginBalance || 0);
      const equity = Number(acc.totalMarginBalance || balance);
      const upnl = Number(acc.totalUnrealizedProfit || 0);
      const avail = Number(acc.availableBalance || balance);
      // 估算已用保证金：按标记价
      let used = 0;
      risks.forEach(p=>{
        const sym = String(p.symbol||'').toUpperCase();
        const qty = Math.abs(Number(p.positionAmt||0));
        const lev = Math.max(1, Number(p.leverage||1));
        const mp = Number(latestPriceMap[sym] || p.markPrice || p.entryPrice || 0);
        if (qty>0 && mp>0) used += (qty * mp) / lev;
      });
      const maker = isFinite(Number(latestMakerRate)) ? Number(latestMakerRate) : null;
      const taker = isFinite(Number(latestTakerRate)) ? Number(latestTakerRate) : null;
      const fmtRate = (r)=>{ if (!isFinite(Number(r))) return '—'; const v=Number(r); return v<1?`${fmt(v*100,4)}%`:`${fmt(v,4)}%`; };

      const lines = [];
      lines.push('【账户状态（实盘）】');
      lines.push(`权益: ${fmt(equity,2)} 可用保证金: ${fmt(avail,2)} 已用保证金(估算): ${fmt(used,2)} 未实现盈亏: ${fmt(upnl,2)} 手续费率：挂单 ${fmtRate(maker)} ｜ 吃单 ${fmtRate(taker)}`);
      lines.push('');
      lines.push('【持仓（净仓）】');
      const posList = risks.filter(it=> Number(it.positionAmt||0) !== 0);
      if (!posList.length){
        lines.push('（无持仓）');
      } else {
        posList.forEach(it=>{
          const sym = String(it.symbol||'');
          const qtyAbs = Math.abs(Number(it.positionAmt||0));
          const side = (Number(it.positionAmt||0)>0) ? '多' : '空';
          const entry = Number(it.entryPrice||0);
          const lev = Number(it.leverage||1);
          const up = Number((typeof it.unRealizedProfit!=='undefined' ? it.unRealizedProfit : it.unrealizedProfit)||0);
          const mp = Number(latestPriceMap[sym] || it.markPrice || entry);
          const usedM = mp>0 ? (qtyAbs * mp) / Math.max(1, lev) : 0;
          const estCloseFee = (isFinite(taker) && mp>0) ? mp * qtyAbs * taker : null;
          const feeText = (estCloseFee!=null) ? `预计平仓手续费(吃单): ${fmt(estCloseFee,4)} USDT` : '手续费未知';
          lines.push(`${sym} ${side} 数量 ${fmt(qtyAbs,4)} 均价 ${fmt(entry,decimalsForSymbol(sym))} 杠杆 ${lev}x 未实现盈亏 ${fmt(up,2)} 保证金 ${fmt(usedM,2)} ｜ ${feeText}`);
        });
      }
      lines.push('');
      lines.push('【当前委托】');
      if (!orders.length){
        lines.push('（无委托）');
      } else {
        orders.forEach(o=>{
          const sym = String(o.symbol||'');
          const type = String(o.type||'').toUpperCase();
          const px = Number(o.price||0);
          const qty = Number(o.origQty||o.quantity||0);
          const rate = (type==='LIMIT' ? maker : taker);
          const estFee = (isFinite(rate) && ((type==='MARKET' && qty>0 && (latestPriceMap[sym]||0)>0) || (type==='LIMIT' && px>0 && qty>0)))
            ? ((type==='LIMIT' ? (px*qty) : (Number(latestPriceMap[sym]||0)*qty)) * rate)
            : null;
          const feeText = (estFee!=null) ? `预计成交手续费: ${fmt(estFee,4)} USDT` : '手续费未知';
          lines.push(`${sym} ${String(o.side||'').toUpperCase()} ${type} 价格 ${fmt(px,decimalsForSymbol(sym))} 数量 ${fmt(qty,4)} 状态 ${String(o.status||'NEW')} ｜ ${feeText}`);
        });
      }
      return lines.join('\n');
    }


  function buildPrompt(ruleText, syms) {
    const lines = [];
    lines.push('你是一名加密市场策略分析AI，请根据给定的规则与数据输出可执行的建议、风险与阈值参数。');
    lines.push('');
    lines.push('【策略规则】');
    lines.push(ruleText || '（未提供规则）');
    lines.push('');
    lines.push('【实盘账户与仓位】');
    lines.push(buildLiveSummary());
    lines.push('');
    lines.push('【行情数据】');
    if (!syms.length) lines.push('（未选择数据）');
    syms.forEach(s => {
      const t = latestTextMap[s] || '（该交易对的最新数据尚未载入）';
      lines.push(`=== ${s} ===`);
      lines.push(t);
      lines.push('');
    });
    const req = (window.AI_CONFIG && window.AI_CONFIG.requirements) || {};
    lines.push(req.outputFormatLine || '输出格式：请用中文给出简洁的交易建议（开/平仓条件、风控、止损止盈），并说明依据。');
    lines.push('');
    lines.push(req.jsonBlockIntro || '【机器可读指令（严格JSON）】请在回复末尾追加一个```json 代码块，内容仅为以下结构，不得添加注释或多余字段：');
    const tmpl = Array.isArray(req.jsonBlockTemplate) ? req.jsonBlockTemplate : [
      '{"ops": [',
      '  {"action":"open","symbol":"BTCUSDT","side":"long|short","type":"market|limit","price":110000.0,"qty":0.01,"lev":10,"tp":111000.0,"sl":109000.0},',
      '  {"action":"close","symbol":"BTCUSDT"},',
      '  {"action":"set_brackets","symbol":"BTCUSDT","tp":111000.0,"sl":109000.0},',
      '  {"action":"cancel_all","symbol":"BTCUSDT"},',
      '  {"action":"close_all"}',
      ']}',
      '```'
    ];
    tmpl.forEach(line => lines.push(line));
    lines.push(req.jsonBlockExplainLine || '字段含义：open为下单（市价可不填price；限价必须填写price；tp/sl可选），close为平指定交易对持仓，set_brackets为重置该交易对的TP/SL保护单（对冲模式分别作用于LONG/SHORT；市价触发，平掉全部持仓），cancel_all为撤销该交易对全部委托（不含TP/SL），close_all为平掉所有持仓。若需设置初始余额，追加{"action":"set_balance","initialBalance":10000}。');
    return lines.join('\n');
  }

  // 构建“优化提示词”任务：仅优化用户在策略规则框中的文本
    function buildOptimizePrompt(ruleText, syms) {
      const lines = [];
      lines.push('请仅对下面的“策略规则”文本进行改写与优化，使其更清晰、结构化、可直接用作系统提示词。');
      lines.push('限制：不要添加任何与行情、账户、数据或本系统指令格式相关的额外信息；不要输出分析或示例；保持中文。');
      lines.push('输出：仅返回优化后的文本，并使用```prompt 代码块包裹。');
      lines.push('');
      lines.push('【策略规则（原文）】');
      lines.push(ruleText || '（未提供规则）');
      lines.push('');
      lines.push('只返回一个代码块：');
      lines.push('```prompt');
      lines.push('（在此输出优化后的提示词正文）');
      lines.push('```');
      return lines.join('\n');
    }

    async function optimizePromptOnce(){
      const apiKey = (apiKeyEl.value || '').trim();
      const ruleText = (ruleEl.value || '').trim();
      const syms = selectedSymbols();
      if (!apiKey) { if (optPromptStatusEl) optPromptStatusEl.textContent = tr('opt_missing_key'); return; }
      if (optPromptStatusEl) optPromptStatusEl.textContent = tr('opt_running');
      try { if (optPromptBtn) optPromptBtn.disabled = true; } catch {}
      try {
        const prompt = buildOptimizePrompt(ruleText, syms);
        let out = '';
        out = await openaiCompatChat(apiKey, prompt);
        // 提取```prompt 块内容作为优化后的提示词
        let optimized = '';
        const m = out.match(/```prompt\s*([\s\S]*?)```/i) || out.match(/```\s*([\s\S]*?)```/);
        optimized = (m ? m[1] : out).trim();
        if (optimized){
          ruleEl.value = optimized;
          // 保存到历史，便于回溯
          try { saveRule(); } catch{}
          if (optPromptStatusEl) optPromptStatusEl.textContent = tr('opt_done');
        } else {
          if (optPromptStatusEl) optPromptStatusEl.textContent = tr('opt_no_return');
        }
      } catch (err) {
        if (optPromptStatusEl) optPromptStatusEl.textContent = `${tr('opt_failed')} (${err?.message || err})`;
      } finally {
        try { if (optPromptBtn) optPromptBtn.disabled = false; } catch {}
        // 不更新下方AI输出框与全局状态
      }
    }


    // 仅请求 JSON 指令的补充（用于首次回复未包含可解析JSON时）

    async function openaiCompatChat(apiKey, prompt){
      const customCfg = getCustomConfig();
      const url = customCfg.baseUrl;
      const model = customCfg.modelId;
      if (!url || !model) {
        throw new Error('请填写 Base URL 和模型 ID');
      }
      const body = {
        model,
        messages: [
          { role: 'system', content: '你是一个专业的加密货币交易分析师，擅长分析市场数据并提供交易建议。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 4096,
        top_p: 0.95,
        stream: false
      };
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        let errorMessage = `${res.status} ${res.statusText}`;
        try {
          const errorData = await res.json();
          if (errorData.error?.message) errorMessage = `${res.status}：${errorData.error.message}`;
        } catch {}
        throw new Error(errorMessage);
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || '';
      return text.trim() || JSON.stringify(data, null, 2);
    }

    async function openaiCompatOpsJson(apiKey, prompt){
      const req = (window.AI_CONFIG && window.AI_CONFIG.requirements) || {};
      const instruct = req.fallbackJsonInstruction || '请仅输出一个JSON对象，形如 {"ops":[...]} ，不要输出任何其他文本。';
      const customCfg = getCustomConfig();
      const url = customCfg.baseUrl;
      const model = customCfg.modelId;
      if (!url || !model) {
        throw new Error('请填写 Base URL 和模型 ID');
      }
      const body = {
        model,
        messages: [
          { role: 'system', content: instruct },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 1024,
        top_p: 0.95,
        stream: false
      };
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        let errorMessage = `${res.status} ${res.statusText}`;
        try {
          const errorData = await res.json();
          if (errorData.error?.message) errorMessage = `${res.status}：${errorData.error.message}`;
        } catch {}
        throw new Error(errorMessage);
      }
      const data = await res.json();
      const txt = data?.choices?.[0]?.message?.content || '';
      return (txt || '').trim() || JSON.stringify(data, null, 2);
    }

    async function callOpsJson(apiKey, prompt){
      return await openaiCompatOpsJson(apiKey, prompt);
    }

    // 自动发送间隔设置（默认3分钟）
    const autoIntervalEl = document.getElementById('autoIntervalSelect');
    let autoIntervalMs = (autoIntervalEl ? Number(autoIntervalEl.value) * 60000 : 180000);
    function currentIntervalMinutes(){
      const v = Number(autoIntervalEl?.value || 3);
      return Number.isFinite(v) && v > 0 ? v : 3;
    }
    function updateAutoIntervalMs(){ autoIntervalMs = currentIntervalMinutes() * 60000; }
    function updateAutoSendBtnText(){
      autoSendBtn.textContent = tr(autoTimer ? 'auto_send_on' : 'auto_send_off');
      try {
        if (autoSendBtn){
          autoSendBtn.classList.toggle('toggle-on', !!autoTimer);
          autoSendBtn.classList.toggle('toggle-off', !autoTimer);
        }
      } catch{}
    }

    // 自动发送倒计时状态管理
    let autoTimer = null;
    let countdownTimer = null;
    let nextRunAt = 0;
    let baseStatusText = tr('waiting');
    let lastAiReplyAt = '';
    function formatCountdown(ms){
      if (ms <= 0) return '00:00';
      const s = Math.floor(ms/1000);
      const mm = String(Math.floor(s/60)).padStart(2,'0');
      const ss = String(s%60).padStart(2,'0');
      return `${mm}:${ss}`;
    }
    function refreshStatus(){
      const hasAuto = !!autoTimer;
      const suffix = hasAuto ? `（${tr('next_auto_send')} ${formatCountdown(Math.max(0, nextRunAt - Date.now()))}）` : '';
      const replySuffix = (baseStatusText||'').includes(tr('ai_replied')) ? `（${tr('last_reply')}${lastAiReplyAt || nowStr()}）` : '';
      statusEl.textContent = `${tr('status_prefix')}${baseStatusText}${replySuffix}${suffix}`;
    }
    function setStatus(text){
      baseStatusText = text || '';
      refreshStatus();
    }

    async function sendOnce() {
      const apiKey = (apiKeyEl.value || '').trim();
      const ruleText = (ruleEl.value || '').trim();
      const syms = selectedSymbols();
      if (!apiKey) { setStatus(tr('missing_api_key')); return; }
      const prompt = buildPrompt(ruleText, syms);
      setStatus(tr('ai_sending'));
      try { sendOnceBtn.disabled = true; } catch {}
      try {
        const forceJsonOnly = !!(window.AI_CONFIG?.requirements?.forceJsonOnly);
        let out = '';
        if (forceJsonOnly) {
          out = await callOpsJson(apiKey, prompt);
          outputEl.textContent = "```json\n" + out + "\n```";
        } else {
          out = await openaiCompatChat(apiKey, prompt);
          outputEl.textContent = out;
        }
        // 若未能解析出JSON代码块，尝试追加“JSON-only”补充
        let parsed = extractOpsFromText(outputEl.textContent);
        if (!forceJsonOnly && parsed.errors.length){
          try {
            const jsonOnly = await openaiCompatOpsJson(apiKey, prompt);
            const combined = out + "\n\n```json\n" + jsonOnly + "\n```\n";
            outputEl.textContent = combined;
          } catch(_){ }
        }
        // 将最新输出送入解析模块（若开启自动执行则执行）
        try { onAiOutputUpdated(outputEl.textContent); } catch{}
        lastAiReplyAt = nowStr();
        setStatus(tr('ai_replied'));
      } catch (err) {
        outputEl.textContent = `AI调用失败：${err?.message || err}`;
        setStatus('错误');
      } finally {
        try { sendOnceBtn.disabled = false; } catch {}
        if (autoTimer) nextRunAt = Date.now() + autoIntervalMs;
        refreshStatus();
      }
    }

    function toggleAuto() {
      if (autoTimer) {
        clearInterval(autoTimer); autoTimer = null;
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        nextRunAt = 0;
        updateAutoSendBtnText();
        setStatus('自动发送已关闭');
        recalcAutoUptime();
        return;
      }
      // 使用所选分钟间隔
      updateAutoIntervalMs();
      autoTimer = setInterval(sendOnce, autoIntervalMs);
      nextRunAt = Date.now() + autoIntervalMs;
      if (!countdownTimer){
        countdownTimer = setInterval(refreshStatus, 1000);
      }
      updateAutoSendBtnText();
      setStatus('自动发送已开启');
      recalcAutoUptime();
    }

    // 绑定事件
    loadKey();
    loadCustomConfig();
    loadRuleHistory();
    saveKeyBtn.addEventListener('click', () => {
      saveKey();
      saveCustomConfig();
    });
    if (customBaseUrlEl) {
      customBaseUrlEl.addEventListener('change', saveCustomConfig);
    }
    if (customModelIdEl) {
      customModelIdEl.addEventListener('change', saveCustomConfig);
    }
    saveRuleBtn.addEventListener('click', saveRule);
    clearRuleBtn.addEventListener('click', () => { ruleEl.value = ''; });
    if (optPromptBtn) optPromptBtn.addEventListener('click', optimizePromptOnce);
    if (selectAllBtn) selectAllBtn.addEventListener('click', () => {
      const boxes = Array.from(dataGroupEl.querySelectorAll('input[type="checkbox"]'));
      boxes.forEach((c, idx) => c.checked = idx < 6);
      if (statusEl) { statusEl.textContent = '已选择前6个交易对'; setTimeout(() => statusEl.textContent = tr('ai_status_waiting'), 1200); }
    });
    if (selectNoneBtn) selectNoneBtn.addEventListener('click', () => {
      dataGroupEl.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = false);
    });
    if (dataGroupEl) {
      dataGroupEl.addEventListener('change', (e) => {
        const boxes = Array.from(dataGroupEl.querySelectorAll('input[type="checkbox"]'));
        const checked = boxes.filter(c => c.checked);
        if (checked.length > 6) {
          const t = e.target;
          if (t && t.type === 'checkbox' && t.checked) t.checked = false;
          if (statusEl) { statusEl.textContent = '最多选择6个交易对'; setTimeout(() => statusEl.textContent = tr('ai_status_waiting'), 1200); }
        }
      });
    }
    sendOnceBtn.addEventListener('click', sendOnce);
    autoSendBtn.addEventListener('click', toggleAuto);
    // 当用户更改自动发送间隔时，更新按钮文案并重启计时
    if (autoIntervalEl) autoIntervalEl.addEventListener('change', () => {
      updateAutoIntervalMs();
      updateAutoSendBtnText();
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = setInterval(sendOnce, autoIntervalMs);
        nextRunAt = Date.now() + autoIntervalMs;
        refreshStatus();
      }
    });
    // 初始化按钮文案
    updateAutoSendBtnText();
    // 初始化AI自动操盘互斥状态的按钮样式
    // 去除模拟盘模式开关，不再初始化该按钮
    // 解析与执行按钮绑定
    if (parseOnceBtn) parseOnceBtn.addEventListener('click', ()=>{
      const out = outputEl?.textContent || '';
      const r = extractOpsFromText(out);
      if (r.errors.length){
        aiOpsStatusEl && (aiOpsStatusEl.textContent = `${tr('parse_failed_prefix')}${r.errors[0]}）`);
        // 仅显示纯命令行：错误时不展示反馈文本
        aiOpsLogEl && (aiOpsLogEl.textContent = '');
        return;
      }
      const pol = enforceAiPolicyOnOps(r.ops);
      const validOps = pol.validOps || [];
      const invalidOps = pol.invalidOps || [];
      if (!validOps.length){
        aiOpsStatusEl && (aiOpsStatusEl.textContent = tr('parse_invalid_all'));
        aiOpsLogEl && (aiOpsLogEl.textContent = formatOpsPreview(r.ops));
        return;
      }
      const statusMsg = invalidOps.length
        ? `${tr('parse_partial_prefix')}${validOps.length}${tr('parse_partial_mid')}${invalidOps.length}${tr('parse_partial_suffix')}`
        : `${tr('parse_success_prefix')}${validOps.length}${tr('parse_success_suffix')}`;
      aiOpsStatusEl && (aiOpsStatusEl.textContent = statusMsg);
      // 仅显示可执行指令的“纯命令行”预览
      aiOpsLogEl && (aiOpsLogEl.textContent = formatOpsPreview(validOps));
      // 手动执行一次：不受AI自动操盘总开关限制
      if (validOps.length){
        // 记录到AI命令日志（手动）
        try {
          const lines = [`[${nowStr()}] 手动执行：${validOps.length}条（过滤${invalidOps.length}条不合规）`, ...validOps.map(o=>`  - 执行 ${JSON.stringify(o)}`)];
          if (invalidOps.length){
            lines.push('  - 跳过不合规：');
            invalidOps.forEach(it=>{ lines.push(`    [第${it.index+1}条] ${JSON.stringify(it.op)} ｜ 原因：${it.reasons.join('，')}`); });
          }
          pushLocalLog(AI_CMD_LOG_KEY, lines.join('\n'));
          if (aiCmdLogView) {
            const arr = JSON.parse(localStorage.getItem(AI_CMD_LOG_KEY) || '[]');
            aiCmdLogView.textContent = arr.slice(-200).reverse().join('\n\n');
          }
        } catch {}
        try {
          if (window.execLiveOps) window.execLiveOps(validOps);
        } catch{}
        aiOpsStatusEl && (aiOpsStatusEl.textContent = `${tr('parse_manual_exec_prefix')}${validOps.length}${tr('parse_manual_exec_mid')}${invalidOps.length}${tr('parse_manual_exec_suffix')}`);
      }
    });
    if (autoExecBtn) autoExecBtn.addEventListener('click', toggleAutoExec);
    const aiAutoSwitchBtn = document.getElementById('aiAutoSwitchBtn');
    if (aiAutoSwitchBtn) aiAutoSwitchBtn.addEventListener('click', toggleAutoExec);
    const autoCloseBtn = document.getElementById('autoCloseSwitchBtn');
    if (autoCloseBtn) autoCloseBtn.addEventListener('click', toggleAutoClose);
    const autoCloseInput = document.getElementById('autoCloseThresholdInput');
    if (autoCloseInput) autoCloseInput.addEventListener('change', setAutoCloseThresholdFromInput);
    try {
      const cfg = JSON.parse(localStorage.getItem(AUTO_CLOSE_CFG_KEY) || '{}');
      autoCloseEnabled = !!cfg.enabled;
      autoCloseThreshold = Number(cfg.threshold || 0) || 0;
      if (autoCloseInput) autoCloseInput.value = autoCloseThreshold ? String(autoCloseThreshold) : '';
      updateAutoCloseBtnText();
    } catch{}
  }

  // ====== 合约模拟盘 ======
  const simEls = {
    status: document.getElementById('simStatus'),
    posTable: document.getElementById('positionsTable'),
    openOrdersTable: document.getElementById('openOrdersTable'),
    accBalance: document.getElementById('accBalance'),
    accEquity: document.getElementById('accEquity'),
    accUsedMargin: document.getElementById('accUsedMargin'),
    accAvail: document.getElementById('accAvail'),
    accUpnl: document.getElementById('accUpnl'),
    accRpnl: document.getElementById('accRpnl'),
    cancelAllBtn: document.getElementById('cancelAllBtn'),
    closeAllBtn: document.getElementById('closeAllBtn')
  };

  if (simEls.status) {









    // 状态显示：在尾部附加全自动累计时长
    let _lastSimMsg = '';
    function setSimStatus(msg){
      _lastSimMsg = String(msg||'');
      let display = _lastSimMsg;
      if (display.startsWith('状态：')) display = display.replace('状态：', tr('status_prefix'));
      const tail = isFullAutoActive() ? `（${autoUptimeText()}）` : '';
      simEls.status.textContent = `${display}${tail}`;
    }

    const balanceCanvas = document.getElementById('balanceChart');
    const chartWrap = document.querySelector('.chart-wrap');
    try { if (chartWrap) chartWrap.style.display = 'none'; } catch {}
    class TimeSeriesChart {
      constructor(canvas, options = {}){
        this.canvas = canvas;
        this.points = [];
        this.spanMs = Number.isFinite(options.spanMs) ? options.spanMs : (60*60*1000);
        this.label = options.label || '最近1小时';
        this._w = 0; this._h = 0; this._dpr = 1; this.ctx = null;
      }
      _resize(){
        if (!this.canvas) return false;
        const rect = this.canvas.getBoundingClientRect();
        const parentRect = (this.canvas.parentElement && this.canvas.parentElement.getBoundingClientRect()) || { width: 0, height: 0 };
        const dpr = window.devicePixelRatio || 1;
        const wRaw = rect.width || parentRect.width || 0;
        const hRaw = rect.height || parentRect.height || 0;
        const w = Math.max(300, Math.floor(wRaw));
        const h = Math.max(180, Math.floor(hRaw));
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        const ctx = this.canvas.getContext('2d');
        if (!ctx) return false;
        ctx.reset?.();
        ctx.scale(dpr, dpr);
        this.ctx = ctx; this._w = w; this._h = h; this._dpr = dpr;
        return true;
      }
      addSample(t, v){
        const now = Number(t)||Date.now();
        let val;
        if (typeof v === 'number') val = v;
        else if (typeof v === 'string') { const s = v.replace(/,/g, '').trim(); val = Number(s); }
        else val = Number(v);
        if (!Number.isFinite(val)) return;
        this.points.push({ t: now, v: val });
        const cutoff = now - this.spanMs;
        while (this.points.length && this.points[0].t < cutoff) this.points.shift();
      }
      _fmtTime(ms){ return new Date(ms).toLocaleTimeString([], { hour12:false, hour:'2-digit', minute:'2-digit' }); }
      render(){
        if (!this._resize()) return;
        const ctx = this.ctx; const w = this._w; const h = this._h;
        const css = getComputedStyle(document.documentElement);
        const bg = css.getPropertyValue('--surface-2').trim() || '#1e1e1e';
        const border = css.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.1)';
        const muted = css.getPropertyValue('--muted').trim() || '#aaa';
        const accent = css.getPropertyValue('--accent').trim() || '#ffd54f';
        ctx.fillStyle = bg; ctx.fillRect(0,0,w,h);
        ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.strokeRect(0.5,0.5,w-1,h-1);
        ctx.fillStyle = muted; ctx.font = '12px system-ui';
        try { ctx.fillText(this.label, w - 70, 18); } catch {}
        const leftPad = 52, rightPad = 10, topPad = 8, bottomPad = 26;
        const plotW = w - leftPad - rightPad;
        const plotH = h - topPad - bottomPad;
        const points = this.points.slice();
        const vals = points.map(p=>p.v);
        let minV = vals.length ? Math.min(...vals) : 0;
        let maxV = vals.length ? Math.max(...vals) : 1;
        const pad = (maxV - minV) * 0.1 + 1e-6;
        const yMin = minV - pad, yMax = maxV + pad;
        ctx.strokeStyle = border; ctx.fillStyle = muted; ctx.font = '12px system-ui';
        const yTicks = 4;
        for (let i=0;i<=yTicks;i++){
          const y = topPad + (plotH * i / yTicks);
          const v = yMax - (yMax - yMin) * i / yTicks;
          ctx.beginPath(); ctx.moveTo(leftPad, y); ctx.lineTo(leftPad+plotW, y); ctx.stroke();
          try {
            const lab = Number.isFinite(v)
              ? v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
              : '—';
            const prevAlign = ctx.textAlign, prevBase = ctx.textBaseline;
            ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
            ctx.fillText(lab, leftPad - 6, y);
            ctx.textAlign = prevAlign; ctx.textBaseline = prevBase;
          } catch {}
        }
        const N = points.length;
        if (N===0){ ctx.fillStyle = muted; ctx.fillText('暂无数据', leftPad+6, topPad+18); return; }
        const step = N>1 ? plotW / (N-1) : 0;
        const tickEvery = N>1 ? Math.max(1, Math.floor(N/6)) : 1;
        if (N>1){
          for (let i=0;i<N;i+=tickEvery){
            const x = leftPad + i*step;
            const prevAlign = ctx.textAlign, prevBase = ctx.textBaseline;
            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.fillText(this._fmtTime(points[i].t), x, h-8);
            ctx.textAlign = prevAlign; ctx.textBaseline = prevBase;
          }
          ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.beginPath();
          for (let i=0;i<N;i++){
            const x = leftPad + i*step;
            const y = topPad + (yMax - points[i].v) * plotH / (yMax - yMin);
            if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
          }
          ctx.stroke();
        } else {
          const x = leftPad;
          const y = topPad + (yMax - points[0].v) * plotH / (yMax - yMin);
          ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = muted; ctx.fillText(this._fmtTime(points[0].t), x-24, h-8);
        }
      }
    }
    let balanceChartObj = balanceCanvas ? new TimeSeriesChart(balanceCanvas, { spanMs: 60*60*1000, label: '最近1小时' }) : null;
    function toNumberStrict(x){
      if (typeof x === 'number') return x;
      if (typeof x === 'string') { const s = x.replace(/,/g, '').trim(); const n = Number(s); return Number.isFinite(n) ? n : NaN; }
      const n = Number(x); return Number.isFinite(n) ? n : NaN;
    }
    let hasLiveSamples = false;
    function sampleBalance(){
      try {
        if (!liveEnabled) return;
        const eq = toNumberStrict(latestLiveEquity);
        if (!Number.isFinite(eq)) return;
        if (chartWrap && !hasLiveSamples){ chartWrap.style.display = ''; hasLiveSamples = true; }
        if (balanceChartObj){ const now = Date.now(); balanceChartObj.addSample(now, eq); balanceChartObj.render(); }
      } catch {}
    }
    setInterval(sampleBalance, 5000);
    try { window.addEventListener('equity_update', ()=>{ try { sampleBalance(); } catch {} }); } catch {}


    


    

    

    

    

    

    

    

    

  // 启用期货标记价实时WS
  function startFuturesMarkWS(symbols){
    try {
      const streams = symbols.map(s=> `${s.toLowerCase()}@markPrice@1s`).join('/');
      const url = `wss://fstream.binance.com/stream?streams=${streams}`;
      let ws = new WebSocket(url);
      ws.onopen = ()=>{ binanceWsConnected = true; updateBinanceStatus(); };
      ws.onmessage = (ev)=>{
        try {
          const obj = JSON.parse(ev.data);
          const data = obj?.data || obj;
          const sym = (data?.s || data?.symbol || '').toUpperCase();
          const price = Number(data?.p || data?.markPrice || data?.c);
          if (sym && price && isFinite(price)){
            latestPriceMap[sym] = price;
            renderTopbar();
            try { renderBottombar(); } catch{}
          }
          lastWsMsg = Date.now(); updateBinanceStatus();
        } catch {}
      };
        ws.onerror = ()=>{ binanceWsConnected = false; updateBinanceStatus(); };
        ws.onclose = ()=>{
          binanceWsConnected = false; updateBinanceStatus();
          // 简单重连
          setTimeout(()=> startFuturesMarkWS(symbols), 3000);
        };
      } catch {}
    }

    startFuturesMarkWS(['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','DOGEUSDT','XRPUSDT','ZECUSDT','SOONUSDT','DASHUSDT','LTCUSDT','ASTERUSDT','SUIUSDT']);

    if (simEls.cancelAllBtn) simEls.cancelAllBtn.addEventListener('click', async ()=>{
      try {
        const sym = getSelectedOrDefaultSymbol();
        await execLiveOp({ action:'cancel_all', symbol: sym });
      } catch(e){ setSimStatus(`状态：操作失败：${e?.message||e}`); }
    });
    function getSelectedOrDefaultSymbol(){
      try {
        const tr = simEls.posTable?.querySelector('tbody tr.selected');
        const sym = tr?.children?.[0]?.textContent || '';
        if (sym) return sym;
      } catch {}
      return 'BTCUSDT';
    }
    if (simEls.closeAllBtn) simEls.closeAllBtn.addEventListener('click', async ()=>{
      try {
        await execLiveOp({ action:'close_all' });
      } catch(e){ setSimStatus(`状态：操作失败：${e?.message||e}`); }
    });

    // 暴露执行器给解析模块（仅保留实盘）
    window.execLiveOps = execLiveOps;

    // 初始化控件与渲染
  // 绑定表格选中交互
  bindRowSelection(simEls.posTable);
  bindRowSelection(simEls.openOrdersTable);
  // 初始刷新一次状态尾部累计时间；并每分钟更新一次
  try { setSimStatus(simEls.status.textContent || tr('ai_status_waiting')); } catch {}
  setInterval(()=>{ try { setSimStatus(_lastSimMsg); } catch {} }, 60000);

  // 绑定实盘配置交互与后端自动调取
  loadLiveCfg();
  applyBackendCfg();
  if (liveEls.saveBtn) liveEls.saveBtn.addEventListener('click', saveLiveCfg);
  // 移除实盘开关按钮的事件监听器，因为按钮已被移除
  // 交易页默认启用实盘（去掉模拟盘开关）
  try { if (/trading\.html$/i.test(location.pathname)) setLiveEnabled(true); } catch {}
}








})();
