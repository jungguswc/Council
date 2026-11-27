// 자동 생성: Logic.gs 와 같은 내용
/**
 * 위원 명단 관리 - 공통 로직 (서버 Apps Script와 화면 미리보기가 함께 사용)
 * 데이터는 표 4개: 위원(members), 위촉(appts), 변동이력(history), 조직(orgs)
 * 날짜는 모두 'YYYY-MM-DD' 문자열로 다룬다.
 */
var ORG_TYPES = ['대표협의체', '실무협의체', '실무분과', '전문위원회', '동협의체'];
/** 임기가 정해져 있지 않은 협의체 (임기 없이 참여 시작일만 관리, 임기만료 알림 제외) */
var NO_TERM_ORGS = ['실무분과'];
var KINDS = ['당연직', '임명직', '위촉직'];
var ROLES = ['위원장', '공동위원장', '부위원장', '분과장', '간사', '총무', '위원'];
var CHANGE_TYPES = ['위촉', '해촉', '사임', '연임', '직책변경', '소속변경', '정보수정', '위촉정정', '일괄등록', '표창등록', '표창취소', '계좌변경', '확인서발급', '표창수정', '표창삭제'];

var TABLES = {
  members: ['id', 'name', 'agency', 'position', 'mobile', 'office', 'fax', 'email', 'address', 'memo', 'createdAt', 'updatedAt'],
  appts: ['id', 'memberId', 'orgType', 'orgName', 'kind', 'role', 'termStart', 'termEnd', 'from', 'endDate', 'endReason', 'order', 'createdAt'],
  history: ['id', 'at', 'date', 'memberId', 'apptId', 'type', 'reason', 'basis', 'before', 'after', 'user'],
  orgs: ['id', 'orgType', 'name', 'order', 'active'],
  awards: ['id', 'memberId', 'year', 'date', 'awardType', 'title', 'orgAtTime', 'memo', 'canceled', 'createdAt', 'awardName', 'event', 'personName', 'personAgency', 'personPosition'],
  awardTypes: ['id', 'name', 'order'],
  accounts: ['memberId', 'bank', 'number', 'holder', 'updatedAt'],
  certs: ['id', 'no', 'year', 'seq', 'memberId', 'apptId', 'issueDate', 'purpose', 'detail', 'user', 'createdAt']
};
/** 관리자만 보는 표: 결재권자와 공유하지 않는 별도 시트에 저장 */
var SECRET_TABLES = ['accounts'];
var TABLE_LABELS = { members: '위원', appts: '위촉', history: '변동이력', orgs: '조직', awards: '표창', awardTypes: '표창종류', accounts: '수당계좌', certs: '확인서발급대장' };
var DEFAULT_AWARD_TYPES = ['보건복지부장관상', '대구광역시장상', '중구청장상']; // 훈격
var AWARD_NAMES = ['지역복지유공표창']; // 표창명 기본값(직접 입력 가능)
var AWARD_EVENTS = ['중구복지박람회', '성과보고회']; // 수여 행사 기본값(직접 입력 가능)
var FIELD_LABELS = {
  name: '성명', agency: '소속기관', position: '직위', mobile: '휴대폰', office: '사무실', fax: '팩스',
  email: '이메일', address: '주소', memo: '메모', orgType: '협의체구분', orgName: '협의체/분과', kind: '위촉구분', role: '직책',
  termStart: '임기시작', termEnd: '임기종료', order: '순서'
};

var DEFAULT_ORGS = [
  ['대표협의체', '대표협의체'], ['실무협의체', '실무협의체'],
  ['실무분과', '일자리분과'], ['실무분과', '노인분과'], ['실무분과', '복지기획분과'], ['실무분과', '아동청소년분과'],
  ['실무분과', '여성·가족분과'], ['실무분과', '장애인분과'], ['실무분과', '복지마을분과'],
  ['실무분과', '사회적고립예방분과'], ['실무분과', '자살예방분과'],
  ['전문위원회', '전문위원회'],
  ['동협의체', '동인동'], ['동협의체', '삼덕동'], ['동협의체', '성내1동'], ['동협의체', '성내2동'],
  ['동협의체', '성내3동'], ['동협의체', '대신동'], ['동협의체', '남산1동'], ['동협의체', '남산2동'],
  ['동협의체', '남산3동'], ['동협의체', '남산4동'], ['동협의체', '대봉1동'], ['동협의체', '대봉2동']
];

