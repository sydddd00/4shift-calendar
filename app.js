/* 4조 교대 근무표 — app.js (의존성 없는 순수 JS) */
(function () {
  'use strict';

  /* =========================================================
     1. 상수
     ========================================================= */
  const SHIFTS = {
    D: { label: '오전', short: '오전', time: '06:00–14:00', start: 6, end: 14 },
    E: { label: '오후', short: '오후', time: '14:00–22:00', start: 14, end: 22 },
    N: { label: '야간', short: '야간', time: '22:00–06:00', start: 22, end: 30 },
    O: { label: '휴무', short: '휴무', time: '비번', start: null, end: null }
  };
  const SHIFT_IDS = ['D', 'E', 'N', 'O'];
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const WD_SHORT = WD;

  const ORDER_PRESETS = [
    { arr: ['D', 'E', 'N', 'O'], label: '오전 → 오후 → 야간 → 휴무' },
    { arr: ['D', 'N', 'E', 'O'], label: '오전 → 야간 → 오후 → 휴무' },
    { arr: ['E', 'N', 'D', 'O'], label: '오후 → 야간 → 오전 → 휴무' },
    { arr: ['N', 'D', 'E', 'O'], label: '야간 → 오전 → 오후 → 휴무' },
    { arr: ['N', 'E', 'D', 'O'], label: '야간 → 오후 → 오전 → 휴무' },
    { arr: ['E', 'D', 'N', 'O'], label: '오후 → 오전 → 야간 → 휴무' }
  ];

  const TYPES = [
    { id: 'annual', label: '연차' },
    { id: 'amHalf', label: '오전반차' },
    { id: 'pmHalf', label: '오후반차' },
    { id: 'vacation', label: '휴가' },
    { id: 'comp', label: '대체휴무' },
    { id: 'overtime', label: '특근' },
    { id: 'change', label: '근무변경' },
    { id: 'memo', label: '메모' }
  ];

  const LS_STATE = 'shift4.state.v1';
  const LS_FLAGS = 'shift4.flags.v1';

  /* =========================================================
     2. 날짜 유틸
     ========================================================= */
  const pad = (n) => String(n).padStart(2, '0');

  function iso(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseISO(s) {
    const p = String(s).split('-').map(Number);
    return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
  }
  function dayNum(d) {
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }
  function mondayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - diff);
    return x;
  }
  function fmtNum(n) {
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  }
  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* =========================================================
     3. 상태
     ========================================================= */
  function defaultState() {
    return {
      v: 2,
      teams: [{ name: '1조' }, { name: '2조' }, { name: '3조' }, { name: '4조' }],
      myTeam: 0,
      baseMonday: iso(mondayOf(new Date())),
      baseShift: ['D', 'E', 'N', 'O'],
      order: ['D', 'E', 'N', 'O'],
      shiftDays: { D: [0, 1, 2, 3, 4, 5, 6], E: [0, 1, 2, 3, 4, 5, 6], N: [0, 1, 2, 3, 4, 5, 6] },
      annualTotal: 15,
      annualYear: new Date().getFullYear(),
      overrides: {}
    };
  }

  function normalize(s) {
    const d = defaultState();
    const out = Object.assign({}, d, s || {});
    out.teams = (Array.isArray(s && s.teams) ? s.teams : d.teams).slice(0, 4).map((t, i) => ({
      name: (t && typeof t.name === 'string' && t.name.trim()) ? t.name.trim().slice(0, 12) : d.teams[i].name
    }));
    while (out.teams.length < 4) out.teams.push({ name: (out.teams.length + 1) + '조' });
    out.myTeam = clampTeam(out.myTeam);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.baseMonday || '')) out.baseMonday = d.baseMonday;
    out.baseMonday = iso(mondayOf(parseISO(out.baseMonday)));
    out.baseShift = fixShifts(out.baseShift);
    out.order = fixOrder(out.order);
    out.shiftDays = normalizeShiftDays(s && s.shiftDays, s);
    delete out.weekMode;
    delete out.customDays;
    out.annualTotal = Math.max(0, Math.min(60, Number(out.annualTotal) || 0));
    out.annualYear = Number(out.annualYear) || new Date().getFullYear();
    out.overrides = (out.overrides && typeof out.overrides === 'object') ? out.overrides : {};
    // 잘못된 override 정리
    Object.keys(out.overrides).forEach((date) => {
      const teams = out.overrides[date];
      if (!teams || typeof teams !== 'object') { delete out.overrides[date]; return; }
      Object.keys(teams).forEach((tk) => {
        const ov = teams[tk];
        const ok = ov && typeof ov === 'object' && (
          ['annual', 'amHalf', 'pmHalf', 'vacation', 'comp', 'overtime', 'change', 'memo'].indexOf(ov.t) >= 0 ||
          (typeof ov.n === 'string' && ov.n.trim())
        );
        if (!ok) delete teams[tk];
      });
      if (!Object.keys(teams).length) delete out.overrides[date];
    });
    return out;
  }
  function clampTeam(v) {
    const n = Number(v);
    return (n >= 0 && n <= 3) ? n : 0;
  }
  function fixShifts(arr) {
    const out = (Array.isArray(arr) ? arr : []).slice(0, 4).map((x) => (SHIFT_IDS.indexOf(x) >= 0 ? x : 'O'));
    while (out.length < 4) out.push('O');
    return out;
  }
  function fixOrder(arr) {
    const out = [];
    (Array.isArray(arr) ? arr : []).forEach((x) => {
      if (SHIFT_IDS.indexOf(x) >= 0 && out.indexOf(x) < 0 && out.length < 4) out.push(x);
    });
    SHIFT_IDS.forEach((id) => { if (out.indexOf(id) < 0) out.push(id); });
    return out.slice(0, 4);
  }

  const LEGACY_WEEK = { '7': [0, 1, 2, 3, 4, 5, 6], '5': [1, 2, 3, 4, 5], '6': [1, 2, 3, 4, 5, 6] };

  function cleanDays(arr, fallback) {
    const src = Array.isArray(arr) ? arr : fallback;
    const out = [];
    (src || []).forEach((n) => {
      const v = Number(n);
      if (v >= 0 && v <= 6 && out.indexOf(v) < 0) out.push(v);
    });
    return out.sort((a, b) => a - b);
  }

  // 예전 버전(weekMode/customDays) 설정도 그대로 읽어서 shiftDays로 바꿔준다
  function normalizeShiftDays(sd, legacy) {
    let fallback = null;
    if (legacy) {
      if (legacy.weekMode === 'custom' && Array.isArray(legacy.customDays)) fallback = legacy.customDays;
      else if (LEGACY_WEEK[legacy.weekMode]) fallback = LEGACY_WEEK[legacy.weekMode];
    }
    const src = sd && typeof sd === 'object' ? sd : {};
    return {
      D: cleanDays(src.D, fallback || [0, 1, 2, 3, 4, 5, 6]),
      E: cleanDays(src.E, fallback || [0, 1, 2, 3, 4, 5, 6]),
      N: cleanDays(src.N, fallback || [0, 1, 2, 3, 4, 5, 6])
    };
  }
  function daysLabel(days) {
    const d = cleanDays(days, []);
    if (!d.length) return '근무 없음';
    if (d.length === 7) return '매일';
    if (d.join(',') === '1,2,3,4,5') return '월~금';
    if (d.join(',') === '1,2,3,4,5,6') return '월~토';
    if (d.join(',') === '0,6') return '토·일';
    return d.map((n) => WD[n]).join('·');
  }

  let state = loadState();
  let shared = null;          // 공유 링크(#s=)로 열린 근무표
  let firstRun = false;       // 저장된 설정이 없는 첫 실행
  let view = 'mine';          // 'mine' | 'all'
  let viewYear, viewMonth;
  let sheetCtx = null;
  let draft = null;
  let confirmReset = false;

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_STATE);
      if (raw) return normalize(JSON.parse(raw));
      firstRun = true;
    } catch (e) { /* 무시하고 기본값 */ }
    return defaultState();
  }
  function saveState() {
    try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch (e) { /* 저장 불가 */ }
  }
  function A() { return shared || state; }
  function afterEdit() {
    if (!shared) saveState();
    renderAll();
  }
  function flags() {
    try { return JSON.parse(localStorage.getItem(LS_FLAGS) || '{}') || {}; } catch (e) { return {}; }
  }
  function setFlag(k, v) {
    const f = flags(); f[k] = v;
    try { localStorage.setItem(LS_FLAGS, JSON.stringify(f)); } catch (e) { /* 무시 */ }
  }

  /* =========================================================
     4. 근무 계산
     ========================================================= */
  function weekIndex(s, d) {
    return Math.round((dayNum(mondayOf(d)) - dayNum(parseISO(s.baseMonday))) / 7);
  }
  function isWorkday(s, shiftId, d) {
    const days = (s.shiftDays && s.shiftDays[shiftId]) || [0, 1, 2, 3, 4, 5, 6];
    return days.indexOf(d.getDay()) >= 0;
  }
  function rotatedShift(s, teamIdx, d) {
    const base = s.baseShift[teamIdx] || 'O';
    const pos = s.order.indexOf(base);
    const wk = weekIndex(s, d);
    const idx = ((pos < 0 ? 0 : pos) + wk) % 4;
    return s.order[(idx + 4) % 4];
  }
  function baseShiftFor(s, teamIdx, d) {
    const sid = rotatedShift(s, teamIdx, d);
    if (sid === 'O') return 'O';                 // 휴무 주는 7일 모두 휴무
    return isWorkday(s, sid, d) ? sid : 'O';     // 그 주의 근무 요일이 아니면 휴무
  }

  // 그 날 그 조의 "실제" 표시 상태
  function effective(s, teamIdx, dateIso) {
    const d = parseISO(dateIso);
    const base = baseShiftFor(s, teamIdx, d);
    const ov = (s.overrides[dateIso] || {})[teamIdx];
    if (!ov) return { sid: base, kind: base === 'O' ? 'off' : 'work', memo: '' };
    switch (ov.t) {
      case 'annual': return { sid: 'O', kind: 'annual', memo: ov.n || '' };
      case 'vacation': return { sid: 'O', kind: 'vacation', memo: ov.n || '' };
      case 'comp': return { sid: 'O', kind: 'comp', memo: ov.n || '' };
      case 'amHalf': return { sid: base, kind: 'half', half: 'am', memo: ov.n || '' };
      case 'pmHalf': return { sid: base, kind: 'half', half: 'pm', memo: ov.n || '' };
      case 'overtime': return { sid: ov.s && SHIFTS[ov.s] ? ov.s : (base === 'O' ? 'D' : base), kind: 'ot', memo: ov.n || '' };
      case 'change': {
        const sid = ov.s && SHIFTS[ov.s] ? ov.s : base;
        return { sid, kind: sid === 'O' ? 'off' : 'work', changed: true, memo: ov.n || '' };
      }
      default:
        return { sid: base, kind: base === 'O' ? 'off' : 'work', memo: ov.n || '' };
    }
  }
  function effLabel(e) {
    if (e.kind === 'annual') return '연차';
    if (e.kind === 'vacation') return '휴가';
    if (e.kind === 'comp') return '대체휴무';
    if (e.kind === 'half') return e.half === 'am' ? '오전반차' : '오후반차';
    if (e.kind === 'ot') return '특근';
    return SHIFTS[e.sid] ? SHIFTS[e.sid].label : '휴무';
  }
  function effShort(e) {
    if (e.kind === 'annual') return '연차';
    if (e.kind === 'vacation') return '휴가';
    if (e.kind === 'comp') return '대체휴';
    if (e.kind === 'half') return e.half === 'am' ? '오전반' : '오후반';
    if (e.kind === 'ot') return '특근';
    return SHIFTS[e.sid] ? SHIFTS[e.sid].short : '휴무';
  }
  function effClass(e) {
    if (e.kind === 'annual') return 'b-annual';
    if (e.kind === 'vacation') return 'b-vac';
    if (e.kind === 'comp') return 'b-comp';
    if (e.kind === 'half') return 'b-half';
    if (e.kind === 'ot') return 'b-ot';
    return 'b-' + (SHIFTS[e.sid] ? e.sid : 'O');
  }
  function effDot(e) {
    if (e.kind === 'annual') return 'c-annual';
    if (e.kind === 'vacation') return 'c-vac';
    if (e.kind === 'comp') return 'c-comp';
    if (e.kind === 'half') return 'c-half';
    if (e.kind === 'ot') return 'c-ot';
    return 'c-' + (SHIFTS[e.sid] ? e.sid : 'O');
  }
  function effTime(e) {
    if (e.kind === 'work' || (e.kind === 'ot' && SHIFTS[e.sid])) return SHIFTS[e.sid].time;
    if (e.kind === 'half') return e.half === 'am' ? '오전 반차 · 오후 근무' : '오후 반차 · 오전 근무';
    return '';
  }

  function leaveStats(s) {
    const y = s.annualYear;
    let used = 0, vac = 0, ot = 0, comp = 0;
    Object.keys(s.overrides).forEach((date) => {
      if (date.slice(0, 4) !== String(y)) return;
      Object.keys(s.overrides[date]).forEach((tk) => {
        if (Number(tk) !== s.myTeam) return;
        const ov = s.overrides[date][tk];
        if (ov.t === 'annual') used += 1;
        else if (ov.t === 'amHalf' || ov.t === 'pmHalf') used += 0.5;
        else if (ov.t === 'vacation') vac += 1;
        else if (ov.t === 'overtime') ot += 1;
        else if (ov.t === 'comp') comp += 1;
      });
    });
    const total = s.annualTotal || 0;
    return { total, used, remain: Math.max(0, total - used), vac, ot, comp };
  }

  /* =========================================================
     5. 공유 링크 인코딩
     ========================================================= */
  function b64uEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDecode(str) {
    let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function packState(s) {
    return {
      n: s.teams.map((t) => t.name),
      m: s.myTeam,
      b: s.baseMonday,
      s: s.baseShift,
      o: s.order,
      w: s.weekMode,
      c: s.customDays,
      sd: s.shiftDays,
      a: s.annualTotal,
      y: s.annualYear,
      x: s.overrides
    };
  }
  function unpackState(o) {
    return normalize({
      v: 1,
      teams: (o.n || []).map((name) => ({ name })),
      myTeam: o.m, baseMonday: o.b, baseShift: o.s, order: o.o,
      shiftDays: o.sd, weekMode: o.w, customDays: o.c, annualTotal: o.a, annualYear: o.y,
      overrides: o.x || {}
    });
  }
  function shareUrl() {
    const s = A();
    const payload = b64uEncode(JSON.stringify(packState(s)));
    return location.origin + location.pathname + location.search + '#s=' + payload;
  }
  function readHash() {
    const m = location.hash.match(/^#s=(.+)$/);
    if (!m) return null;
    try { return unpackState(JSON.parse(b64uDecode(m[1]))); } catch (e) { return null; }
  }

  /* =========================================================
     6. 렌더
     ========================================================= */
  const $ = (id) => document.getElementById(id);

  function renderAll() {
    renderToday();
    renderGrid();
    renderLegend();
    renderLeave();
    renderSharedBanner();
  }

  function renderSharedBanner() {
    const el = $('sharedBanner');
    if (!shared) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML =
      '<div class="sb-text">공유받은 근무표를 보고 있어요</div>' +
      '<button class="primary" data-action="save-shared">내 기기에 저장</button>' +
      '<button data-action="exit-shared">내 근무표로</button>';
  }

  function renderToday() {
    const s = A();
    const today = new Date();
    const ti = iso(today);
    const e = effective(s, s.myTeam, ti);
    const time = effTime(e);
    const chips = s.teams.map((t, i) => {
      const te = effective(s, i, ti);
      return '<span class="tc-team' + (i === s.myTeam ? ' me' : '') + '">' +
        '<i class="dot ' + effDot(te) + '"></i>' +
        '<span class="tn">' + esc(t.name) + '</span>' +
        esc(effShort(te)) + '</span>';
    }).join('');

    $('todayCard').innerHTML =
      '<div class="tc-head"><span class="tc-label">오늘</span>' +
      '<span class="tc-date">' + (today.getMonth() + 1) + '월 ' + today.getDate() + '일 ' + WD[today.getDay()] + '요일</span></div>' +
      '<div class="tc-main">' +
      '<span class="tc-shift' + (e.kind === 'off' ? ' is-off' : '') + '">' + esc(effLabel(e)) + '</span>' +
      (time ? '<span class="tc-time">' + esc(time) + '</span>' : '') +
      '<button class="tc-my" data-action="pick-my-team" aria-label="내 조 바꾸기">' + esc(s.teams[s.myTeam].name) + ' ▾</button>' +
      '</div>' +
      (e.memo ? '<div class="lv-sub" style="margin-top:8px">메모 · ' + esc(e.memo) + '</div>' : '') +
      '<div class="tc-teams">' + chips + '</div>';
    $('todayCard').onclick = (ev) => {
      if (ev.target.closest('[data-action]')) return;
      openDay(ti);
    };
  }

  function renderGrid() {
    const s = A();
    const grid = $('grid');
    const first = new Date(viewYear, viewMonth, 1);
    const startDow = first.getDay();
    const dim = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells = (startDow + dim) <= 35 ? 35 : 42;
    const start = new Date(viewYear, viewMonth, 1 - startDow);
    const todayIso = iso(new Date());
    const myTeam = s.myTeam;
    let html = '';

    for (let i = 0; i < cells; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const dateIso = iso(d);
      const inMonth = d.getMonth() === viewMonth;
      const cls = ['cell'];
      if (!inMonth) cls.push('out');
      if (d.getDay() === 0) cls.push('sun');
      if (d.getDay() === 6) cls.push('sat');
      if (dateIso === todayIso) cls.push('today');

      let inner = '<span class="dnum">' + d.getDate() + '</span>';

      if (view === 'mine') {
        const e = effective(s, myTeam, dateIso);
        inner += '<span class="badge ' + effClass(e) + '">' + esc(effShort(e)) + '</span>';
        if (e.changed) inner += '<i class="chg-dot"></i>';
        else if (e.memo) inner += '<i class="memo-dot"></i>';
      } else {
        inner += '<span class="mini">';
        for (let t = 0; t < 4; t++) {
          const e = effective(s, t, dateIso);
          inner += '<span class="mrow"><i class="dot ' + effDot(e) + '"></i>' +
            '<span class="tn">' + (t + 1) + '</span>' + esc(effShort(e)) + '</span>';
        }
        inner += '</span>';
      }
      html += '<button class="' + cls.join(' ') + '" data-date="' + dateIso + '" aria-label="' + dateIso + ' 근무 보기">' + inner + '</button>';
    }
    grid.innerHTML = html;
    grid.querySelectorAll('[data-date]').forEach((btn) => {
      btn.addEventListener('click', () => openDay(btn.getAttribute('data-date')));
    });
  }

  function renderLegend() {
    const items = [
      ['c-D', '오전 06–14'], ['c-E', '오후 14–22'], ['c-N', '야간 22–06'], ['c-O', '휴무'],
      ['c-annual', '연차'], ['c-vac', '휴가'], ['c-comp', '대체휴무'], ['c-ot', '특근']
    ];
    $('legend').innerHTML = items.map(([c, t]) =>
      '<span><i class="dot ' + c + '"></i>' + t + '</span>').join('');
  }

  function renderLeave() {
    const s = A();
    const st = leaveStats(s);
    const pct = st.total ? Math.min(100, (st.used / st.total) * 100) : 0;
    $('leaveCard').innerHTML =
      '<div class="lv-head"><h2>' + s.annualYear + '년 연차 · ' + esc(s.teams[s.myTeam].name) + '</h2>' +
      '<button class="lv-edit" data-action="settings">총 연차 수정</button></div>' +
      '<div class="lv-num"><strong>' + fmtNum(st.remain) + '</strong><span>일 남음</span></div>' +
      '<div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="lv-sub">총 ' + fmtNum(st.total) + '일 중 ' + fmtNum(st.used) + '일 사용' +
      ' · 휴가 ' + fmtNum(st.vac) + '일 · 대체휴무 ' + fmtNum(st.comp) + '일 · 특근 ' + fmtNum(st.ot) + '일</div>';
  }

  /* =========================================================
     7. 시트 공통
     ========================================================= */
  const backdrop = $('backdrop');
  const sheetInner = $('sheetInner');

  function showSheet() {
    backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    backdrop.hidden = true;
    sheetInner.innerHTML = '';
    document.body.style.overflow = '';
    sheetCtx = null;
    draft = null;
    confirmReset = false;
  }
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) closeSheet();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !backdrop.hidden) closeSheet();
  });

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2200);
  }

  /* =========================================================
     8. 날짜 상세 시트
     ========================================================= */
  function openDay(dateIso) {
    const s = A();
    sheetCtx = { date: dateIso, team: s.myTeam, pending: null };
    renderDaySheet();
    showSheet();
  }

  function renderDaySheet() {
    const s = A();
    const date = sheetCtx.date;
    const d = parseISO(date);
    const isToday = iso(new Date()) === date;

    const rows = s.teams.map((t, i) => {
      const e = effective(s, i, date);
      const ov = (s.overrides[date] || {})[i];
      return '<div class="trow' + (i === sheetCtx.team ? ' selected' : '') + '" data-team="' + i + '" role="button" tabindex="0">' +
        '<span class="tn">' + esc(t.name) + (i === s.myTeam ? '<em>나</em>' : '') + '</span>' +
        (e.memo && e.kind === 'work' ? '<span class="memo-txt">' + esc(e.memo) + '</span>' : '') +
        '<span class="badge ' + effClass(e) + '">' + esc(effLabel(e)) + '</span>' +
        (ov ? '<button class="ovex" data-clear="' + i + '" aria-label="이 날 기록 삭제">✕</button>' : '') +
        '</div>';
    }).join('');

    const cur = (s.overrides[date] || {})[sheetCtx.team] || {};
    const chips = TYPES.map((t) => {
      const on = (t.id === 'memo') ? !!cur.n : (cur.t === t.id);
      return '<button data-type="' + t.id + '" class="' + (on ? 'on' : '') + '">' + t.label + '</button>';
    }).join('');

    let editor = '';
    const pending = sheetCtx.pending;
    if (pending === 'overtime' || pending === 'change') {
      const ids = pending === 'change' ? SHIFT_IDS : ['D', 'E', 'N'];
      editor = '<div class="editor"><div class="ed-label">' +
        (pending === 'overtime' ? '특근한 근무를 고르세요' : '어떤 근무로 바꿀까요?') + '</div>' +
        '<div class="shift-pick">' +
        ids.map((id) => '<button data-pick="' + id + '" class="' + (cur.s === id ? 'on' : '') + '">' +
          SHIFTS[id].label + '<br><span style="font-size:9.5px;font-weight:600;opacity:.75">' + SHIFTS[id].time + '</span></button>').join('') +
        '</div></div>';
    } else if (pending === 'memo') {
      editor = '<div class="editor"><div class="ed-label">메모</div>' +
        '<div class="memo-row"><input id="memoInput" type="text" maxlength="60" placeholder="예: 야간 후 병원" value="' + esc(cur.n || '') + '">' +
        '<button data-action="save-memo">저장</button></div></div>';
    }

    sheetInner.innerHTML =
      '<div class="sheet-head">' +
      '<div><h2>' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 <span style="font-size:14px;color:var(--muted);font-weight:700">' + WD[d.getDay()] + '요일</span></h2>' +
      '<div class="sub">' + (isToday ? '오늘 · ' : '') + '조를 눌러 그 조의 기록을 추가하세요</div></div>' +
      '<button class="close-btn" data-action="close" aria-label="닫기">✕</button></div>' +
      '<div class="team-rows">' + rows + '</div>' +
      '<div class="add-head">추가 · <b>' + esc(s.teams[sheetCtx.team].name) + '</b></div>' +
      '<div class="type-grid">' + chips + '</div>' +
      editor +
      '<div class="sheet-actions"><button data-action="close">닫기</button></div>';

    // 이벤트
    sheetInner.querySelectorAll('[data-team]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-clear]')) return;
        sheetCtx.team = Number(el.getAttribute('data-team'));
        sheetCtx.pending = null;
        renderDaySheet();
      });
    });
    sheetInner.querySelectorAll('[data-clear]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        clearOverride(sheetCtx.date, Number(el.getAttribute('data-clear')));
        sheetCtx.pending = null;
        renderDaySheet();
      });
    });
    sheetInner.querySelectorAll('[data-type]').forEach((el) => {
      el.addEventListener('click', () => applyType(el.getAttribute('data-type')));
    });
    sheetInner.querySelectorAll('[data-pick]').forEach((el) => {
      el.addEventListener('click', () => {
        const type = sheetCtx.pending;
        pickShift(sheetCtx.date, sheetCtx.team, type, el.getAttribute('data-pick'));
        sheetCtx.pending = null;
        renderDaySheet();
      });
    });
    const mi = sheetInner.querySelector('#memoInput');
    if (mi) mi.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveMemo(); });
  }

  function applyType(type) {
    const s = A();
    const date = sheetCtx.date;
    const team = sheetCtx.team;
    const cur = (s.overrides[date] || {})[team] || {};

    if (type === 'memo') {
      sheetCtx.pending = sheetCtx.pending === 'memo' ? null : 'memo';
      renderDaySheet();
      return;
    }
    if (type === 'overtime' || type === 'change') {
      if (cur.t === type) {
        clearOverride(date, team);
        sheetCtx.pending = null;
        renderDaySheet();
      } else {
        sheetCtx.pending = type;
        renderDaySheet();
        const ed = sheetInner.querySelector('.editor');
        if (ed) ed.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    if (cur.t === type) {
      clearOverride(date, team);
    } else {
      setOverride(date, team, { t: type, s: cur.s, n: cur.n });
    }
    sheetCtx.pending = null;
    renderDaySheet();
  }

  function pickShift(date, team, type, sid) {
    const s = A();
    const cur = (s.overrides[date] || {})[team] || {};
    setOverride(date, team, { t: type, s: sid, n: cur.n });
  }

  function saveMemo() {
    const s = A();
    const el = sheetInner.querySelector('#memoInput');
    if (!el) return;
    const val = el.value.trim().slice(0, 60);
    const cur = (s.overrides[sheetCtx.date] || {})[sheetCtx.team] || {};
    if (!val && !cur.t) { clearOverride(sheetCtx.date, sheetCtx.team); }
    else setOverride(sheetCtx.date, sheetCtx.team, { t: cur.t, s: cur.s, n: val || undefined });
    sheetCtx.pending = null;
    renderDaySheet();
    toast(val ? '메모를 저장했어요' : '메모를 지웠어요');
  }

  function setOverride(date, team, ov) {
    const s = A();
    if (!s.overrides[date]) s.overrides[date] = {};
    const clean = {};
    if (ov.t) clean.t = ov.t;
    if (ov.s) clean.s = ov.s;
    if (ov.n) clean.n = ov.n;
    if (!clean.t && !clean.n) { delete s.overrides[date][team]; }
    else s.overrides[date][team] = clean;
    if (!Object.keys(s.overrides[date]).length) delete s.overrides[date];
    afterEdit();
  }
  function clearOverride(date, team) {
    const s = A();
    if (s.overrides[date]) {
      delete s.overrides[date][team];
      if (!Object.keys(s.overrides[date]).length) delete s.overrides[date];
    }
    afterEdit();
  }

  /* =========================================================
     9. 설정 시트
     ========================================================= */
  function openSettings() {
    draft = JSON.parse(JSON.stringify(A()));
    confirmReset = false;
    renderSettings();
    showSheet();
  }

  function presetDays(n) {
    if (n === 7) return [0, 1, 2, 3, 4, 5, 6];
    return n === 5 ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6];
  }
  function markPresets(row, id) {
    if (!row) return;
    const cur = (draft.shiftDays[id] || []).join(',');
    row.querySelectorAll('[data-sdq]').forEach((b) => {
      const n = Number(b.getAttribute('data-sdq').split('-')[1]);
      b.classList.toggle('on', cur === presetDays(n).join(','));
    });
  }

  function renderSettings() {
    const s = draft;
    const names = s.teams.map((t, i) =>
      '<div class="tn-cell"><span class="tn-badge n' + (i + 1) + '">' + (i + 1) + '</span>' +
      '<input data-tn="' + i + '" type="text" maxlength="12" value="' + esc(t.name) + '" aria-label="' + (i + 1) + '번째 조 이름"></div>').join('');

    const myPick = s.teams.map((t, i) =>
      '<button data-mt="' + i + '" class="' + (i === s.myTeam ? 'on' : '') + '">' + esc(t.name) + '</button>').join('');

    const baseRows = s.teams.map((t, i) =>
      '<div class="pick-row"><span class="pr-name">' + (i + 1) + '. ' + esc(t.name) + (i === s.myTeam ? '<em>나</em>' : '') + '</span>' +
      '<select data-bs="' + i + '">' + SHIFT_IDS.map((id) =>
        '<option value="' + id + '"' + (s.baseShift[i] === id ? ' selected' : '') + '>' + SHIFTS[id].label + '</option>').join('') +
      '</select></div>').join('');

    const curOrder = s.order.join('');
    const orderOpts = ORDER_PRESETS.map((p) => {
      const id = p.arr.join('');
      return '<option value="' + id + '"' + (curOrder === id ? ' selected' : '') + '>' + p.label + '</option>';
    }).join('') + (ORDER_PRESETS.some((p) => p.arr.join('') === curOrder) ? '' :
      '<option value="' + curOrder + '" selected>직접 설정한 순서</option>');

    const sdRows = ['D', 'E', 'N'].map((id) => {
      const days = s.shiftDays[id] || [];
      const checks = WD.map((w, i) =>
        '<label class="' + (days.indexOf(i) >= 0 ? 'on' : '') + '"><input type="checkbox" data-sdday="' + id + '-' + i + '"' +
        (days.indexOf(i) >= 0 ? ' checked' : '') + '>' + w + '</label>').join('');
      const quick = [5, 6, 7].map((n) =>
        '<button data-sdq="' + id + '-' + n + '" class="' + (days.join(',') === presetDays(n).join(',') ? 'on' : '') + '">' + n + '일</button>').join('');
      return '<div class="sd-row">' +
        '<div class="sd-head"><span class="badge b-' + id + '">' + SHIFTS[id].label + ' <em>' + SHIFTS[id].time + '</em></span>' +
        '<div class="sd-quick">' + quick + '</div></div>' +
        '<div class="day-checks">' + checks + '</div></div>';
    }).join('');

    sheetInner.innerHTML =
      '<div class="sheet-head"><div><h2>설정</h2>' +
      '<div class="sub">한 번만 정하면 이후 근무표는 자동으로 계산돼요</div></div>' +
      '<button class="close-btn" data-action="close" aria-label="닫기">✕</button></div>' +

      '<div class="sheet-sec"><h3>조 이름</h3><div class="team-name-grid">' + names + '</div></div>' +

      '<div class="sheet-sec"><h3>내 조</h3><div class="seg-mini">' + myPick + '</div></div>' +

      '<div class="sheet-sec"><h3>기준 주</h3>' +
      '<div class="form-row"><label for="setBase">기준 주의 월요일</label>' +
      '<input type="date" id="setBase" value="' + s.baseMonday + '"></div>' +
      '<p class="hint">이 주에 각 조가 어떤 근무였는지 정하면, 그 전·후 모든 주가 1주 단위로 자동 계산됩니다. 월요일이 아닌 날짜를 골라도 그 주 월요일로 맞춰요.</p>' +
      '<div class="base-grid" style="margin-top:9px">' + baseRows + '</div></div>' +

      '<div class="sheet-sec"><h3>순환 순서 (1주마다)</h3>' +
      '<div class="form-row"><select id="setOrder" style="max-width:none;width:100%">' + orderOpts + '</select></div></div>' +

      '<div class="sheet-sec"><h3>근무 요일 (시프트마다)</h3>' +
      '<p class="hint">오전주·오후주·야간주마다 회사 규칙이 다르면 여기서 맞춰 주세요. 체크한 요일만 근무하고, 나머지는 휴무로 표시됩니다. 휴무 주는 7일 내내 휴무예요.</p>' +
      '<div class="sd-list">' + sdRows +
      '<div class="sd-row sd-off"><span class="badge b-O">휴무</span><span class="sd-off-t">휴무 주 · 7일 내내 휴무</span></div>' +
      '</div></div>' +

      '<div class="sheet-sec"><h3>연차</h3>' +
      '<div class="form-row"><label for="setAnnual">' + s.annualYear + '년 총 연차</label>' +
      '<input type="number" id="setAnnual" min="0" max="60" step="0.5" value="' + s.annualTotal + '"> 일</div>' +
      '<p class="hint">연차 1일, 오전·오후 반차 0.5일로 계산해 잔여 연차를 보여줘요. 휴가는 따로 세요.</p></div>' +

      '<div class="sheet-sec"><h3>데이터</h3>' +
      '<div class="share-btns"><button data-action="share">공유 링크 만들기</button>' +
      '<button data-action="ics">캘린더(.ics) 내보내기</button></div>' +
      '<div class="sheet-actions">' +
      '<button class="danger" data-action="reset">' + (confirmReset ? '한 번 더 누르면 초기화' : '초기화') + '</button>' +
      '<button class="primary" data-action="save-settings">저장</button></div>' +
      '<p class="reset-note">초기화하면 조 이름·기준 주·연차·기록이 모두 지워지고 기본값으로 돌아가요.</p></div>' +

      '<div class="sheet-actions"><button data-action="close">닫기</button></div>';

    // 폼 바인딩
    sheetInner.querySelectorAll('[data-tn]').forEach((el) => {
      el.addEventListener('input', () => {
        const i = Number(el.getAttribute('data-tn'));
        draft.teams[i].name = el.value.trim().slice(0, 12) || ((i + 1) + '조');
      });
    });
    sheetInner.querySelectorAll('[data-mt]').forEach((el) => {
      el.addEventListener('click', () => {
        draft.myTeam = Number(el.getAttribute('data-mt'));
        renderSettings();
      });
    });
    const base = sheetInner.querySelector('#setBase');
    if (base) base.addEventListener('change', () => {
      const d = parseISO(base.value);
      if (!isNaN(d.getTime())) { draft.baseMonday = iso(mondayOf(d)); base.value = draft.baseMonday; }
    });
    sheetInner.querySelectorAll('[data-bs]').forEach((el) => {
      el.addEventListener('change', () => {
        draft.baseShift[Number(el.getAttribute('data-bs'))] = el.value;
      });
    });
    const ord = sheetInner.querySelector('#setOrder');
    if (ord) ord.addEventListener('change', () => { draft.order = ord.value.split(''); });
    sheetInner.querySelectorAll('[data-sdday]').forEach((el) => {
      el.addEventListener('change', () => {
        const parts = el.getAttribute('data-sdday').split('-');
        const id = parts[0];
        const dow = Number(parts[1]);
        const set = (draft.shiftDays[id] || []).slice();
        const idx = set.indexOf(dow);
        if (el.checked && idx < 0) set.push(dow);
        if (!el.checked && idx >= 0) set.splice(idx, 1);
        draft.shiftDays[id] = set.sort((a, b) => a - b);
        el.parentElement.classList.toggle('on', el.checked);
        markPresets(el.closest('.sd-row'), id);
      });
    });
    sheetInner.querySelectorAll('[data-sdq]').forEach((el) => {
      el.addEventListener('click', () => {
        const parts = el.getAttribute('data-sdq').split('-');
        const id = parts[0];
        const n = Number(parts[1]);
        draft.shiftDays[id] = presetDays(n);
        const row = el.closest('.sd-row');
        row.querySelectorAll('[data-sdday]').forEach((cb) => {
          const dow = Number(cb.getAttribute('data-sdday').split('-')[1]);
          const on = draft.shiftDays[id].indexOf(dow) >= 0;
          cb.checked = on;
          cb.parentElement.classList.toggle('on', on);
        });
        markPresets(row, id);
      });
    });
    const ann = sheetInner.querySelector('#setAnnual');
    if (ann) ann.addEventListener('input', () => {
      draft.annualTotal = Math.max(0, Math.min(60, Number(ann.value) || 0));
    });
  }

  function saveSettings() {
    const d = normalize(draft);
    if (shared) {
      shared = d;
      state.myTeam = d.myTeam;
      saveState();
    } else {
      state = d;
      saveState();
    }
    closeSheet();
    renderAll();
    toast('설정을 저장했어요');
  }

  function resetAll() {
    if (!confirmReset) {
      confirmReset = true;
      renderSettings();
      return;
    }
    state = defaultState();
    shared = null;
    saveState();
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    closeSheet();
    viewYear = new Date().getFullYear();
    viewMonth = new Date().getMonth();
    renderAll();
    toast('기본값으로 초기화했어요');
  }

  /* =========================================================
     10. 공유 / 내보내기
     ========================================================= */
  function openShare() {
    const url = shareUrl();
    const s = A();
    const st = leaveStats(s);
    sheetInner.innerHTML =
      '<div class="sheet-head"><div><h2>근무표 공유</h2>' +
      '<div class="sub">링크를 받은 친구는 같은 근무표를 바로 볼 수 있어요</div></div>' +
      '<button class="close-btn" data-action="close" aria-label="닫기">✕</button></div>' +
      '<div class="share-link"><input id="shareUrlInput" readonly value="' + esc(url) + '">' +
      '<button data-action="copy">복사</button></div>' +
      '<div class="share-btns"><button class="primary" data-action="native-share">공유하기</button>' +
      '<button data-action="ics">캘린더(.ics)</button></div>' +
      '<dl class="kv">' +
      '<dt>내 조</dt><dd>' + esc(s.teams[s.myTeam].name) + '</dd>' +
      '<dt>기준 주</dt><dd>' + s.baseMonday + ' (월)</dd>' +
      '<dt>순환</dt><dd>' + s.order.map((id) => SHIFTS[id].label).join(' → ') + '</dd>' +
      '<dt>근무 요일</dt><dd>오전 ' + daysLabel(s.shiftDays.D) + ' · 오후 ' + daysLabel(s.shiftDays.E) + ' · 야간 ' + daysLabel(s.shiftDays.N) + '</dd>' +
      '<dt>기록</dt><dd>연차 ' + fmtNum(st.used) + '일 · 휴가 ' + fmtNum(st.vac) + '일</dd>' +
      '</dl>' +
      '<p class="hint">링크에는 지금 설정(조 이름·기준 주·순환)과 등록한 연차·휴가·메모가 함께 담깁니다. 친구는 링크를 열어 "내 기기에 저장"을 누르면 그 근무표를 자기 기기에도 저장할 수 있어요.<br><br>나중에 연차를 더 추가하면 그때 <b>새 링크를 다시 보내주세요</b> — 링크는 보낸 순간의 내용으로 고정됩니다.</p>' +
      (shared ? '<div class="sheet-actions"><button class="primary" data-action="save-shared">이 근무표를 내 기기에 저장</button></div>' : '') +
      '<div class="sheet-actions"><button data-action="close">닫기</button></div>';

    const inp = sheetInner.querySelector('#shareUrlInput');
    if (inp) inp.addEventListener('focus', () => inp.select());
    showSheet();
  }

  async function copyLink() {
    const url = shareUrl();
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const inp = sheetInner.querySelector('#shareUrlInput') || (() => {
          const t = document.createElement('textarea');
          t.value = url; document.body.appendChild(t); return t;
        })();
        inp.select();
        document.execCommand('copy');
      }
      toast('링크를 복사했어요');
    } catch (e) {
      toast('복사가 안 되면 주소를 길게 눌러 복사해 주세요');
    }
  }

  async function nativeShare() {
    const url = shareUrl();
    const s = A();
    const data = {
      title: '4조 교대 근무표',
      text: s.teams[s.myTeam].name + ' 근무표 같이 봐요',
      url: url
    };
    if (navigator.share) {
      try { await navigator.share(data); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    await copyLink();
  }

  function icsStamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }
  function icsDate(d) {
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }
  function icsEscape(t) {
    return String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  function buildIcs(s, teamIdx, months) {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start.getFullYear(), start.getMonth() + (months || 3), start.getDate());
    const teamName = s.teams[teamIdx].name;
    const L = [];
    L.push('BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//4shift-calendar//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH');
    L.push('X-WR-CALNAME:' + icsEscape(teamName + ' 근무표'));
    L.push('X-WR-TIMEZONE:Asia/Seoul');

    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const dateIso = iso(d);
      const e = effective(s, teamIdx, dateIso);
      const uid = dateIso.replace(/-/g, '') + '-' + teamIdx;
      if (e.kind === 'work' || e.kind === 'ot') {
        const sh = SHIFTS[e.sid];
        if (!sh || sh.start == null) continue;
        const st = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh.start, 0, 0);
        const en = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh.end, 0, 0);
        const title = (e.kind === 'ot' ? '특근 ' : '') + teamName + ' ' + sh.label;
        L.push('BEGIN:VEVENT', 'UID:' + uid + '@4shift-calendar', 'DTSTAMP:' + icsStamp(new Date()),
          'DTSTART:' + icsStamp(st), 'DTEND:' + icsStamp(en),
          'SUMMARY:' + icsEscape(title),
          'DESCRIPTION:' + icsEscape(sh.label + ' ' + sh.time + (e.memo ? ' / ' + e.memo : '')),
          'TRANSP:OPAQUE', 'END:VEVENT');
      } else if (e.kind === 'annual' || e.kind === 'vacation' || e.kind === 'half' || e.kind === 'comp') {
        const label = e.kind === 'half' ? (e.half === 'am' ? '오전반차' : '오후반차')
          : (e.kind === 'annual' ? '연차' : (e.kind === 'comp' ? '대체휴무' : '휴가'));
        const nd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        L.push('BEGIN:VEVENT', 'UID:' + uid + '-leave@4shift-calendar', 'DTSTAMP:' + icsStamp(new Date()),
          'DTSTART;VALUE=DATE:' + icsDate(d), 'DTEND;VALUE=DATE:' + icsDate(nd),
          'SUMMARY:' + icsEscape(teamName + ' ' + label),
          'DESCRIPTION:' + icsEscape(label + (e.memo ? ' / ' + e.memo : '')),
          'TRANSP:TRANSPARENT', 'END:VEVENT');
      }
    }
    L.push('END:VCALENDAR');
    return L.join('\r\n') + '\r\n';
  }

  function downloadIcs() {
    const s = A();
    const text = buildIcs(s, s.myTeam, 3);
    const name = '4조-근무표-' + s.teams[s.myTeam].name + '.ics';
    try {
      const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('캘린더 파일을 만들었어요 — 열어서 추가하세요');
    } catch (e) {
      toast('이 브라우저에서는 파일 저장이 막혔어요');
    }
  }

  /* =========================================================
     11. 월 이동 / 월 선택
     ========================================================= */
  function goMonth(delta) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    renderGrid();
    updateMonthLabel();
  }
  function updateMonthLabel() {
    $('monthLabel').textContent = viewYear + '년 ' + (viewMonth + 1) + '월';
  }
  function openMonthPicker() {
    let py = viewYear;
    const draw = () => {
      sheetInner.innerHTML =
        '<div class="sheet-head"><div><h2>월 선택</h2></div>' +
        '<button class="close-btn" data-action="close" aria-label="닫기">✕</button></div>' +
        '<div class="year-row"><button data-y="-1">‹</button><b>' + py + '년</b><button data-y="1">›</button></div>' +
        '<div class="months">' + Array.from({ length: 12 }, (_, i) =>
          '<button data-m="' + i + '" class="' + (py === viewYear && i === viewMonth ? 'on' : '') + '">' + (i + 1) + '월</button>').join('') + '</div>' +
        '<div class="sheet-actions"><button data-action="close">닫기</button></div>';
      sheetInner.querySelectorAll('[data-y]').forEach((el) => el.addEventListener('click', () => {
        py += Number(el.getAttribute('data-y')); draw();
      }));
      sheetInner.querySelectorAll('[data-m]').forEach((el) => el.addEventListener('click', () => {
        viewYear = py; viewMonth = Number(el.getAttribute('data-m'));
        closeSheet(); renderGrid(); updateMonthLabel();
      }));
    };
    draw();
    showSheet();
  }

  function openMyTeamPicker() {
    const s = A();
    sheetInner.innerHTML =
      '<div class="sheet-head"><div><h2>내 조 고르기</h2>' +
      '<div class="sub">나는 몇 조인가요? 이 기기에만 저장돼요</div></div>' +
      '<button class="close-btn" data-action="close" aria-label="닫기">✕</button></div>' +
      '<div class="team-rows">' + s.teams.map((t, i) => {
        const e = effective(s, i, iso(new Date()));
        return '<div class="trow' + (i === s.myTeam ? ' selected' : '') + '" data-pick-team="' + i + '" role="button" tabindex="0">' +
          '<span class="tn">' + esc(t.name) + (i === s.myTeam ? '<em>내 조</em>' : '') + '</span>' +
          '<span class="badge ' + effClass(e) + '">오늘 ' + esc(effShort(e)) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="sheet-actions"><button data-action="close">닫기</button></div>';

    sheetInner.querySelectorAll('[data-pick-team]').forEach((el) => {
      el.addEventListener('click', () => {
        const i = Number(el.getAttribute('data-pick-team'));
        (shared || state).myTeam = i;
        state.myTeam = i;
        saveState();
        closeSheet();
        renderAll();
        toast((shared || state).teams[i].name + ' 기준으로 볼게요');
      });
    });
    showSheet();
  }

  /* =========================================================
     12. 설치 안내
     ========================================================= */
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      navigator.standalone === true;
  }
  function isIOS() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function setBanner(v) {
    const el = $('installBanner');
    el.hidden = !v;
    document.body.classList.toggle('has-ib', !!v);
  }
  function maybeShowInstallBanner() {
    if (isStandalone()) return;
    if (flags().installDismissed) return;
    const el = $('installBanner');
    if (isIOS()) { setBanner(true); return; }
    // 그 외(안드로이드·PC)는 beforeinstallprompt가 오면 안내
    window.addEventListener('beforeinstallprompt', (ev) => {
      ev.preventDefault();
      window.__bip = ev;
      setBanner(true);
    });
  }
  function openInstallHelp() {
    const ios = isIOS();
    sheetInner.innerHTML =
      '<div class="sheet-head"><div><h2>홈 화면에 추가</h2>' +
      '<div class="sub">한 번 추가하면 앱처럼 전체 화면으로 열려요</div></div>' +
      '<button class="close-btn" data-action="close" aria-label="닫기">✕</button></div>' +
      (ios
        ? '<div class="steps">' +
          '<div class="step"><span class="num">1</span><div><div class="st-t">Safari 하단(또는 상단)의 공유 버튼을 누르세요</div><div class="st-s">네모 위로 화살표가 나온 아이콘이에요.</div></div></div>' +
          '<div class="step"><span class="num">2</span><div><div class="st-t">목록을 내려 "홈 화면에 추가"를 선택</div><div class="st-s">"북마크에 추가"가 아니에요.</div></div></div>' +
          '<div class="step"><span class="num">3</span><div><div class="st-t">오른쪽 위 "추가"를 누르면 끝</div><div class="st-s">홈 화면의 "4조 근무표" 아이콘으로 바로 열립니다.</div></div></div>' +
          '</div><p class="hint">카카오톡 등 앱 안의 브라우저에서는 추가가 안 될 수 있어요. 그럴 때는 Safari에서 주소를 열어 주세요.</p>'
        : '<div class="steps">' +
          '<div class="step"><span class="num">1</span><div><div class="st-t">브라우저 메뉴(⋮ 또는 공유)를 여세요</div></div></div>' +
          '<div class="step"><span class="num">2</span><div><div class="st-t">"홈 화면에 추가" 또는 "앱 설치"를 선택</div></div></div>' +
          '</div>') +
      '<div class="sheet-actions"><button class="primary" data-action="close">알겠어요</button></div>';
    showSheet();
  }

  /* =========================================================
     13. 전역 액션
     ========================================================= */
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const act = el.getAttribute('data-action');
    switch (act) {
      case 'share': openShare(); break;
      case 'settings': openSettings(); break;
      case 'ics': downloadIcs(); break;
      case 'close': closeSheet(); break;
      case 'copy': copyLink(); break;
      case 'native-share': nativeShare(); break;
      case 'prev': goMonth(-1); break;
      case 'next': goMonth(1); break;
      case 'today': {
        const n = new Date();
        viewYear = n.getFullYear(); viewMonth = n.getMonth();
        renderGrid(); updateMonthLabel();
        break;
      }
      case 'pickMonth': openMonthPicker(); break;
      case 'pick-my-team': openMyTeamPicker(); break;
      case 'save-settings': saveSettings(); break;
      case 'reset': resetAll(); break;
      case 'save-memo': saveMemo(); break;
      case 'install-help': openInstallHelp(); break;
      case 'install-dismiss': {
        setFlag('installDismissed', true);
        setBanner(false);
        break;
      }
      case 'save-shared': {
        state = normalize(JSON.parse(JSON.stringify(shared)));
        shared = null;
        saveState();
        if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
        renderAll();
        toast('내 기기에 저장했어요');
        break;
      }
      case 'exit-shared': {
        shared = null;
        if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
        renderAll();
        toast('내 근무표로 돌아왔어요');
        break;
      }
    }
  });

  // 보기 전환
  document.getElementById('viewSwitch').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-view]');
    if (!btn) return;
    view = btn.getAttribute('data-view');
    document.querySelectorAll('#viewSwitch button').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderGrid();
  });

  // 좌우 스와이프로 달 이동
  (function swipe() {
    let x0 = null, y0 = null, t0 = 0;
    const cal = document.querySelector('.cal');
    cal.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
    }, { passive: true });
    cal.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Date.now() - t0 < 600 && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.8) {
        goMonth(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
  })();

  /* =========================================================
     14. 시작
     ========================================================= */
  function boot() {
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    const fromHash = readHash();
    if (fromHash) shared = fromHash;
    updateMonthLabel();
    renderAll();
    maybeShowInstallBanner();

    // 처음 여는 사람에게는 설정을 한 번에 끝내도록 안내
    if (firstRun && !shared) {
      setTimeout(() => {
        openSettings();
        toast('기준 주와 내 조만 정하면 끝나요');
      }, 350);
    }

    window.addEventListener('hashchange', () => {
      const h = readHash();
      if (h) { shared = h; renderAll(); }
    });

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 캐시는 없어도 동작 */ });
      });
    }
  }

  boot();

  // 바깥에서 확인할 수 있게 (배포 검증용, UI에는 영향 없음)
  window.__shift4 = { state: () => state, shared: () => shared, effective, buildIcs, leaveStats, shareUrl };
})();