// ---------- 날짜·도움 함수 ----------
function L_pad(n) { return (n < 10 ? '0' : '') + n; }
function L_addDays(ymd, days) {
  var p = ymd.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + days));
  return d.getUTCFullYear() + '-' + L_pad(d.getUTCMonth() + 1) + '-' + L_pad(d.getUTCDate());
}
function L_isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function L_normDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return v.getFullYear() + '-' + L_pad(v.getMonth() + 1) + '-' + L_pad(v.getDate());
  }
  var s = String(v).trim().replace(/[.\/년월]\s*/g, '-').replace(/일/g, '').replace(/-+$/, '');
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return m[1] + '-' + L_pad(+m[2]) + '-' + L_pad(+m[3]);
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  if (/^\d{5}$/.test(s)) { // 엑셀 날짜 일련번호
    return L_addDays('1899-12-30', +s);
  }
  return '';
}
function L_nextId(list, prefix) {
  var max = 0;
  list.forEach(function (r) { var n = parseInt(String(r.id).replace(/\D/g, ''), 10); if (n > max) max = n; });
  return prefix + (max + 1);
}
function L_find(list, id) { for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i]; return null; }
function L_clone(o) { return JSON.parse(JSON.stringify(o)); }
function L_trim(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function L_fail(msg) { throw new Error(msg); }

function L_emptyDb() {
  var db = { members: [], appts: [], history: [], orgs: [], awards: [], awardTypes: [], accounts: [], certs: [] };
  DEFAULT_AWARD_TYPES.forEach(function (n, i) { db.awardTypes.push({ id: 'T' + (i + 1), name: n, order: String(i + 1) }); });
  DEFAULT_ORGS.forEach(function (o, i) { db.orgs.push({ id: 'O' + (i + 1), orgType: o[0], name: o[1], order: String(i + 1), active: 'Y' }); });
  return db;
}

// ---------- 상태 계산 ----------
/** 기준일에 이 위촉 기록이 유효한가 */
function L_activeOn(a, date) {
  if (!a.from || a.from > date) return false;
  if (a.endDate && date > a.endDate) return false;
  if (a.termEnd && date > a.termEnd) return false;
  return true;
}
/** 기준일 기준 상태: 재직 / 해촉 / 사임 / 임기만료 / 위촉예정 / (연임·직책변경·소속변경으로) 종료 */
function L_status(a, date) {
  if (a.from && date < a.from) return '위촉예정';
  if (a.endDate && date > a.endDate) return a.endReason || '종료';
  if (a.termEnd && date > a.termEnd) return '임기만료';
  return '재직';
}
/** 직책 목록: 기본 직책 + 등록된 직책(예: 복지기획분과장) */
function L_roles(db) { var r = ROLES.slice(); db.appts.forEach(function (a) { if (a.role && r.indexOf(a.role) < 0) r.push(a.role); }); return r; }
var ROLE_RANK = { '위원장': 0, '공동위원장': 0, '부위원장': 1, '분과장': 1, '간사': 2, '총무': 2, '위원': 3 };

/** 협의체/분과의 기준일 명단 */
function L_roster(db, orgType, orgName, date) {
  var rows = db.appts.filter(function (a) {
    return a.orgType === orgType && (!orgName || a.orgName === orgName) && L_activeOn(a, date);
  });
  rows.sort(function (x, y) {
    var ox = parseFloat(x.order) || 9999, oy = parseFloat(y.order) || 9999;
    if (ox !== oy) return ox - oy;
    var rx = ROLE_RANK[x.role] === undefined ? 3 : ROLE_RANK[x.role];
    var ry = ROLE_RANK[y.role] === undefined ? 3 : ROLE_RANK[y.role];
    if (rx !== ry) return rx - ry;
    var mx = L_find(db.members, x.memberId) || {}, my = L_find(db.members, y.memberId) || {};
    return String(mx.name).localeCompare(String(my.name), 'ko');
  });
  return rows.map(function (a) { return { appt: a, member: L_find(db.members, a.memberId) || {} }; });
}

/** 임기만료 예정(기준일부터 days일 안) */
function L_expiring(db, date, days) {
  var until = L_addDays(date, days);
  return db.appts.filter(function (a) {
    return L_activeOn(a, date) && a.termEnd && a.termEnd >= date && a.termEnd <= until && !a.endDate;
  }).sort(function (x, y) { return x.termEnd < y.termEnd ? -1 : 1; })
    .map(function (a) { return { appt: a, member: L_find(db.members, a.memberId) || {} }; });
}

/** 출력용 표 데이터(한글 양식과 같은 6칸) */
function L_printSections(db, orgType, orgName, date, opt) {
  opt = opt || {};
  var council = opt.councilName || '중구지역사회보장협의체';
  var names = orgName ? [orgName] : db.orgs.filter(function (o) { return o.orgType === orgType && o.active !== 'N'; })
    .sort(function (a, b) { return (+a.order) - (+b.order); }).map(function (o) { return o.name; });
  var sections = [];
  names.forEach(function (n) {
    var list = L_roster(db, orgType, n, date);
    if (!list.length && !orgName) return;
    var title, sub, wide = (orgType === '대표협의체' || orgType === '실무협의체');
    if (orgType === '실무분과') { title = council + ' 실무분과'; sub = n; }
    else if (orgType === '동협의체') { title = n + ' 지역사회보장협의체'; sub = '위원 명단'; }
    else if (wide) { title = council.replace('협의체', '') + ' ' + n; sub = ''; }
    else { title = council + ' ' + n; sub = '위원 명단'; }
    var rows = list.map(function (r, i) {
      var m = r.member, a = r.appt;
      if (wide) {
        var note7 = a.role && a.role !== '위원' ? a.role : (opt.showKind === false ? '' : a.kind);
        var aff = [m.agency, m.position].filter(function (x) { return x; }).join(' ');
        return [String(i + 1), aff, m.name || '', opt.hideContact ? '' : (m.address || ''), opt.hideContact ? '' : (m.mobile || m.office || ''), opt.hideContact ? '' : (m.email || ''), note7 || ''];
      }
      var contact = [m.mobile, m.office, m.fax ? '(F.' + m.fax + ')' : ''].filter(function (x) { return x; }).join('\n');
      var note = a.role && a.role !== '위원' ? a.role : '';
      if (opt.showKind && a.kind) note = note ? note + '\n' + a.kind : a.kind;
      return [String(i + 1), m.agency || '', m.position || '', m.name || '', opt.hideContact ? '' : contact, note];
    });
    sections.push({ title: title, subtitle: sub, orgName: n, rows: rows });
  });
  if (orgType === '대표협의체' || orgType === '실무협의체') {
    return { baseDate: date, header: ['연번', '직 위\n(소속)', '성  명', '주  소\n(소재지)', '연락처', 'E-mail', '비 고'], widths: [40, 220, 70, 190, 110, 170, 80], sections: sections };
  }
  return { baseDate: date, header: ['연번', '소  속', '직  위', '성  명', opt.hideContact ? '연락처' : '연락처\n(FAX)', '비  고'], widths: [45, 190, 110, 80, 150, 80], sections: sections };
}

// ---------- 변경 작업 ----------
function L_log(db, ctx, h) {
  h.id = L_nextId(db.history, 'H');
  h.at = ctx.now; h.user = ctx.user || '';
  ['date', 'memberId', 'apptId', 'type', 'reason', 'basis', 'before', 'after'].forEach(function (k) { if (h[k] === undefined) h[k] = ''; });
  db.history.push(h);
  return h;
}
function L_describeAppt(a) {
  var term = (a.termStart || a.termEnd) ? '임기 ' + (a.termStart || '?') + '~' + (a.termEnd || '?') : '임기 없음(참여 ' + a.from + '~)';
  return [a.orgType, a.orgName, a.role, a.kind, term].join(' / ');
}
function L_checkOrg(db, orgType, orgName) {
  if (ORG_TYPES.indexOf(orgType) < 0) L_fail('협의체 구분이 올바르지 않습니다: ' + orgType);
  if (!orgName) L_fail('협의체/분과를 선택해 주세요.');
  var ok = db.orgs.some(function (o) { return o.orgType === orgType && o.name === orgName; });
  if (!ok) L_fail('등록되지 않은 협의체/분과입니다: ' + orgName + ' (설정에서 먼저 추가해 주세요)');
}
function L_newAppt(db, ctx, f) {
  L_checkOrg(db, f.orgType, f.orgName);
  var termStart = L_normDate(f.termStart);
  var noTerm = NO_TERM_ORGS.indexOf(f.orgType) >= 0;
  if (!termStart && !noTerm) L_fail('임기 시작일을 입력해 주세요.');
  var termEnd = L_normDate(f.termEnd);
  if (termEnd && termStart && termEnd < termStart) L_fail('임기 종료일이 시작일보다 빠릅니다.');
  var from = L_normDate(f.from) || termStart || ctx.today;
  var order = f.order;
  if (!order) {
    var max = 0;
    db.appts.forEach(function (a) { if (a.orgType === f.orgType && a.orgName === f.orgName) max = Math.max(max, parseFloat(a.order) || 0); });
    order = String(max + 1);
  }
  var a = {
    id: L_nextId(db.appts, 'A'), memberId: f.memberId, orgType: f.orgType, orgName: f.orgName,
    kind: f.kind || '위촉직', role: f.role || '위원', termStart: termStart, termEnd: termEnd,
    from: from, endDate: '', endReason: '', order: String(order), createdAt: ctx.now
  };
  db.appts.push(a);
  return a;
}
function L_requireActive(db, apptId) {
  var a = L_find(db.appts, apptId);
  if (!a) L_fail('위촉 기록을 찾을 수 없습니다.');
  if (a.endDate) L_fail('이미 종료된 위촉 기록입니다(' + a.endReason + ' ' + a.endDate + ').');
  return a;
}
function L_memberFields(f) {
  var m = {};
  ['name', 'agency', 'position', 'mobile', 'office', 'fax', 'email', 'address', 'memo'].forEach(function (k) { m[k] = L_trim(f[k]); });
  return m;
}

var L_OPS = {
  /** 위촉: 새 위원 또는 기존 위원을 협의체에 위촉 */
  appoint: function (db, ctx, x) {
    var m;
    if (x.memberId) {
      m = L_find(db.members, x.memberId); if (!m) L_fail('위원을 찾을 수 없습니다.');
    } else {
      var f = L_memberFields(x);
      if (!f.name) L_fail('성명을 입력해 주세요.');
      m = f; m.id = L_nextId(db.members, 'M'); m.createdAt = ctx.now; m.updatedAt = ctx.now;
      db.members.push(m);
    }
    var a = L_newAppt(db, ctx, { memberId: m.id, orgType: x.orgType, orgName: x.orgName, kind: x.kind, role: x.role, termStart: x.termStart, termEnd: x.termEnd, from: x.from, order: x.order });
    L_log(db, ctx, { date: a.from, memberId: m.id, apptId: a.id, type: '위촉', reason: x.reason, basis: x.basis, after: L_describeAppt(a) });
    return { msg: m.name + ' 위원을 ' + a.orgName + '에 위촉했습니다.', changed: ['members', 'appts', 'history'] };
  },
  /** 위원 인적사항 수정 (이전 값은 변동이력에 남김) */
  updateMember: function (db, ctx, x) {
    var m = L_find(db.members, x.memberId); if (!m) L_fail('위원을 찾을 수 없습니다.');
    var f = L_memberFields(x), before = [], after = [];
    if (!f.name) L_fail('성명을 입력해 주세요.');
    Object.keys(f).forEach(function (k) {
      if (L_trim(m[k]) !== f[k]) { before.push(FIELD_LABELS[k] + ': ' + (m[k] || '(없음)')); after.push(FIELD_LABELS[k] + ': ' + (f[k] || '(없음)')); m[k] = f[k]; }
    });
    if (!before.length) L_fail('바뀐 내용이 없습니다.');
    m.updatedAt = ctx.now;
    L_log(db, ctx, { date: ctx.today, memberId: m.id, type: '정보수정', reason: x.reason, basis: x.basis, before: before.join('\n'), after: after.join('\n') });
    return { msg: m.name + ' 위원 정보를 수정했습니다.', changed: ['members', 'history'] };
  },
  /** 해촉 또는 사임 */
  endAppt: function (db, ctx, x) {
    var a = L_requireActive(db, x.apptId);
    if (x.type !== '해촉' && x.type !== '사임') L_fail('해촉 또는 사임을 선택해 주세요.');
    var d = L_normDate(x.date); if (!d) L_fail(x.type + ' 일자를 입력해 주세요.');
    if (d < a.from) L_fail(x.type + ' 일자가 위촉일보다 빠릅니다.');
    var before = L_describeAppt(a);
    a.endDate = d; a.endReason = x.type;
    L_log(db, ctx, { date: d, memberId: a.memberId, apptId: a.id, type: x.type, reason: x.reason, basis: x.basis, before: before, after: x.type + ' (' + d + ')' });
    var m = L_find(db.members, a.memberId) || {};
    return { msg: m.name + ' 위원 ' + x.type + ' 처리했습니다.', changed: ['appts', 'history'] };
  },
  /** 연임: 기존 위촉을 끝내고 새 임기로 새 기록을 만든다 */
  renew: function (db, ctx, x) {
    var a = L_requireActive(db, x.apptId);
    var s = L_normDate(x.termStart), e = L_normDate(x.termEnd);
    if (!s) L_fail('새 임기 시작일을 입력해 주세요.');
    if (s <= a.from) L_fail('새 임기 시작일은 현재 위촉일 이후여야 합니다.');
    a.endDate = L_addDays(s, -1); a.endReason = '연임';
    var n = L_newAppt(db, ctx, { memberId: a.memberId, orgType: a.orgType, orgName: a.orgName, kind: a.kind, role: x.role || a.role, termStart: s, termEnd: e, order: a.order });
    L_log(db, ctx, { date: s, memberId: a.memberId, apptId: n.id, type: '연임', reason: x.reason, basis: x.basis, before: L_describeAppt(a), after: L_describeAppt(n) });
    return { msg: '연임 처리했습니다.', changed: ['appts', 'history'] };
  },
  /** 직책 변경: 기존 기록은 변경 전날로 닫고 새 기록 생성 (임기는 그대로) */
  changeRole: function (db, ctx, x) {
    var a = L_requireActive(db, x.apptId);
    var d = L_normDate(x.date); if (!d) L_fail('변경 일자를 입력해 주세요.');
    if (!x.role || x.role === a.role) L_fail('새 직책을 선택해 주세요.');
    if (d <= a.from) L_fail('변경 일자는 현재 기록의 시작일 이후여야 합니다.');
    a.endDate = L_addDays(d, -1); a.endReason = '직책변경';
    var n = L_newAppt(db, ctx, { memberId: a.memberId, orgType: a.orgType, orgName: a.orgName, kind: a.kind, role: x.role, termStart: a.termStart, termEnd: a.termEnd, from: d, order: a.order });
    L_log(db, ctx, { date: d, memberId: a.memberId, apptId: n.id, type: '직책변경', reason: x.reason, basis: x.basis, before: a.role, after: x.role });
    return { msg: '직책을 ' + x.role + '(으)로 변경했습니다.', changed: ['appts', 'history'] };
  },
  /** 소속 협의체·분과 변경 */
  changeOrg: function (db, ctx, x) {
    var a = L_requireActive(db, x.apptId);
    var d = L_normDate(x.date); if (!d) L_fail('변경 일자를 입력해 주세요.');
    if (d <= a.from) L_fail('변경 일자는 현재 기록의 시작일 이후여야 합니다.');
    if (x.orgType === a.orgType && x.orgName === a.orgName) L_fail('현재와 같은 소속입니다.');
    L_checkOrg(db, x.orgType, x.orgName);
    a.endDate = L_addDays(d, -1); a.endReason = '소속변경';
    var n = L_newAppt(db, ctx, { memberId: a.memberId, orgType: x.orgType, orgName: x.orgName, kind: a.kind, role: x.role || '위원', termStart: a.termStart, termEnd: a.termEnd, from: d });
    L_log(db, ctx, { date: d, memberId: a.memberId, apptId: n.id, type: '소속변경', reason: x.reason, basis: x.basis, before: a.orgType + ' ' + a.orgName, after: n.orgType + ' ' + n.orgName });
    return { msg: '소속을 ' + n.orgName + '(으)로 변경했습니다.', changed: ['appts', 'history'] };
  },
  /** 입력 실수 정정 (위촉구분·임기·순서). 정정 전 값은 이력에 남김 */
  fixAppt: function (db, ctx, x) {
    var a = L_find(db.appts, x.apptId); if (!a) L_fail('위촉 기록을 찾을 수 없습니다.');
    var before = [], after = [];
    ['kind', 'termStart', 'termEnd', 'order'].forEach(function (k) {
      if (x[k] === undefined) return;
      var v = (k === 'termStart' || k === 'termEnd') ? L_normDate(x[k]) : L_trim(x[k]);
      if (v !== L_trim(a[k])) { before.push(FIELD_LABELS[k] + ': ' + (a[k] || '(없음)')); after.push(FIELD_LABELS[k] + ': ' + (v || '(없음)')); a[k] = v; }
    });
    if (!before.length) L_fail('바뀐 내용이 없습니다.');
    if (a.termEnd && a.termStart && a.termEnd < a.termStart) L_fail('임기 종료일이 시작일보다 빠릅니다.');
    if (a.from < a.termStart && !L_hasPrev(db, a)) a.from = a.termStart;
    L_log(db, ctx, { date: ctx.today, memberId: a.memberId, apptId: a.id, type: '위촉정정', reason: x.reason, basis: x.basis, before: before.join('\n'), after: after.join('\n') });
    return { msg: '위촉 내용을 정정했습니다.', changed: ['appts', 'history'] };
  },
  /** 엑셀 일괄 등록 */
  bulkImport: function (db, ctx, x) {
    var rows = x.rows || [], added = 0, reused = 0, errors = [];
    rows.forEach(function (r, i) {
      try {
        var f = L_memberFields(r);
        if (!f.name) L_fail('성명이 비어 있습니다.');
        var m = null;
        db.members.forEach(function (c) { if (!m && c.name === f.name && ((f.mobile && c.mobile === f.mobile) || (!f.mobile && c.agency === f.agency))) m = c; });
        if (m) reused++; else { m = f; m.id = L_nextId(db.members, 'M'); m.createdAt = ctx.now; m.updatedAt = ctx.now; db.members.push(m); }
        if (L_trim(r.bank) || L_trim(r.number)) L_setAccount(db, ctx, m.id, r);
        var a = L_newAppt(db, ctx, { memberId: m.id, orgType: L_trim(r.orgType), orgName: L_trim(r.orgName), kind: L_trim(r.kind) || '위촉직', role: L_trim(r.role) || '위원', termStart: r.termStart, termEnd: r.termEnd, from: r.from, order: L_trim(r.order) });
        L_log(db, ctx, { date: a.from, memberId: m.id, apptId: a.id, type: '일괄등록', reason: x.reason || '기존 명단 일괄 등록', basis: x.basis || '', after: L_describeAppt(a) });
        added++;
      } catch (e) { errors.push((i + 1) + '번째 줄: ' + e.message); }
    });
    if (!added) L_fail('등록된 위원이 없습니다.\n' + errors.join('\n'));
    return { changed: ['members', 'appts', 'history', 'accounts'], msg: added + '건 등록했습니다' + (reused ? ' (기존 위원과 연결 ' + reused + '건)' : '') + (errors.length ? '.\n등록하지 못한 줄 ' + errors.length + '건:\n' + errors.join('\n') : '.') };
  },
  /** 유공표창 등록 */
  addAward: function (db, ctx, x) {
    var w = L_newAward(db, ctx, x);
    var p = L_awardPerson(db, w);
    L_log(db, ctx, { date: w.date || (w.year + '-01-01'), memberId: w.memberId, type: '표창등록', reason: x.reason, basis: x.basis, after: L_awardText(w) + (w.memberId ? '' : ' / ' + p.name + '(위원 아님)') });
    return { msg: p.name + ' ' + w.year + '년 ' + (w.awardName || w.awardType) + ' 이력을 등록했습니다.', changed: ['awards', 'history'] };
  },
  /** 표창 일괄 등록: 위원 명단에 있는 사람(성명 일치, 동명이인이면 소속까지)은 위원과 연결, 없으면 비위원으로 기록 */
  bulkAwards: function (db, ctx, x) {
    var rows = x.rows || [], added = 0, linked = 0, errors = [];
    rows.forEach(function (r, i) {
      try {
        var nm = L_trim(r.personName).replace(/\s/g, '');
        if (!nm) L_fail('성명이 비어 있습니다.');
        var cand = db.members.filter(function (m) { return String(m.name).replace(/\s/g, '') === nm; });
        if (cand.length > 1 && r.personAgency) cand = cand.filter(function (m) { return String(m.agency).indexOf(L_trim(r.personAgency)) >= 0 || L_trim(r.personAgency).indexOf(m.agency) >= 0; });
        var y = {}; for (var k in r) y[k] = r[k];
        y.memberId = cand.length === 1 ? cand[0].id : '';
        if (y.memberId) linked++;
        var w = L_newAward(db, ctx, y);
        L_log(db, ctx, { date: w.date || (w.year + '-01-01'), memberId: w.memberId, type: '표창등록', reason: x.reason || '표창 명단 일괄 등록', basis: x.basis || '', after: L_awardText(w) + (w.memberId ? '' : ' / ' + w.personName + '(위원 아님)') });
        added++;
      } catch (e) { errors.push((i + 1) + '번째 줄: ' + e.message); }
    });
    if (!added) L_fail('등록된 표창이 없습니다.\n' + errors.join('\n'));
    return { msg: added + '건 등록했습니다 (위원과 연결 ' + linked + '건, 위원 아닌 수상자 ' + (added - linked) + '건)' + (errors.length ? '.\n등록하지 못한 줄:\n' + errors.join('\n') : '.'), changed: ['awards', 'history'] };
  },
  /** 회의수당 입금 계좌 등록·변경. 이력에는 계좌번호를 남기지 않음(결재권자도 이력을 보므로) */
  setAccount: function (db, ctx, x) {
    var m = L_find(db.members, x.memberId); if (!m) L_fail('위원을 찾을 수 없습니다.');
    var had = db.accounts.some(function (c) { return c.memberId === m.id; });
    L_setAccount(db, ctx, m.id, x);
    L_log(db, ctx, { date: ctx.today, memberId: m.id, type: '계좌변경', reason: x.reason, basis: x.basis, after: had ? '수당 입금 계좌 변경' : '수당 입금 계좌 등록' });
    return { msg: m.name + ' 위원 계좌를 저장했습니다.', changed: ['accounts', 'history'] };
  },
  /** 표창 기록 취소(잘못 입력한 경우). 기록은 지우지 않고 취소 표시 */
  cancelAward: function (db, ctx, x) {
    var w = L_find(db.awards, x.id); if (!w) L_fail('표창 기록을 찾을 수 없습니다.');
    if (w.canceled) L_fail('이미 취소된 기록입니다.');
    w.canceled = ctx.today;
    L_log(db, ctx, { date: ctx.today, memberId: w.memberId, type: '표창취소', reason: x.reason, basis: x.basis, before: L_awardText(w) + (w.memberId ? '' : ' / ' + w.personName), after: '취소' });
    return { msg: '표창 기록을 취소 처리했습니다.', changed: ['awards', 'history'] };
  },
  /** 표창 종류 추가 */
  addAwardType: function (db, ctx, x) {
    var n = L_trim(x.name); if (!n) L_fail('표창 이름을 입력해 주세요.');
    if (db.awardTypes.some(function (t) { return t.name === n; })) L_fail('이미 있는 표창입니다.');
    db.awardTypes.push({ id: L_nextId(db.awardTypes, 'T'), name: n, order: String(db.awardTypes.length + 1) });
    return { msg: n + '을(를) 표창 종류에 추가했습니다.', changed: ['awardTypes'] };
  },
  /** 위원 활동 확인서 발급: 발급번호(연도별 일련번호)를 매기고 발급대장에 남긴다. 생년월일은 저장하지 않는다. */
  issueCert: function (db, ctx, x) {
    if (!db.certs) db.certs = [];
    var m = L_find(db.members, x.memberId); if (!m) L_fail('위원을 찾을 수 없습니다.');
    var d = L_trim(x.issueDate) || ctx.today, y = d.slice(0, 4), seq;
    var used = db.certs.filter(function (c) { return c.year === y; }).map(function (c) { return parseInt(c.seq, 10) || 0; });
    if (L_trim(x.seq)) {
      seq = parseInt(x.seq, 10); if (!(seq > 0)) L_fail('발급번호 숫자를 확인해 주세요.');
      if (used.indexOf(seq) >= 0) L_fail(y + '년 ' + seq + '번은 이미 발급된 번호입니다.');
    } else seq = used.reduce(function (a, b) { return Math.max(a, b); }, 0) + 1;
    var no = '중구협의체 제' + y + '-' + ('00' + seq).slice(-3) + '호';
    var detail = x.detail || {}; delete detail.birth;
    var c = { id: L_nextId(db.certs, 'C'), no: no, year: y, seq: String(seq), memberId: m.id, apptId: L_trim(x.apptId), issueDate: d, purpose: L_trim(x.purpose), detail: JSON.stringify(detail), user: ctx.user, createdAt: ctx.now };
    db.certs.push(c);
    L_log(db, ctx, { date: d, memberId: m.id, apptId: c.apptId, type: '확인서발급', reason: c.purpose, after: no });
    return { msg: no + ' 위원 활동 확인서를 발급했습니다.', changed: ['certs', 'history'] };
  },
  /** 중복 정리 (일괄 등록을 여러 번 올린 경우) */
  dedupe: function (db, ctx, x) {
    var d = L_findDups(db), c = d.counts;
    if (!c.appts && !c.awards && !c.history) L_fail('정리할 중복이 없습니다.');
    db.appts = db.appts.filter(function (a) { return !d.appts[a.id]; });
    db.awards = db.awards.filter(function (w) { return !d.awards[w.id]; });
    db.history = db.history.filter(function (h) { return !d.history[h.id]; });
    return { msg: '중복을 정리했습니다. 위촉 ' + c.appts + '건, 표창 ' + c.awards + '건, 이력 ' + c.history + '건을 지웠습니다.', changed: ['appts', 'awards', 'history'] };
  },
  /** 표창 기록 수정 */
  editAward: function (db, ctx, x) {
    var w = L_find(db.awards, x.id); if (!w) L_fail('표창 기록을 찾을 수 없습니다.');
    var before = L_awardText(w), y = L_trim(x.year).replace(/\D/g, ''), t = L_trim(x.awardType);
    if (!/^\d{4}$/.test(y)) L_fail('수상 연도를 입력해 주세요(예: 2026).');
    if (!t) L_fail('훈격을 입력해 주세요.');
    if (!w.memberId && !L_trim(x.personName)) L_fail('수상자 성명을 입력해 주세요.');
    if (!db.awardTypes.some(function (a) { return a.name === t; })) db.awardTypes.push({ id: L_nextId(db.awardTypes, 'T'), name: t, order: String(db.awardTypes.length + 1) });
    w.year = y; w.date = L_normDate(x.date) || ''; w.event = L_trim(x.event); w.awardName = L_trim(x.awardName); w.awardType = t; w.title = L_trim(x.title); w.memo = L_trim(x.memo);
    if (!w.memberId) { w.personName = L_trim(x.personName).replace(/\s+/g, ''); w.personAgency = L_trim(x.personAgency); w.personPosition = L_trim(x.personPosition); }
    var p = L_awardPerson(db, w);
    L_log(db, ctx, { date: ctx.today, memberId: w.memberId, type: '표창수정', reason: x.reason, before: before, after: L_awardText(w) + (w.memberId ? '' : ' / ' + p.name) });
    return { msg: p.name + ' 표창 기록을 고쳤습니다.', changed: ['awards', 'history', 'awardTypes'] };
  },
  /** 잘못 넣은 표창 기록 여러 건 삭제 */
  deleteAwards: function (db, ctx, x) {
    var ids = x.ids || [], n = 0;
    ids.forEach(function (id) { var w = L_find(db.awards, id); if (!w) return; var p = L_awardPerson(db, w);
      db.awards = db.awards.filter(function (a) { return a.id !== id; }); n++;
      L_log(db, ctx, { date: ctx.today, memberId: w.memberId, type: '표창삭제', reason: x.reason || '잘못 입력', before: L_awardText(w) + (w.memberId ? '' : ' / ' + p.name) }); });
    if (!n) L_fail('지울 표창 기록이 없습니다.');
    return { msg: '표창 기록 ' + n + '건을 지웠습니다.', changed: ['awards', 'history'] };
  },
  /** 잘못 넣은 표창 기록 삭제 */
  deleteAward: function (db, ctx, x) {
    var w = L_find(db.awards, x.id); if (!w) L_fail('표창 기록을 찾을 수 없습니다.');
    var p = L_awardPerson(db, w);
    db.awards = db.awards.filter(function (a) { return a.id !== w.id; });
    L_log(db, ctx, { date: ctx.today, memberId: w.memberId, type: '표창삭제', reason: x.reason || '잘못 입력', before: L_awardText(w) + (w.memberId ? '' : ' / ' + p.name) });
    return { msg: p.name + ' ' + w.year + '년 표창 기록을 지웠습니다.', changed: ['awards', 'history'] };
  },
  /** 협의체·분과·동 추가 */
  addOrg: function (db, ctx, x) {
    var t = L_trim(x.orgType), n = L_trim(x.name);
    if (ORG_TYPES.indexOf(t) < 0) L_fail('협의체 구분을 선택해 주세요.');
    if (!n) L_fail('이름을 입력해 주세요.');
    if (db.orgs.some(function (o) { return o.orgType === t && o.name === n; })) L_fail('이미 있는 이름입니다.');
    var max = 0; db.orgs.forEach(function (o) { max = Math.max(max, +o.order || 0); });
    db.orgs.push({ id: L_nextId(db.orgs, 'O'), orgType: t, name: n, order: String(max + 1), active: 'Y' });
    return { msg: n + '을(를) 추가했습니다.', changed: ['orgs'] };
  },
  /** 조직 사용/숨김 */
  toggleOrg: function (db, ctx, x) {
    var o = L_find(db.orgs, x.id); if (!o) L_fail('조직을 찾을 수 없습니다.');
    o.active = o.active === 'N' ? 'Y' : 'N';
    return { msg: o.name + (o.active === 'Y' ? ' 사용' : ' 숨김') + ' 처리했습니다.', changed: ['orgs'] };
  }
};
function L_newAward(db, ctx, x) {
  var m = x.memberId ? L_find(db.members, x.memberId) : null;
  if (x.memberId && !m) L_fail('위원을 찾을 수 없습니다.');
  if (!m && !L_trim(x.personName)) L_fail('수상자 성명을 입력해 주세요.');
  var t = L_trim(x.awardType); if (!t) L_fail('훈격(예: 중구청장상)을 입력해 주세요.');
  var d = L_normDate(x.date), y = L_trim(x.year).replace(/\D/g, '') || (d ? d.slice(0, 4) : '');
  if (!/^\d{4}$/.test(y)) L_fail('수상 연도를 입력해 주세요(예: 2026).');
  if (!db.awardTypes.some(function (a) { return a.name === t; })) db.awardTypes.push({ id: L_nextId(db.awardTypes, 'T'), name: t, order: String(db.awardTypes.length + 1) });
  var cur = m ? db.appts.filter(function (a) { return a.memberId === m.id && L_activeOn(a, d || (y + '-12-31')); }).map(function (a) { return a.orgName; }).join(', ') : '';
  var w = { id: L_nextId(db.awards, 'W'), memberId: m ? m.id : '', year: y, date: d, awardType: t, title: L_trim(x.title),
    orgAtTime: L_trim(x.orgAtTime) || cur, memo: L_trim(x.memo), canceled: '', createdAt: ctx.now,
    awardName: L_trim(x.awardName), event: L_trim(x.event),
    personName: m ? '' : L_trim(x.personName).replace(/\s+/g, ''), personAgency: m ? '' : L_trim(x.personAgency), personPosition: m ? '' : L_trim(x.personPosition) };
  db.awards.push(w);
  return w;
}
/** 일괄 등록을 여러 번 올려 생긴 중복 찾기: 같은 내용의 위촉·표창·이력 중 처음 것만 남긴다 */
function L_findDups(db) {
  function dupIds(list, keyFn, ok) {
    var seen = {}, out = {};
    list.forEach(function (x) { if (ok && !ok(x)) return; var k = keyFn(x); if (seen[k]) out[x.id] = seen[k]; else seen[k] = x.id; });
    return out;
  }
  var appts = dupIds(db.appts, function (a) { return [a.memberId, a.orgType, a.orgName, a.termStart, a.termEnd, a.from, a.endDate, a.role, a.kind].join('|'); });
  var awards = dupIds(db.awards, function (w) { return [w.memberId || ('p:' + String(w.personName).replace(/\s/g, '')), w.year, w.event, w.awardName, w.awardType].join('|'); }, function (w) { return !w.canceled; });
  var hist = {};
  db.history.forEach(function (h) { if (h.apptId && appts[h.apptId]) hist[h.id] = 1; });
  var hd = dupIds(db.history, function (h) { return [h.memberId, h.type, h.date, h.after, h.reason].join('|'); }, function (h) { return !hist[h.id] && (h.type === '일괄등록' || h.type === '표창등록'); });
  for (var k in hd) hist[k] = 1;
  return { appts: appts, awards: awards, history: hist, counts: { appts: Object.keys(appts).length, awards: Object.keys(awards).length, history: Object.keys(hist).length } };
}
/** 수상자 정보: 위원이면 위원 정보, 아니면 표창에 적힌 정보 */
function L_awardPerson(db, w) {
  var m = w.memberId ? L_find(db.members, w.memberId) : null;
  return m ? { name: m.name, agency: m.agency, position: m.position, isMember: true } : { name: w.personName || '', agency: w.personAgency || '', position: w.personPosition || '', isMember: false };
}
function L_awardText(w) {
  return w.year + '년 ' + [w.event, w.awardName, w.awardType].filter(function (x) { return x; }).join(' ') + (w.title ? ' (' + w.title + ')' : '');
}
function L_setAccount(db, ctx, mid, x) {
  var bank = L_trim(x.bank), num = L_trim(x.number).replace(/\s/g, ''), holder = L_trim(x.holder);
  if (!bank || !num) L_fail('은행과 계좌번호를 입력해 주세요.');
  if (!/^[0-9-]+$/.test(num)) L_fail('계좌번호는 숫자와 - 만 입력해 주세요.');
  var c = null; db.accounts.forEach(function (a) { if (a.memberId === mid) c = a; });
  if (!c) { c = { memberId: mid }; db.accounts.push(c); }
  c.bank = bank; c.number = num; c.holder = holder || (L_find(db.members, mid) || {}).name || ''; c.updatedAt = ctx.now;
}
function L_hasPrev(db, a) {
  return db.appts.some(function (b) { return b !== a && b.memberId === a.memberId && b.orgType === a.orgType && b.orgName === a.orgName && b.endDate && b.endDate < a.from; });
}

/** 작업 실행. ctx = { now:'YYYY-MM-DD HH:mm:ss', today:'YYYY-MM-DD', user:'이메일' } */
function L_apply(db, op, args, ctx) {
  if (!L_OPS[op]) L_fail('알 수 없는 작업입니다: ' + op);
  return L_OPS[op](db, ctx, args || {});
}

// ---------- 가상 예시 데이터 (개발·시연용, 실제 인물 아님) ----------
function L_sampleDb(today) {
  var db = L_emptyDb();
  var fam = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
  var given = ['가온', '나래', '다솜', '라온', '미르', '보람', '새봄', '아름', '여울', '온유', '이든', '지안', '하늘', '한별', '해솔', '도담', '시온', '예준', '서윤', '하람', '누리', '단비', '바다', '슬기'];
  var agencies = ['가상종합사회복지관', '예시노인복지센터', '샘플지역자활센터', '가상장애인복지관', '예시청소년수련관', '샘플정신건강복지센터',
    '가상재가복지센터', '예시아동센터', '샘플시니어클럽', '가상가족센터', '중구청 복지정책과', '중구청 생활지원과', '예시복지재단', '샘플건강센터'];
  var positions = ['관장', '센터장', '소장', '부장', '팀장', '과장', '사회복지사', '주무관', '사무국장', '실장'];
  var seq = 0;
  function rnd(n) { seq = (seq * 9301 + 49297) % 233280; return Math.floor(seq / 233280 * n); }
  function person() {
    return {
      name: fam[rnd(fam.length)] + given[rnd(given.length)], agency: agencies[rnd(agencies.length)], position: positions[rnd(positions.length)],
      mobile: '010-0000-' + L_pad(rnd(90) + 10) + L_pad(rnd(90) + 10), office: '000-' + (1000 + rnd(8999)), fax: '000-' + (1000 + rnd(8999))
    };
  }
  var ctx = { now: today + ' 09:00:00', today: today, user: '예시데이터' };
  var plan = [['대표협의체', '대표협의체', 12, '위원장'], ['실무협의체', '실무협의체', 14, '위원장'], ['전문위원회', '전문위원회', 6, '위원장']];
  db.orgs.forEach(function (o) {
    if (o.orgType === '실무분과') plan.push(['실무분과', o.name, 6 + rnd(6), '분과장']);
    if (o.orgType === '동협의체' && rnd(3) === 0) plan.push(['동협의체', o.name, 8 + rnd(5), '위원장']);
  });
  var rows = [];
  plan.forEach(function (p) {
    for (var i = 0; i < p[2]; i++) {
      var r = person();
      r.orgType = p[0]; r.orgName = p[1];
      r.role = i === 0 ? p[3] : (i === 2 && p[0] === '실무분과' ? '총무' : (i === 1 && p[0] !== '실무분과' ? '부위원장' : '위원'));
      r.kind = (r.agency.indexOf('중구청') === 0 || (i === 0 && p[0] === '대표협의체')) ? '당연직' : '위촉직';
      r.termStart = '2025-01-01'; r.termEnd = (i % 7 === 3) ? L_addDays(today, 20 + i) : '2027-12-31';
      if (p[0] === '동협의체') r.termEnd = '2027-06-30';
      if (p[0] === '실무분과') { r.from = r.termStart; r.termStart = ''; r.termEnd = ''; }
      r.order = String(i + 1);
      rows.push(r);
    }
  });
  L_OPS.bulkImport(db, ctx, { rows: rows, reason: '가상 예시 데이터', basis: '개발용' });
  // 변동 사례 몇 건
  var a1 = db.appts[20], a2 = db.appts[33], a3 = db.appts[40];
  ctx.now = '2026-03-15 10:00:00';
  L_OPS.endAppt(db, ctx, { apptId: a1.id, type: '사임', date: '2026-03-15', reason: '기관 퇴직', basis: '사임서 접수' });
  ctx.now = '2026-05-02 10:00:00';
  L_OPS.changeRole(db, ctx, { apptId: a2.id, role: '총무', date: '2026-05-02', reason: '분과 회의 결정', basis: '제2차 분과회의' });
  ctx.now = '2026-07-01 10:00:00';
  L_OPS.endAppt(db, ctx, { apptId: a3.id, type: '해촉', date: '2026-07-01', reason: '장기 불참', basis: '복지정책과-0000호' });
  var banks = ['가상은행', '예시은행', '샘플은행'];
  db.members.slice(0, 120).forEach(function (m, i) { db.accounts.push({ memberId: m.id, bank: banks[i % 3], number: '000-00-' + (100000 + i * 37), holder: m.name, updatedAt: '2026-01-05 09:00:00' }); });
  ctx.now = '2026-09-10 10:00:00';
  [[1, '2024', '중구청장상'], [5, '2025', '대구광역시장상'], [1, '2026', '보건복지부장관상'], [9, '2026', '중구청장상']].forEach(function (w) {
    L_OPS.addAward(db, ctx, { memberId: db.members[w[0]].id, year: w[1], date: w[1] + '-09-07', awardType: w[2], title: '사회복지의 날 유공' });
  });
  [['2025', '중구복지박람회', '가상수상자'], ['2025', '성과보고회', '예시수상자'], ['2026', '중구복지박람회', '샘플수상자']].forEach(function (w) {
    L_OPS.addAward(db, ctx, { personName: w[2], personAgency: '가상복지기관', year: w[0], event: w[1], awardName: '지역복지유공표창', awardType: '중구청장상', title: '지역복지 증진 유공' });
  });
  return db;
}
