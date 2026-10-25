/*
 * core.js — permission engine + mock backend for the training platform prototype.
 *
 * Runs in the browser (window.Core) and in Node (module.exports) so the same
 * rules are exercised by the automated tests in web/test/core.test.js.
 *
 * Every API function takes the acting user's id first and re-checks role,
 * Admin-granted permissions, scope and rank before touching data — the same
 * checks the production database enforces with row-level security and
 * SECURITY DEFINER functions (supabase/migrations). Hiding a button in the UI
 * is never the protection.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;

  /* ------------------------------------------------------------------ */
  /* Roles and permissions                                               */
  /* ------------------------------------------------------------------ */

  const ROLES = ['admin', 'it_manager', 'ops_manager', 'area_manager', 'staff'];
  const RANK = { admin: 100, it_manager: 90, ops_manager: 80, area_manager: 50, staff: 10 };
  const ROLE_LABEL = {
    admin: { en: 'Admin', ar: 'مسؤول النظام' },
    it_manager: { en: 'IT Manager', ar: 'مدير تقنية المعلومات' },
    ops_manager: { en: 'Operations Manager', ar: 'مدير العمليات' },
    area_manager: { en: 'Area Manager', ar: 'مدير المنطقة' },
    staff: { en: 'Staff', ar: 'موظف' }
  };

  // [key, group, English label, Arabic label, grantable to Area Managers]
  const PERMISSIONS = [
    ['users.view', 'people', 'View people records', 'عرض سجلات الموظفين', true],
    ['users.edit', 'people', 'Add and edit people', 'إضافة الموظفين وتعديل بياناتهم', true],
    ['users.deactivate', 'people', 'Deactivate or reactivate people', 'إيقاف الحسابات وإعادة تفعيلها', true],
    ['users.import', 'people', 'Import people from CSV', 'استيراد الموظفين من ملف CSV', true],
    ['users.remove', 'people', 'Remove people with no training history', 'حذف موظف ليس له سجل تدريبي', false],
    ['users.role', 'people', 'Change roles', 'تغيير الأدوار', false],
    ['access.grant', 'people', 'Grant Area Manager access', 'منح صلاحيات مديري المناطق', false],
    ['org.manage', 'people', 'Manage locations and teams', 'إدارة الفروع والفرق', false],
    ['content.edit', 'content', 'Create and edit courses and sections', 'إنشاء الدورات والأقسام وتعديلها', true],
    ['content.publish', 'content', 'Publish, archive and version courses', 'نشر الدورات وأرشفتها وإصدار نسخ جديدة', true],
    ['files.manage', 'content', 'Attach and arrange Drive files', 'إرفاق ملفات Drive وترتيبها', true],
    ['exams.manage', 'content', 'Create and edit quizzes and exams', 'إنشاء الاختبارات وتعديلها', true],
    ['issues.manage', 'content', 'Resolve problem reports', 'معالجة بلاغات المحتوى', true],
    ['content.delete', 'content', 'Delete courses nobody has started', 'حذف دورة لم يبدأها أحد', false],
    ['faq.manage', 'content', 'Edit help and FAQ', 'تحرير المساعدة والأسئلة الشائعة', false],
    ['assign.manage', 'training', 'Assign training', 'إسناد التدريب', true],
    ['progress.view', 'training', 'View progress and scores', 'عرض التقدم والدرجات', true],
    ['signoff.manage', 'training', 'Sign off practical skills', 'اعتماد المهارات العملية', true],
    ['records.correct', 'training', 'Correct training records', 'تصحيح السجلات التدريبية', true],
    ['reminders.manage', 'training', 'Manage reminders', 'إدارة التذكيرات', true],
    ['certs.view', 'certs', 'View certificates', 'عرض الشهادات', true],
    ['certs.reissue', 'certs', 'Reissue certificates', 'إعادة إصدار الشهادات', true],
    ['certs.revoke', 'certs', 'Revoke certificates', 'إلغاء الشهادات', true],
    ['reports.view', 'reports', 'View dashboard and reports', 'عرض لوحة المؤشرات والتقارير', true],
    ['reports.export', 'reports', 'Export reports', 'تصدير التقارير', true],
    ['settings.training', 'system', 'Training settings', 'إعدادات التدريب', false],
    ['settings.kpi', 'system', 'KPI thresholds', 'حدود مؤشرات الأداء', false],
    ['settings.system', 'system', 'System settings', 'إعدادات النظام', false],
    ['integrations.manage', 'system', 'Google Drive and email connections', 'ربط Google Drive والبريد', false],
    ['data.backup', 'system', 'Backups and full data export', 'النسخ الاحتياطي وتصدير البيانات', false],
    ['audit.view', 'system', 'Audit log', 'سجل التدقيق', false]
  ].map(([key, group, en, ar, grantable]) => ({ key, group, label: { en, ar }, grantable }));

  const ALL = PERMISSIONS.map(p => p.key);
  const GRANTABLE = PERMISSIONS.filter(p => p.grantable).map(p => p.key);
  const ROLE_PERMS = {
    admin: ALL,
    it_manager: ALL.filter(k => k !== 'access.grant'),
    ops_manager: ALL.filter(k => !['access.grant', 'settings.kpi', 'settings.system', 'integrations.manage', 'data.backup', 'audit.view'].includes(k)),
    area_manager: [], // comes entirely from Admin grants
    staff: []
  };

  class ApiError extends Error {
    constructor(code, message, detail) { super(message || code); this.code = code; this.detail = detail; }
  }
  // Error codes the UI translates: forbidden_role, forbidden_scope, forbidden_rank, not_found,
  // invalid, conflict, has_history, last_admin, locked, attempts_used, expired, drive_unavailable

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const iso = t => new Date(t).toISOString();
  const dateOnly = t => iso(t).slice(0, 10);
  const endOfDay = d => Date.parse(d + 'T23:59:59.999Z');
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const clean = s => (s == null ? '' : String(s).trim());

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function median(xs) {
    if (!xs.length) return null;
    const s = xs.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
  function humanDate(d, lang) {
    if (!d) return '';
    try { return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Riyadh' }).format(new Date(d.slice(0, 10) + 'T12:00:00Z')); } catch (e) { return d; }
  }

  /* ------------------------------------------------------------------ */
  /* Passwords (prototype only: salted SHA-256, 1,000 rounds.            */
  /* Production uses Supabase Auth, which stores bcrypt hashes.)         */
  /* ------------------------------------------------------------------ */

  const SHA_K = (() => {
    const k = []; let n = 2;
    while (k.length < 64) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (prime) k.push((Math.cbrt(n) * 4294967296) | 0);
      n++;
    }
    return k;
  })();
  function sha256(str) {
    const s = unescape(encodeURIComponent(str));
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = s.length, words = [];
    for (let i = 0; i < l; i++) words[i >> 2] |= s.charCodeAt(i) << (24 - (i % 4) * 8);
    words[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
    const nWords = (((l + 8) >> 6) + 1) * 16;
    for (let i = 0; i < nWords; i++) words[i] = words[i] | 0;
    words[nWords - 1] = l * 8;
    const w = new Array(64);
    for (let j = 0; j < nWords; j += 16) {
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        if (i < 16) w[i] = words[j + i];
        else {
          const x = w[i - 15], y = w[i - 2];
          const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
          const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  function hashPassword(pw, salt) {
    let h = sha256(salt + ':' + pw);
    for (let i = 1; i < 1000; i++) h = sha256(h + salt);
    return h;
  }
  // At least 8 characters, with letters and numbers.
  function validatePassword(pw) {
    const s = String(pw == null ? '' : pw);
    if (s.length < 8) return 'pw_short';
    if (s.length > 72) return 'pw_long';
    if (!/[A-Za-z\u0600-\u06FF]/.test(s) || !/[0-9\u0660-\u0669]/.test(s)) return 'pw_weak';
    return null;
  }
  function makeAuthWith(pw, by, mustChange, rand, at) {
    let salt = '';
    for (let i = 0; i < 16; i++) salt += Math.floor(rand() * 16).toString(16);
    return { salt, hash: hashPassword(String(pw), salt), setAt: at, setBy: by, mustChange: !!mustChange, lastSignInAt: null };
  }

  // Calls that change data. In the live site the browser sends these to the server, which re-runs
  // them on the full data with the same permission checks; everything else is read from the
  // person's own scoped copy.
  const MUTATIONS = [
    'setPassword', 'changeOwnPassword',
    'markFileViewed', 'completeSection', 'startAttempt', 'submitAttempt', 'reportIssue', 'markNotificationsRead',
    'createUser', 'updateUser', 'setUserStatus', 'removeUser', 'commitImport', 'setGrant', 'saveLocation', 'saveTeam',
    'createCourse', 'updateCourse', 'duplicateCourse', 'publishCourse', 'setCourseStatus', 'deleteCourse',
    'saveSection', 'moveSection', 'removeSection', 'addCards', 'moveFile', 'replaceFile', 'renameFile', 'removeFile', 'saveExam', 'removeExam',
    'assign', 'setSignoff', 'revokeCert', 'reissueCert', 'correctRecord',
    'exportReport', 'fullExport', 'saveRule', 'runReminders', 'resolveIssue', 'saveFaq', 'deleteFaq', 'updateSettings', 'setEmailProvider'
  ];
  // Reads that need data outside the person's own copy (run on the server, nothing saved).
  const SERVER_READS = ['previewImport'];
  // Google Drive features are simulated in the browser-only copy and switched off on the live site
  // until a Google Cloud project is connected.
  const LIVE_UNAVAILABLE = ['addFiles', 'connectDrive', 'disconnectDrive', 'exportToDrive', 'retryExport', 'runBackup', 'simulateDriveOutage'];

  /* ------------------------------------------------------------------ */
  /* CSV                                                                 */
  /* ------------------------------------------------------------------ */

  function parseCSV(text) {
    const rows = []; let row = []; let cell = ''; let q = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => clean(x) !== ''));
  }

  function toCSV(header, rows) {
    const esc = v => {
      const s = v == null ? '' : String(v);
      // Neutralise spreadsheet formula injection in exported cells.
      const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
      return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
    };
    return '﻿' + [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';
  }

  /* ------------------------------------------------------------------ */
  /* Backend                                                             */
  /* ------------------------------------------------------------------ */

  function createBackend(db, opts = {}) {
    const now = opts.now || (() => Date.now());
    const random = opts.random || Math.random;

    const nextId = prefix => { db.meta.seq = (db.meta.seq || 0) + 1; return prefix + db.meta.seq.toString(36); };
    const byId = (list, id) => db[list].find(x => x.id === id);
    const user = id => db.users.find(u => u.id === id);

    // Password hashes never leave the backend: not in API answers, not in the audit log, not in exports.
    const scrub = o => { const c = clone(o); if (c && typeof c === 'object') { delete c.auth; delete c.sessionVer; } return c; };
    // Password hashing is pluggable: the live server supplies PBKDF2 hashes it computed beforehand;
    // the browser-only copy uses the built-in SHA-256 loop.
    const PW = opts.passwords || null;
    const makeAuth = (pw, by, mustChange) => (PW ? PW.make(String(pw), by, !!mustChange, iso(now())) : makeAuthWith(pw, by, mustChange, random, iso(now())));
    function verifyPw(auth, pw) {
      if (PW) return !!(auth && auth.hash && PW.verify(auth, String(pw == null ? '' : pw)));
      if (!auth || !auth.hash) { hashPassword(String(pw == null ? '' : pw), 'no-account'); return false; } // same work either way
      return hashPassword(String(pw == null ? '' : pw), auth.salt) === auth.hash;
    }
    const authInfo = u => (u && u.auth ? { hasPassword: !!u.auth.hash, mustChange: !!u.auth.mustChange, setAt: u.auth.setAt || null, setBy: u.auth.setBy || null, lastSignInAt: u.auth.lastSignInAt || null }
      : (u && u.login ? clone(u.login) : { hasPassword: false, mustChange: false, setAt: null, setBy: null, lastSignInAt: null }));
    const bumpSessions = u => { u.sessionVer = (u.sessionVer || 0) + 1; };
    function pub(u) {
      if (!u) return u;
      const c = scrub(u);
      c.login = authInfo(u);
      return c;
    }

    function audit(actor, action, entity, entityId, before, after, reason) {
      db.audit.unshift({
        id: nextId('a'), at: iso(now()), actorId: actor ? actor.id : null, actorRole: actor ? actor.role : 'system',
        action, entity, entityId, before: scrub(before) || null, after: scrub(after) || null, reason: reason || null
      });
    }

    /* ---------- identity, permissions, scope ---------- */

    function actorOf(actorId) {
      const a = user(actorId);
      if (!a || a.status !== 'active') throw new ApiError('unauthenticated', 'Sign in again.');
      return a;
    }

    function permsOf(a) {
      if (!a || a.status !== 'active') return new Set();
      if (a.role === 'area_manager') {
        const g = db.grants[a.id];
        return new Set(g ? g.perms.filter(p => GRANTABLE.includes(p)) : []);
      }
      return new Set(ROLE_PERMS[a.role] || []);
    }

    function scopeOf(a) {
      if (RANK[a.role] >= RANK.ops_manager) return { global: true };
      if (a.role === 'area_manager') {
        const g = db.grants[a.id] || { locations: [], teams: [], users: [], courses: null };
        return {
          global: false, locations: new Set(g.locations || []), teams: new Set(g.teams || []),
          users: new Set(g.users || []), courses: g.courses && g.courses.length ? new Set(g.courses) : null
        };
      }
      return { global: false, self: true, locations: new Set(), teams: new Set(), users: new Set(), courses: new Set() };
    }

    function userInScope(a, t) {
      if (!t) return false;
      const s = scopeOf(a);
      if (s.global) return true;
      if (t.id === a.id) return true;
      if (s.self) return false;
      return s.locations.has(t.locationId) || s.teams.has(t.teamId) || s.users.has(t.id);
    }
    function placeInScope(a, locationId, teamId) {
      const s = scopeOf(a);
      if (s.global) return true;
      if (s.self) return false;
      return s.locations.has(locationId) || (teamId && s.teams.has(teamId));
    }
    function courseInScope(a, courseId) {
      const s = scopeOf(a);
      if (s.global) return true;
      if (s.self) return false;
      return !s.courses || s.courses.has(courseId);
    }

    function has(a, perm) { return permsOf(a).has(perm); }
    function need(a, perm) {
      if (!has(a, perm)) throw new ApiError('forbidden_role', 'Your role does not include this action.', { perm });
    }
    function needUser(a, perm, t) {
      need(a, perm);
      if (!t || !userInScope(a, t)) throw new ApiError('not_found', 'Person not found in your scope.');
    }
    function needCourse(a, perm, courseId) {
      need(a, perm);
      if (!byId('courses', courseId)) throw new ApiError('not_found', 'Course not found.');
      if (!courseInScope(a, courseId)) throw new ApiError('forbidden_scope', 'This course is outside your access.');
    }
    function canManageTarget(a, t) { return a.role === 'admin' || RANK[t.role] < RANK[a.role]; }
    function assignableRoles(a) {
      if (a.role === 'admin') return ROLES.slice();
      if (a.role === 'area_manager') return ['staff'];
      return ROLES.filter(r => RANK[r] < RANK[a.role]);
    }

    // Public check used by the UI to grey out actions with a reason (never the protection).
    function check(actorId, perm, ctx = {}) {
      const a = user(actorId);
      if (!a || a.status !== 'active') return { ok: false, code: 'unauthenticated' };
      if (!has(a, perm)) return { ok: false, code: 'forbidden_role' };
      if (ctx.userId) {
        const t = user(ctx.userId);
        if (!userInScope(a, t)) return { ok: false, code: 'forbidden_scope' };
        if (['users.edit', 'users.deactivate', 'users.remove', 'users.role'].includes(perm) && t.id !== a.id && !canManageTarget(a, t)) return { ok: false, code: 'forbidden_rank' };
      }
      if (ctx.courseId && !courseInScope(a, ctx.courseId)) return { ok: false, code: 'forbidden_scope' };
      return { ok: true };
    }

    /* ---------- derived training state ---------- */

    const activeEnrollments = userId => db.enrollments.filter(e => e.userId === userId && e.active);
    const courseSections = courseId => db.sections.filter(s => s.courseId === courseId).sort((a, b) => a.pos - b.pos);
    const sectionFiles = sectionId => db.files.filter(f => f.sectionId === sectionId).sort((a, b) => a.pos - b.pos);
    const sectionExam = sectionId => db.exams.find(x => x.sectionId === sectionId);
    const finalExam = courseId => db.exams.find(x => x.courseId === courseId && x.kind === 'final');
    const courseSkills = courseId => db.skills.filter(k => k.courseId === courseId);

    function progressOf(userId, sectionId, version) {
      return db.progress.find(p => p.userId === userId && p.sectionId === sectionId && p.version === version);
    }
    function attemptsOf(userId, examId, version) {
      return db.attempts.filter(t => t.userId === userId && t.examId === examId && (version == null || t.version === version))
        .sort((a, b) => a.no - b.no);
    }
    function bestAttempt(userId, examId, version) {
      const done = attemptsOf(userId, examId, version).filter(t => t.submittedAt);
      return done.reduce((b, t) => (!b || t.scorePct > b.scorePct ? t : b), null);
    }
    function latestSignoff(skillId, userId) {
      return db.signoffs.filter(s => s.skillId === skillId && s.userId === userId)
        .sort((a, b) => (a.at < b.at ? 1 : -1))[0] || null;
    }
    function sectionDone(userId, section, version) {
      const p = progressOf(userId, section.id, version);
      return !!(p && p.completedAt);
    }

    function enrollmentStatus(e) {
      if (e.completedAt) return 'completed';
      if (e.dueOn && now() > endOfDay(e.dueOn)) return 'overdue';
      if (e.startedAt) return 'in_progress';
      return 'not_started';
    }

    function enrollmentDetail(e) {
      const secs = courseSections(e.courseId).filter(s => s.required);
      const done = secs.filter(s => sectionDone(e.userId, s, e.version)).length;
      const fx = finalExam(e.courseId);
      const finalPassed = fx ? !!(bestAttempt(e.userId, fx.id, e.version) || {}).passed : true;
      const skills = courseSkills(e.courseId).filter(k => k.requiresSignoff);
      const skillsPassed = skills.filter(k => (latestSignoff(k.id, e.userId) || {}).status === 'passed').length;
      const steps = secs.length + (fx ? 1 : 0) + skills.length;
      const stepsDone = done + (finalPassed && fx ? 1 : 0) + skillsPassed;
      const next = courseSections(e.courseId).find(s => s.required && !sectionDone(e.userId, s, e.version));
      return {
        status: enrollmentStatus(e), sectionsDone: done, sectionsTotal: secs.length, finalPassed,
        skillsPassed, skillsTotal: skills.length, percent: steps ? Math.round((stepsDone / steps) * 100) : 0,
        nextSectionId: next ? next.id : null,
        awaitingSignoff: !e.completedAt && done === secs.length && finalPassed && skillsPassed < skills.length
      };
    }

    function certPrefix() { return (db.settings.certPrefix || 'CRT').toUpperCase(); }
    function newCertNo() {
      const al = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      let s = '';
      for (let i = 0; i < 8; i++) s += al[Math.floor(random() * al.length)];
      const no = `${certPrefix()}-${new Date(now()).getUTCFullYear()}-${s.slice(0, 4)}-${s.slice(4)}`;
      return db.certs.some(c => c.no === no) ? newCertNo() : no;
    }

    function issueCertificate(e, issuedBy) {
      const u = user(e.userId); const c = byId('courses', e.courseId);
      const cert = {
        id: nextId('c'), no: newCertNo(), userId: u.id, courseId: c.id, version: e.version,
        holder: clone(u.name), business: clone(db.settings.business), courseTitle: clone(c.title),
        completedOn: dateOnly(e.completedAt), issuedAt: iso(now()), issuedBy: issuedBy || 'system',
        status: 'valid', revokedAt: null, revokedBy: null, reason: null, replaces: null
      };
      db.certs.push(cert);
      notify(u.id, 'certificate', { en: 'Certificate ready', ar: 'شهادتك جاهزة' },
        { en: `You completed ${c.title.en}.`, ar: `أكملت دورة ${c.title.ar}.` }, 'cert:' + cert.id, 'cert:' + cert.no);
      audit(issuedBy && issuedBy !== 'system' ? user(issuedBy) : null, 'certificate.issue', 'certificate', cert.id, null, cert);
      return cert;
    }

    function tryComplete(e, by) {
      if (e.completedAt || !e.active) return null;
      const d = enrollmentDetail(e);
      if (d.sectionsDone === d.sectionsTotal && d.finalPassed && d.skillsPassed === d.skillsTotal) {
        e.completedAt = iso(now());
        return issueCertificate(e, by);
      }
      return null;
    }

    function notify(userId, kind, title, body, link, key) {
      if (key && db.notifications.some(n => n.key === key)) return null; // dedupe
      const n = { id: nextId('n'), userId, kind, title, body, link: link || null, key: key || null, at: iso(now()), readAt: null };
      db.notifications.unshift(n);
      return n;
    }

    function enrollmentFor(userId, courseId) {
      return db.enrollments.filter(e => e.userId === userId && e.courseId === courseId && e.active)
        .sort((a, b) => b.version - a.version)[0] || null;
    }

    /* ---------- public, no sign-in ---------- */

    function verifyCertificate(no) {
      const c = db.certs.find(x => x.no === clean(no).toUpperCase());
      if (!c) return { found: false };
      const initials = n => n.split(/\s+/).filter(Boolean).map(w => w[0] + '.').join(' ');
      return {
        found: true, no: c.no, status: c.status, version: c.version, completedOn: c.completedOn,
        courseTitle: clone(c.courseTitle), business: clone(c.business),
        holderInitials: { en: initials(c.holder.en), ar: initials(c.holder.ar) },
        revokedOn: c.revokedAt ? c.revokedAt.slice(0, 10) : null
      };
    }

    /* ---------- first run ---------- */

    const needsSetup = () => !db.users.some(u => u.role === 'admin' && u.status === 'active');

    // Creates the one administrator on a fresh installation. Refused once any active Admin exists.
    // The live server only lets this through with the setup code the owner keeps in Supabase.
    function setupAdmin(d) {
      if (!needsSetup()) throw new ApiError('conflict', 'This site already has an administrator.');
      const email = clean(d && d.email).toLowerCase();
      const errs = {};
      if (!emailRe.test(email)) errs.email = 'email_format';
      if (email && db.users.some(u => u.email && u.email.toLowerCase() === email)) errs.email = 'duplicate';
      if (String((d && d.password) || '').length < 8) errs.password = 'pw_short';
      if (String((d && d.password) || '').length > 72) errs.password = 'pw_long';
      const nameEn = clean(d && d.name && d.name.en), nameAr = clean(d && d.name && d.name.ar);
      if (!nameEn && !nameAr) errs.nameEn = 'required';
      if (Object.keys(errs).length) throw new ApiError('invalid', 'Check the highlighted fields.', errs);
      let loc = db.locations.find(l => l.active !== false);
      if (!loc) { loc = { id: nextId('l'), name: { en: 'Head office', ar: 'الإدارة العامة' }, city: { en: '', ar: '' }, active: true }; db.locations.push(loc); }
      const id = nextId('u');
      const u = {
        id, code: clean(d.code), name: { en: nameEn || nameAr, ar: nameAr || nameEn }, email, phone: '', role: 'admin',
        locationId: loc.id, teamId: null, title: clean(d.title) || 'System administrator', hireDate: null, lang: d.lang === 'en' ? 'en' : 'ar',
        status: 'active', createdBy: id, createdAt: iso(now()), updatedBy: id, updatedAt: iso(now()), deactivatedAt: null, sessionVer: 1
      };
      u.auth = makeAuth(d.password, id, false);
      db.users.push(u);
      audit(u, 'system.setup', 'user', u.id, null, u);
      return { userId: u.id, sessionVer: u.sessionVer };
    }

    // Owner-only: resets an active Admin's password. The live server allows it only with the setup code.
    function recoverAdmin(email, password) {
      const u = db.users.find(x => x.role === 'admin' && x.status === 'active' && x.email && x.email.toLowerCase() === clean(email).toLowerCase());
      if (!u) throw new ApiError('not_found', 'No active administrator has that email.');
      if (String(password || '').length < 8) throw new ApiError('invalid', 'Use at least 8 characters.', { password: 'pw_short' });
      u.auth = makeAuth(password, u.id, false);
      bumpSessions(u);
      clearAttempts(u);
      audit(u, 'system.recover_admin', 'user', u.id, null, { by: 'setup code' });
      return { userId: u.id, sessionVer: u.sessionVer };
    }

    /* ---------- session and learner ---------- */

    function me(actorId) {
      const a = actorOf(actorId);
      const perms = [...permsOf(a)];
      const s = scopeOf(a);
      return {
        user: pub(a), perms, rank: RANK[a.role], mustChange: authInfo(a).mustChange,
        scope: s.global ? { global: true } : { global: false, locations: [...(s.locations || [])], teams: [...(s.teams || [])], users: [...(s.users || [])], courses: s.courses ? [...s.courses] : null },
        assignableRoles: assignableRoles(a),
        manages: perms.length > 0
      };
    }

    function learnerHome(actorId) {
      const a = actorOf(actorId);
      const items = activeEnrollments(a.id).map(e => {
        const c = byId('courses', e.courseId);
        return { enrollment: clone(e), course: { id: c.id, title: c.title, version: c.version, status: c.status }, ...enrollmentDetail(e) };
      });
      const order = { overdue: 0, in_progress: 1, not_started: 2, completed: 3 };
      items.sort((x, y) => order[x.status] - order[y.status] || (x.enrollment.dueOn || '').localeCompare(y.enrollment.dueOn || ''));
      const cont = items.find(i => i.status === 'in_progress' || i.status === 'overdue') || items.find(i => i.status === 'not_started') || null;
      return {
        items, continueItem: cont,
        notifications: db.notifications.filter(n => n.userId === a.id).slice(0, 20).map(clone),
        unread: db.notifications.filter(n => n.userId === a.id && !n.readAt).length,
        certificates: db.certs.filter(c => c.userId === a.id).map(clone)
      };
    }

    function learnerCourse(actorId, courseId) {
      const a = actorOf(actorId);
      const e = enrollmentFor(a.id, courseId);
      if (!e) throw new ApiError('not_found', 'This course is not assigned to you.');
      const c = byId('courses', courseId);
      const fx = finalExam(courseId);
      const secs = courseSections(courseId);
      const sections = secs.map((s, i) => {
        const ex = sectionExam(s.id); const p = progressOf(a.id, s.id, e.version);
        const atts = ex ? attemptsOf(a.id, ex.id, e.version).filter(t => t.submittedAt) : [];
        const prevDone = secs.slice(0, i).filter(x => x.required).every(x => sectionDone(a.id, x, e.version));
        const cs = cardState(a.id, s.id, e.version);
        return {
          id: s.id, pos: s.pos, title: s.title, intro: s.intro, required: s.required,
          done: !!(p && p.completedAt), viewed: cs.viewed, unlocked: prevDone || !db.settings.sequential,
          files: sectionFiles(s.id).map(clone),
          cardsTotal: cs.total, cardsViewed: cs.count, cardsDone: cs.all,
          exam: ex ? { ...examSummary(ex, a.id, e.version), locked: !cs.all } : null,
          attempts: atts.length
        };
      });
      const skills = courseSkills(courseId).map(k => ({ ...clone(k), signoff: clone(latestSignoff(k.id, a.id)) }));
      const cert = db.certs.filter(x => x.userId === a.id && x.courseId === courseId && x.status === 'valid').pop() || null;
      return {
        course: clone(c), enrollment: clone(e), detail: enrollmentDetail(e), sections, skills,
        final: fx ? { ...examSummary(fx, a.id, e.version), unlocked: sections.filter(s => s.required).every(s => s.done) } : null,
        certificate: clone(cert)
      };
    }

    function examSummary(ex, userId, version) {
      const atts = attemptsOf(userId, ex.id, version).filter(t => t.submittedAt);
      const best = bestAttempt(userId, ex.id, version);
      const used = atts.length;
      const failedLast = atts.length && !atts[atts.length - 1].passed;
      const passed = !!(best && best.passed);
      const left = ex.maxAttempts ? Math.max(0, ex.maxAttempts - used) : null;
      let canStart = !passed && (left === null || left > 0) && (used === 0 || (failedLast && ex.allowRetake));
      return {
        id: ex.id, kind: ex.kind, title: ex.title, passPct: ex.passPct, timeLimitMin: ex.timeLimitMin,
        maxAttempts: ex.maxAttempts, allowRetake: ex.allowRetake, review: ex.review, questionCount: ex.questions.length,
        attemptsUsed: used, attemptsLeft: left, bestScore: best ? best.scorePct : null, passed, canStart
      };
    }

    // Which cards (files) of a section this person has gone through, for one course version.
    function cardState(userId, sectionId, version) {
      const files = sectionFiles(sectionId);
      const p = progressOf(userId, sectionId, version);
      const seen = new Set(p ? p.viewed : []);
      const viewed = files.filter(f => seen.has(f.id)).map(f => f.id);
      return { total: files.length, count: viewed.length, viewed, all: viewed.length === files.length };
    }

    function markFileViewed(actorId, fileId) {
      const a = actorOf(actorId);
      const f = byId('files', fileId); if (!f) throw new ApiError('not_found');
      const s = byId('sections', f.sectionId);
      const e = enrollmentFor(a.id, s.courseId); if (!e) throw new ApiError('not_found');
      let p = progressOf(a.id, s.id, e.version);
      if (!p) { p = { userId: a.id, sectionId: s.id, version: e.version, viewed: [], completedAt: null }; db.progress.push(p); }
      if (!p.viewed.includes(fileId)) p.viewed.push(fileId);
      if (!e.startedAt) e.startedAt = iso(now());
      const cs = cardState(a.id, s.id, e.version);
      return { viewed: cs.count, total: cs.total, all: cs.all };
    }

    // May this person open this file? Enrolled learners, and managers who work with that course.
    function canViewFile(actorId, fileId) {
      const a = actorOf(actorId);
      const f = byId('files', fileId); if (!f) throw new ApiError('not_found');
      const s = byId('sections', f.sectionId); if (!s) throw new ApiError('not_found');
      if (enrollmentFor(a.id, s.courseId)) return clone(f);
      const mgr = ['content.edit', 'content.publish', 'files.manage', 'exams.manage', 'assign.manage', 'reports.view', 'issues.manage'].some(x => has(a, x));
      if (mgr && (courseInScope(a, s.courseId) || has(a, 'assign.manage'))) return clone(f);
      throw new ApiError('not_found', 'File not found in your access.');
    }

    function completeSection(actorId, sectionId) {
      const a = actorOf(actorId);
      const s = byId('sections', sectionId); if (!s) throw new ApiError('not_found');
      const e = enrollmentFor(a.id, s.courseId); if (!e) throw new ApiError('not_found');
      if (sectionExam(s.id)) throw new ApiError('invalid', 'Pass the section quiz to complete this section.');
      if (!cardState(a.id, s.id, e.version).all) throw new ApiError('locked', 'Go through every card first.');
      let p = progressOf(a.id, s.id, e.version);
      if (!p) { p = { userId: a.id, sectionId: s.id, version: e.version, viewed: [], completedAt: null }; db.progress.push(p); }
      if (!p.completedAt) p.completedAt = iso(now());
      if (!e.startedAt) e.startedAt = iso(now());
      const cert = tryComplete(e);
      return { done: true, certificate: clone(cert) };
    }

    function shuffleIds(ids) {
      const a = ids.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    }

    function startAttempt(actorId, examId) {
      const a = actorOf(actorId);
      const ex = byId('exams', examId); if (!ex) throw new ApiError('not_found');
      const e = enrollmentFor(a.id, ex.courseId);
      if (!e) throw new ApiError('not_found', 'This exam is not assigned to you.');
      if (ex.kind === 'final') {
        const ok = courseSections(ex.courseId).filter(s => s.required).every(s => sectionDone(a.id, s, e.version));
        if (!ok) throw new ApiError('locked', 'Finish every required section first.');
      }
      if (ex.kind === 'section' && !cardState(a.id, ex.sectionId, e.version).all) throw new ApiError('locked', 'Go through every card in this section first.');
      // Resume an open, unexpired attempt instead of starting another.
      const open = attemptsOf(a.id, ex.id, e.version).find(t => !t.submittedAt && (!t.expiresAt || Date.parse(t.expiresAt) > now()));
      const sum = examSummary(ex, a.id, e.version);
      if (!open) {
        if (sum.passed) throw new ApiError('invalid', 'You already passed this exam.');
        if (sum.attemptsLeft === 0) throw new ApiError('attempts_used', 'No attempts left. Ask your manager.');
        if (sum.attemptsUsed > 0 && !ex.allowRetake) throw new ApiError('attempts_used', 'Retakes are not allowed for this exam.');
      }
      const t = open || {
        id: nextId('t'), examId: ex.id, userId: a.id, version: e.version,
        no: attemptsOf(a.id, ex.id, e.version).length + 1, startedAt: iso(now()),
        expiresAt: ex.timeLimitMin ? iso(now() + ex.timeLimitMin * 60000) : null,
        submittedAt: null, answers: {}, scorePct: null, passed: null,
        order: ex.shuffle ? shuffleIds(ex.questions.map(q => q.id)) : ex.questions.map(q => q.id)
      };
      if (!open) db.attempts.push(t);
      if (!e.startedAt) e.startedAt = iso(now());
      // Only question and choice text leave the server — never which choice is correct.
      const questions = t.order.map(qid => {
        const q = ex.questions.find(x => x.id === qid);
        return { id: q.id, type: q.type, prompt: clone(q.prompt), choices: q.choices.map(c => ({ id: c.id, text: clone(c.text) })) };
      });
      return { attemptId: t.id, no: t.no, expiresAt: t.expiresAt, questions, exam: { id: ex.id, title: ex.title, kind: ex.kind, passPct: ex.passPct } };
    }

    function submitAttempt(actorId, attemptId, answers) {
      const a = actorOf(actorId);
      const t = byId('attempts', attemptId);
      if (!t || t.userId !== a.id) throw new ApiError('not_found');
      if (t.submittedAt) throw new ApiError('conflict', 'This attempt was already submitted.');
      const ex = byId('exams', t.examId);
      const late = t.expiresAt && now() > Date.parse(t.expiresAt) + 30000; // 30 s grace for network delay
      const given = {};
      ex.questions.forEach(q => {
        const v = answers && answers[q.id];
        if (v && q.choices.some(c => c.id === v)) given[q.id] = v;
      });
      const correct = ex.questions.filter(q => { const c = q.choices.find(x => x.correct); return c && given[q.id] === c.id; }).length;
      t.answers = late ? {} : given;
      t.scorePct = late ? 0 : Math.round((correct / ex.questions.length) * 100);
      t.passed = t.scorePct >= ex.passPct;
      t.submittedAt = iso(now());
      t.late = !!late;
      let cert = null;
      const e = enrollmentFor(a.id, ex.courseId);
      if (t.passed && ex.kind === 'section') {
        let p = progressOf(a.id, ex.sectionId, t.version);
        if (!p) { p = { userId: a.id, sectionId: ex.sectionId, version: t.version, viewed: [], completedAt: null }; db.progress.push(p); }
        if (!p.completedAt) p.completedAt = iso(now());
      }
      if (t.passed && e) cert = tryComplete(e);
      const showReview = ex.review === 'after_submit' || (ex.review === 'after_pass' && t.passed);
      const review = showReview ? ex.questions.map(q => ({
        id: q.id, prompt: clone(q.prompt), chosen: t.answers[q.id] || null,
        correct: (q.choices.find(c => c.correct) || {}).id, choices: q.choices.map(c => ({ id: c.id, text: clone(c.text) }))
      })) : null;
      const sum = examSummary(ex, a.id, t.version);
      return { scorePct: t.scorePct, passed: t.passed, late: t.late, passPct: ex.passPct, review, certificate: clone(cert), canRetake: sum.canStart, attemptsLeft: sum.attemptsLeft };
    }

    function myCertificates(actorId) {
      const a = actorOf(actorId);
      return db.certs.filter(c => c.userId === a.id).map(clone);
    }
    function getCertificate(actorId, certId) {
      const a = actorOf(actorId);
      const c = byId('certs', certId); if (!c) throw new ApiError('not_found');
      if (c.userId !== a.id) needUser(a, 'certs.view', user(c.userId));
      return clone(c);
    }

    function mySkills(actorId) {
      const a = actorOf(actorId);
      const courseIds = [...new Set(activeEnrollments(a.id).map(e => e.courseId))];
      return db.skills.filter(k => courseIds.includes(k.courseId)).map(k => ({
        ...clone(k), course: clone(byId('courses', k.courseId).title), signoff: clone(latestSignoff(k.id, a.id))
      }));
    }

    function reportIssue(actorId, data) {
      const a = actorOf(actorId);
      const msg = clean(data.message);
      if (msg.length < 5) throw new ApiError('invalid', 'Describe the problem in a few words.');
      if (msg.length > 1000) throw new ApiError('invalid', 'Keep it under 1,000 characters.');
      const s = data.sectionId ? byId('sections', data.sectionId) : null;
      if (s && !enrollmentFor(a.id, s.courseId)) throw new ApiError('not_found');
      const it = { id: nextId('i'), userId: a.id, courseId: s ? s.courseId : data.courseId || null, sectionId: s ? s.id : null, fileId: data.fileId || null, message: msg, status: 'open', at: iso(now()), resolvedBy: null, note: null };
      db.issues.unshift(it);
      audit(a, 'issue.report', 'issue', it.id, null, it);
      return clone(it);
    }

    function markNotificationsRead(actorId) {
      const a = actorOf(actorId);
      db.notifications.forEach(n => { if (n.userId === a.id && !n.readAt) n.readAt = iso(now()); });
      return true;
    }

    function listFaqs(actorId, q) {
      actorOf(actorId);
      const term = clean(q).toLowerCase();
      return db.faqs.filter(f => !term || [f.q.en, f.q.ar, f.a.en, f.a.ar, ...(f.tags || [])].join(' ').toLowerCase().includes(term)).map(clone);
    }

    /* ---------- people ---------- */

    function listUsers(actorId, f = {}) {
      const a = actorOf(actorId); need(a, 'users.view');
      const q = clean(f.q).toLowerCase();
      return db.users.filter(u => userInScope(a, u))
        .filter(u => !f.locationId || u.locationId === f.locationId)
        .filter(u => !f.teamId || u.teamId === f.teamId)
        .filter(u => !f.role || u.role === f.role)
        .filter(u => !f.status || u.status === f.status)
        .filter(u => !q || [u.name.en, u.name.ar, u.email, u.code].join(' ').toLowerCase().includes(q))
        .map(pub);
    }

    function getUser(actorId, userId) {
      const a = actorOf(actorId);
      const t = user(userId);
      if (t && t.id === a.id) { /* own record always readable */ } else needUser(a, 'users.view', t);
      const out = { user: pub(t) };
      if (t.id === a.id || has(a, 'progress.view')) {
        out.enrollments = db.enrollments.filter(e => e.userId === t.id).map(e => ({ ...clone(e), course: clone(byId('courses', e.courseId).title), ...enrollmentDetail(e) }));
        out.attempts = db.attempts.filter(x => x.userId === t.id && x.submittedAt).map(x => ({ ...clone(x), exam: clone(byId('exams', x.examId).title), answers: undefined }));
        out.signoffs = db.signoffs.filter(s => s.userId === t.id).map(s => ({ ...clone(s), skill: clone(byId('skills', s.skillId).title) }));
        out.corrections = db.corrections.filter(c => c.userId === t.id).map(clone);
      }
      if (t.id === a.id || has(a, 'certs.view')) out.certs = db.certs.filter(c => c.userId === t.id).map(clone);
      return out;
    }

    function validateUserFields(d, existingId) {
      const errs = {};
      if (!clean(d.name && d.name.en)) errs.nameEn = 'required';
      if (!clean(d.email) && !clean(d.code)) errs.email = 'email_or_code';
      if (clean(d.email) && !emailRe.test(clean(d.email))) errs.email = 'email_format';
      if (clean(d.email) && db.users.some(u => u.id !== existingId && u.email && u.email.toLowerCase() === clean(d.email).toLowerCase())) errs.email = 'duplicate';
      if (clean(d.code) && db.users.some(u => u.id !== existingId && u.code && u.code.toLowerCase() === clean(d.code).toLowerCase())) errs.code = 'duplicate';
      if (clean(d.phone) && !/^\+?[0-9 ]{7,16}$/.test(clean(d.phone))) errs.phone = 'phone_format';
      if (!ROLES.includes(d.role)) errs.role = 'required';
      if (!d.locationId || !byId('locations', d.locationId)) errs.locationId = 'required';
      if (d.teamId) { const t = byId('teams', d.teamId); if (!t || t.locationId !== d.locationId) errs.teamId = 'team_location'; }
      return errs;
    }

    function sanitizeUser(d) {
      return {
        code: clean(d.code), name: { en: clean(d.name && d.name.en), ar: clean(d.name && d.name.ar) },
        email: clean(d.email).toLowerCase(), phone: clean(d.phone), role: d.role || 'staff',
        locationId: d.locationId || null, teamId: d.teamId || null, title: clean(d.title),
        hireDate: clean(d.hireDate) || null, lang: d.lang === 'en' ? 'en' : 'ar'
      };
    }

    function createUser(actorId, data, _opts = {}) {
      const a = actorOf(actorId); need(a, 'users.edit');
      const d = sanitizeUser(data);
      if (!assignableRoles(a).includes(d.role)) throw new ApiError('forbidden_rank', 'You cannot create someone with this role.');
      if (d.role !== 'staff') need(a, 'users.role');
      if (!placeInScope(a, d.locationId, d.teamId)) throw new ApiError('forbidden_scope', 'That location or team is outside your access.');
      const errs = validateUserFields(d);
      const pwErr = validatePassword(data.password);
      if (pwErr) errs.password = pwErr;
      if (Object.keys(errs).length) throw new ApiError('invalid', 'Check the highlighted fields.', errs);
      const u = { id: nextId('u'), ...d, status: 'active', createdBy: a.id, createdAt: iso(now()), updatedBy: a.id, updatedAt: iso(now()), deactivatedAt: null };
      u.auth = makeAuth(data.password, a.id, data.mustChange !== false);
      db.users.push(u);
      audit(a, _opts.via === 'import' ? 'user.import' : 'user.create', 'user', u.id, null, { ...u, passwordSet: true, mustChange: u.auth.mustChange });
      autoAssignByRole(u, a);
      return pub(u);
    }

    function updateUser(actorId, userId, patch) {
      const a = actorOf(actorId); const t = user(userId);
      needUser(a, 'users.edit', t);
      if (t.id !== a.id && !canManageTarget(a, t)) throw new ApiError('forbidden_rank', 'You cannot edit someone at or above your own role.');
      const before = clone(t);
      const d = sanitizeUser({ ...t, ...patch, name: { ...t.name, ...(patch.name || {}) } });
      if (d.role !== t.role) {
        need(a, 'users.role');
        if (t.id === a.id) throw new ApiError('forbidden_rank', 'You cannot change your own role.');
        if (!assignableRoles(a).includes(d.role)) throw new ApiError('forbidden_rank', 'You cannot give this role.');
        if (t.role === 'admin' && d.role !== 'admin' && activeAdmins() <= 1) throw new ApiError('last_admin', 'Keep at least one active Admin.');
      }
      if ((d.locationId !== t.locationId || d.teamId !== t.teamId) && !placeInScope(a, d.locationId, d.teamId)) throw new ApiError('forbidden_scope', 'That location or team is outside your access.');
      const errs = validateUserFields(d, t.id);
      if (Object.keys(errs).length) throw new ApiError('invalid', 'Check the highlighted fields.', errs);
      Object.assign(t, d, { updatedBy: a.id, updatedAt: iso(now()) });
      if (t.role !== 'area_manager') delete db.grants[t.id];
      audit(a, 'user.update', 'user', t.id, before, t);
      return pub(t);
    }

    const activeAdmins = () => db.users.filter(u => u.role === 'admin' && u.status === 'active').length;

    function setUserStatus(actorId, userId, status) {
      const a = actorOf(actorId); const t = user(userId);
      needUser(a, 'users.deactivate', t);
      if (!['active', 'inactive'].includes(status)) throw new ApiError('invalid');
      if (t.id === a.id) throw new ApiError('forbidden_rank', 'You cannot deactivate your own account.');
      if (!canManageTarget(a, t)) throw new ApiError('forbidden_rank', 'You cannot change someone at or above your own role.');
      if (t.role === 'admin' && status === 'inactive' && activeAdmins() <= 1) throw new ApiError('last_admin', 'Keep at least one active Admin.');
      const before = clone(t);
      t.status = status; t.deactivatedAt = status === 'inactive' ? iso(now()) : null; t.updatedBy = a.id; t.updatedAt = iso(now());
      if (status === 'inactive') bumpSessions(t);
      audit(a, status === 'inactive' ? 'user.deactivate' : 'user.reactivate', 'user', t.id, before, t);
      return pub(t);
    }

    function hasHistory(userId) {
      return db.progress.some(p => p.userId === userId) || db.attempts.some(t => t.userId === userId) ||
        db.certs.some(c => c.userId === userId) || db.signoffs.some(s => s.userId === userId);
    }

    function removeUser(actorId, userId) {
      const a = actorOf(actorId); const t = user(userId);
      needUser(a, 'users.remove', t);
      if (t.id === a.id || !canManageTarget(a, t)) throw new ApiError('forbidden_rank', 'You cannot remove this person.');
      if (hasHistory(t.id)) throw new ApiError('has_history', 'This person has training history. Deactivate instead so reports stay complete.');
      db.users = db.users.filter(u => u.id !== t.id);
      db.enrollments = db.enrollments.filter(e => e.userId !== t.id);
      db.notifications = db.notifications.filter(n => n.userId !== t.id);
      delete db.grants[t.id];
      audit(a, 'user.remove', 'user', t.id, t, null);
      return true;
    }

    /* ---------- sign-in and passwords ---------- */

    const LOCK_AFTER = 5, LOCK_MIN = 15;
    const loginKey = v => clean(v).toLowerCase();
    function recentFails(key) {
      db.loginAttempts = (db.loginAttempts || []).filter(x => Date.parse(x.at) > now() - 24 * 3600000);
      return db.loginAttempts.filter(x => x.key === key && Date.parse(x.at) > now() - LOCK_MIN * 60000).length;
    }
    function clearAttempts(u) {
      const keys = [loginKey(u.email), loginKey(u.code)].filter(Boolean);
      db.loginAttempts = (db.loginAttempts || []).filter(x => !keys.includes(x.key));
    }

    function findLogin(identifier) {
      const key = loginKey(identifier);
      return key ? db.users.find(x => (x.email && x.email.toLowerCase() === key) || (x.code && x.code.toLowerCase() === key)) || null : null;
    }

    // Sign in with an employee code or a work email, and the password a manager set.
    // Unknown accounts, wrong passwords and deactivated accounts get the same answer.
    function login(identifier, password) {
      const key = loginKey(identifier);
      if (!key || !password) throw new ApiError('bad_credentials', 'Enter your employee code or email, and your password.');
      const fails = recentFails(key);
      if (fails >= LOCK_AFTER) throw new ApiError('login_locked', 'Too many attempts. Try again in 15 minutes or ask your manager.');
      const u = findLogin(key);
      const ok = verifyPw(u && u.status === 'active' ? u.auth : null, password);
      if (!ok) {
        db.loginAttempts.push({ key, at: iso(now()) });
        if (fails + 1 >= LOCK_AFTER) audit(null, 'auth.locked', 'user', u ? u.id : null, null, { identifier: key, minutes: LOCK_MIN });
        throw new ApiError('bad_credentials', 'The employee code, email or password is not correct.');
      }
      clearAttempts(u);
      u.auth.lastSignInAt = iso(now());
      return { userId: u.id, mustChange: !!u.auth.mustChange, sessionVer: u.sessionVer || 0 };
    }

    // A manager sets or resets someone's password: needs "add and edit people", the person in scope, and below the manager's role.
    function setPassword(actorId, userId, password, mustChange) {
      const a = actorOf(actorId); const t = user(userId);
      needUser(a, 'users.edit', t);
      if (t.id === a.id) throw new ApiError('invalid', 'Use “Change my password” for your own account.');
      if (!canManageTarget(a, t)) throw new ApiError('forbidden_rank', 'You cannot set a password for someone at or above your own role.');
      const err = validatePassword(password);
      if (err) throw new ApiError('invalid', 'Use at least 8 characters, with letters and numbers.', { password: err });
      t.auth = makeAuth(password, a.id, mustChange !== false);
      bumpSessions(t);   // signs the person out everywhere
      clearAttempts(t);
      audit(a, 'user.password_set', 'user', t.id, null, { mustChange: t.auth.mustChange });
      return pub(t);
    }

    function changeOwnPassword(actorId, current, next) {
      const a = actorOf(actorId);
      if (!verifyPw(a.auth, current)) throw new ApiError('bad_credentials', 'Your current password is not correct.');
      const err = validatePassword(next);
      if (err) throw new ApiError('invalid', 'Use at least 8 characters, with letters and numbers.', { password: err });
      if (String(next) === String(current)) throw new ApiError('invalid', 'Choose a password different from the current one.', { password: 'pw_same' });
      a.auth = makeAuth(next, a.id, false);
      bumpSessions(a);   // other devices are signed out; the server hands this device a fresh session
      audit(a, 'user.password_change', 'user', a.id, null, { self: true });
      return true;
    }

    const IMPORT_COLUMNS = ['employee_code', 'full_name_en', 'full_name_ar', 'email', 'phone', 'location', 'team', 'job_title', 'role'];

    function previewImport(actorId, csvText) {
      const a = actorOf(actorId); need(a, 'users.import'); need(a, 'users.edit');
      const rows = parseCSV(csvText);
      if (!rows.length) throw new ApiError('invalid', 'The file is empty.');
      const header = rows[0].map(h => clean(h).toLowerCase().replace(/\s+/g, '_'));
      const missing = ['full_name_en', 'location'].filter(c => !header.includes(c));
      if (missing.length) throw new ApiError('invalid', 'Missing columns: ' + missing.join(', '), { missing });
      const col = name => header.indexOf(name);
      const seenEmail = new Set(); const seenCode = new Set();
      const out = rows.slice(1).map((r, i) => {
        const get = n => (col(n) >= 0 ? clean(r[col(n)]) : '');
        const loc = db.locations.find(l => [l.id, l.name.en, l.name.ar].map(x => x.toLowerCase()).includes(get('location').toLowerCase()));
        const team = loc && get('team') ? db.teams.find(t => t.locationId === loc.id && [t.id, t.name.en, t.name.ar].map(x => x.toLowerCase()).includes(get('team').toLowerCase())) : null;
        const role = (get('role') || 'staff').toLowerCase().replace(/\s+/g, '_');
        const d = { code: get('employee_code'), name: { en: get('full_name_en'), ar: get('full_name_ar') }, email: get('email'), phone: get('phone'), role, locationId: loc ? loc.id : null, teamId: team ? team.id : null, title: get('job_title') };
        const problems = [];
        const errs = validateUserFields(sanitizeUser(d));
        if (!loc) problems.push('unknown_location');
        if (get('team') && loc && !team) problems.push('unknown_team');
        Object.entries(errs).forEach(([k, v]) => { if (!(k === 'locationId' && !loc)) problems.push(k + ':' + v); });
        if (!ROLES.includes(role)) problems.push('unknown_role');
        else if (!assignableRoles(a).includes(role) || (role !== 'staff' && !has(a, 'users.role'))) problems.push('role_not_allowed');
        if (loc && !placeInScope(a, loc.id, team && team.id)) problems.push('outside_scope');
        const em = d.email.toLowerCase();
        if (em && seenEmail.has(em)) problems.push('duplicate_in_file');
        if (d.code && seenCode.has(d.code.toLowerCase())) problems.push('duplicate_in_file');
        if (em) seenEmail.add(em); if (d.code) seenCode.add(d.code.toLowerCase());
        const duplicate = problems.some(p => p.endsWith(':duplicate') || p === 'duplicate_in_file');
        return { line: i + 2, data: d, problems: [...new Set(problems)], status: problems.length ? (duplicate ? 'duplicate' : 'error') : 'ready' };
      });
      return { columns: header, rows: out, ready: out.filter(r => r.status === 'ready').length };
    }

    function commitImport(actorId, csvText, tempPassword) {
      const a = actorOf(actorId);
      const prev = previewImport(actorId, csvText);
      const err = validatePassword(tempPassword);
      if (err) throw new ApiError('invalid', 'Choose a temporary password: at least 8 characters, with letters and numbers.', { password: err });
      const created = [];
      prev.rows.filter(r => r.status === 'ready').forEach(r => created.push(createUser(a.id, { ...r.data, password: tempPassword, mustChange: true }, { via: 'import' })));
      audit(a, 'user.import_batch', 'user', null, null, { created: created.length, skipped: prev.rows.length - created.length });
      return { created: created.length, skipped: prev.rows.length - created.length };
    }

    /* ---------- Area Manager access ---------- */

    function getGrant(actorId, amId) {
      const a = actorOf(actorId);
      const t = user(amId);
      if (!t) throw new ApiError('not_found');
      if (a.id !== t.id && !has(a, 'access.grant')) need(a, 'users.role');
      return clone(db.grants[amId] || { perms: [], locations: [], teams: [], users: [], courses: null });
    }

    function setGrant(actorId, amId, g) {
      const a = actorOf(actorId); need(a, 'access.grant');
      const t = user(amId);
      if (!t || t.role !== 'area_manager') throw new ApiError('invalid', 'Only Area Managers receive granted access.');
      const bad = (g.perms || []).filter(p => !GRANTABLE.includes(p));
      if (bad.length) throw new ApiError('invalid', 'These permissions cannot be granted to Area Managers: ' + bad.join(', '), { bad });
      const ok = (list, ids) => (ids || []).filter(id => byId(list, id));
      const before = clone(db.grants[amId] || null);
      db.grants[amId] = {
        perms: [...new Set(g.perms || [])], locations: ok('locations', g.locations), teams: ok('teams', g.teams),
        users: (g.users || []).filter(id => user(id)), courses: g.courses && g.courses.length ? ok('courses', g.courses) : null,
        updatedBy: a.id, updatedAt: iso(now())
      };
      audit(a, 'access.grant', 'user', amId, before, db.grants[amId]);
      return clone(db.grants[amId]);
    }

    /* ---------- locations ---------- */

    function listLocations(actorId) {
      actorOf(actorId);
      return { locations: db.locations.map(clone), teams: db.teams.map(clone) };
    }
    function saveLocation(actorId, d) {
      const a = actorOf(actorId); need(a, 'org.manage');
      if (!clean(d.name && d.name.en)) throw new ApiError('invalid', 'Name is required.');
      if (d.id) {
        const l = byId('locations', d.id); if (!l) throw new ApiError('not_found');
        const before = clone(l); Object.assign(l, { name: d.name, city: d.city || l.city, active: d.active !== false });
        audit(a, 'location.update', 'location', l.id, before, l); return clone(l);
      }
      const l = { id: nextId('l'), name: { en: clean(d.name.en), ar: clean(d.name.ar) }, city: d.city || { en: '', ar: '' }, active: true };
      db.locations.push(l); audit(a, 'location.create', 'location', l.id, null, l); return clone(l);
    }
    function saveTeam(actorId, d) {
      const a = actorOf(actorId); need(a, 'org.manage');
      if (!clean(d.name && d.name.en) || !byId('locations', d.locationId)) throw new ApiError('invalid', 'Name and location are required.');
      const t = { id: nextId('tm'), locationId: d.locationId, name: { en: clean(d.name.en), ar: clean(d.name.ar) }, active: true };
      db.teams.push(t); audit(a, 'team.create', 'team', t.id, null, t); return clone(t);
    }

    /* ---------- courses, sections, files, exams ---------- */

    function listCoursesManage(actorId) {
      const a = actorOf(actorId);
      const any = ['content.edit', 'content.publish', 'assign.manage', 'reports.view', 'exams.manage', 'files.manage'].some(p => has(a, p));
      if (!any) throw new ApiError('forbidden_role', 'Your role does not include course management.');
      const vis = db.users.filter(u => userInScope(a, u)).map(u => u.id);
      return db.courses.filter(c => courseInScope(a, c.id) || has(a, 'assign.manage')).map(c => {
        const ens = db.enrollments.filter(e => e.courseId === c.id && e.active && vis.includes(e.userId));
        return {
          ...clone(c), sections: courseSections(c.id).length, enrolled: ens.length,
          completed: ens.filter(e => e.completedAt).length, editable: courseInScope(a, c.id) && has(a, 'content.edit'),
          reviewStatus: reviewStatus(c)
        };
      });
    }

    function reviewStatus(c) {
      if (!c.reviewDue) return 'none';
      const t = endOfDay(c.reviewDue);
      if (now() > t) return 'overdue';
      if (t - now() <= 30 * DAY) return 'due_soon';
      return 'ok';
    }

    function getCourseManage(actorId, courseId) {
      const a = actorOf(actorId);
      const c = byId('courses', courseId); if (!c) throw new ApiError('not_found');
      if (!courseInScope(a, courseId) && !has(a, 'assign.manage')) throw new ApiError('forbidden_scope');
      return {
        course: clone(c),
        versions: db.versions.filter(v => v.courseId === courseId).sort((x, y) => y.version - x.version).map(clone),
        sections: courseSections(courseId).map(s => ({ ...clone(s), files: sectionFiles(s.id).map(clone), exam: clone(sectionExam(s.id)), skill: clone(sectionSkill(s.id) || null) })),
        final: clone(finalExam(courseId)),
        skills: courseSkills(courseId).map(clone),
        canEdit: has(a, 'content.edit') && courseInScope(a, courseId),
        canPublish: has(a, 'content.publish') && courseInScope(a, courseId),
        canFiles: has(a, 'files.manage') && courseInScope(a, courseId),
        canExams: has(a, 'exams.manage') && courseInScope(a, courseId),
        canDelete: has(a, 'content.delete') && courseInScope(a, courseId)
      };
    }

    function i18nField(v, required) {
      const out = { en: clean(v && v.en), ar: clean(v && v.ar) };
      if (required && !out.en && !out.ar) throw new ApiError('invalid', 'A title is required in at least one language.');
      if (!out.en) out.en = out.ar; if (!out.ar) out.ar = out.en;
      return out;
    }

    function createCourse(actorId, d) {
      const a = actorOf(actorId); need(a, 'content.edit');
      if (!scopeOf(a).global && scopeOf(a).courses) throw new ApiError('forbidden_scope', 'Your access is limited to selected courses. Ask an Admin to add new courses to it.');
      const c = {
        id: nextId('crs'), code: clean(d.code).toUpperCase() || 'C' + (db.courses.length + 1), title: i18nField(d.title, true),
        desc: i18nField(d.desc), status: 'draft', version: 0, reviewDue: d.reviewDue || null, dueDays: Number(d.dueDays) || 14,
        createdBy: a.id, updatedBy: a.id, updatedAt: iso(now())
      };
      db.courses.push(c);
      audit(a, 'course.create', 'course', c.id, null, c);
      return clone(c);
    }

    function updateCourse(actorId, courseId, patch) {
      const a = actorOf(actorId); needCourse(a, 'content.edit', courseId);
      const c = byId('courses', courseId); const before = clone(c);
      if (patch.title) c.title = i18nField(patch.title, true);
      if (patch.desc) c.desc = i18nField(patch.desc);
      if ('reviewDue' in patch) c.reviewDue = patch.reviewDue || null;
      if ('dueDays' in patch) { const n = Number(patch.dueDays); if (!(n >= 1 && n <= 365)) throw new ApiError('invalid', 'Due days must be 1 to 365.'); c.dueDays = n; }
      if ('code' in patch) c.code = clean(patch.code).toUpperCase();
      c.updatedBy = a.id; c.updatedAt = iso(now());
      audit(a, 'course.update', 'course', c.id, before, c);
      return clone(c);
    }

    function duplicateCourse(actorId, courseId, title) {
      const a = actorOf(actorId); needCourse(a, 'content.edit', courseId);
      const src = byId('courses', courseId);
      const c = createCourse(actorId, { title: title || { en: src.title.en + ' (copy)', ar: src.title.ar + ' (نسخة)' }, desc: src.desc, dueDays: src.dueDays, reviewDue: src.reviewDue });
      const copyExam = (ex, sectionId) => {
        const nx = clone(ex); nx.id = nextId('x'); nx.courseId = c.id; nx.sectionId = sectionId;
        nx.questions.forEach(q => { q.id = nextId('q'); q.choices.forEach(ch => { ch.id = nextId('o'); }); });
        db.exams.push(nx);
      };
      const secMap = {};
      courseSections(courseId).forEach(s => {
        const ns = { ...clone(s), id: nextId('s'), courseId: c.id };
        secMap[s.id] = ns.id;
        db.sections.push(ns);
        sectionFiles(s.id).forEach(f => db.files.push({ ...clone(f), id: nextId('f'), sectionId: ns.id, addedBy: a.id, addedAt: iso(now()) }));
        const ex = sectionExam(s.id); if (ex) copyExam(ex, ns.id);
      });
      const fx = finalExam(courseId); if (fx) copyExam(fx, null);
      courseSkills(courseId).forEach(k => db.skills.push({ ...clone(k), id: nextId('k'), courseId: c.id, sectionId: k.sectionId ? (secMap[k.sectionId] || null) : null }));
      audit(a, 'course.duplicate', 'course', c.id, null, { from: courseId });
      return clone(byId('courses', c.id));
    }

    function publishCourse(actorId, courseId, note, retrain) {
      const a = actorOf(actorId); needCourse(a, 'content.publish', courseId);
      const c = byId('courses', courseId);
      if (!courseSections(courseId).length) throw new ApiError('invalid', 'Add at least one section before publishing.');
      const fx = finalExam(courseId);
      if (!fx || !fx.questions.length) throw new ApiError('invalid', 'Add a final assessment before publishing.');
      const before = clone(c);
      const first = c.version === 0;
      c.version += 1; c.status = 'published'; c.updatedBy = a.id; c.updatedAt = iso(now());
      const v = { courseId, version: c.version, note: clean(note) || (first ? 'First release' : ''), retrain: !first && !!retrain, publishedBy: a.id, publishedAt: iso(now()) };
      db.versions.push(v);
      let retrained = 0;
      if (v.retrain) {
        // Everyone on an older version gets a fresh enrollment on the new one.
        const olds = db.enrollments.filter(e => e.courseId === courseId && e.active && e.version < c.version);
        olds.forEach(e => {
          e.active = false; e.supersededAt = iso(now());
          const ne = newEnrollment(e.userId, courseId, e.assignmentId, dateOnly(now() + c.dueDays * DAY));
          retrained++;
          notify(e.userId, 'retrain', { en: 'Updated training to repeat', ar: 'تدريب محدّث يجب إعادته' },
            { en: `${c.title.en} changed (version ${c.version}). Please complete it again.`, ar: `تم تحديث ${c.title.ar} (النسخة ${c.version}). يرجى إكمالها مجددًا.` }, 'course:' + courseId, 'retrain:' + ne.id);
        });
      }
      audit(a, first ? 'course.publish' : 'course.version', 'course', c.id, before, { ...c, note: v.note, retrain: v.retrain, retrained });
      return { course: clone(c), version: clone(v), retrained };
    }

    function setCourseStatus(actorId, courseId, status) {
      const a = actorOf(actorId); needCourse(a, 'content.publish', courseId);
      if (!['archived', 'published'].includes(status)) throw new ApiError('invalid');
      const c = byId('courses', courseId);
      if (status === 'published' && c.version === 0) throw new ApiError('invalid', 'Publish the course first.');
      const before = clone(c); c.status = status; c.updatedAt = iso(now()); c.updatedBy = a.id;
      audit(a, status === 'archived' ? 'course.archive' : 'course.restore', 'course', c.id, before, c);
      return clone(c);
    }

    function deleteCourse(actorId, courseId) {
      const a = actorOf(actorId); needCourse(a, 'content.delete', courseId);
      const used = db.enrollments.some(e => e.courseId === courseId && (e.startedAt || e.completedAt)) || db.certs.some(c => c.courseId === courseId);
      if (used) throw new ApiError('has_history', 'People have started this course. Archive it instead.');
      const c = byId('courses', courseId);
      const secIds = courseSections(courseId).map(s => s.id);
      db.courses = db.courses.filter(x => x.id !== courseId);
      db.sections = db.sections.filter(s => s.courseId !== courseId);
      db.files = db.files.filter(f => !secIds.includes(f.sectionId));
      db.exams = db.exams.filter(x => x.courseId !== courseId);
      db.skills = db.skills.filter(k => k.courseId !== courseId);
      db.enrollments = db.enrollments.filter(e => e.courseId !== courseId);
      db.assignments = db.assignments.filter(x => x.courseId !== courseId);
      audit(a, 'course.delete', 'course', courseId, c, null);
      return true;
    }

    function saveSection(actorId, d) {
      const a = actorOf(actorId);
      if (d.id) {
        const s = byId('sections', d.id); if (!s) throw new ApiError('not_found');
        needCourse(a, 'content.edit', s.courseId);
        const before = clone(s);
        if (d.title) s.title = i18nField(d.title, true);
        if (d.intro) s.intro = i18nField(d.intro);
        if ('required' in d) s.required = !!d.required;
        if (d.skill) setSectionSkill(a, s, d.skill);
        audit(a, 'section.update', 'section', s.id, before, s); return clone(s);
      }
      needCourse(a, 'content.edit', d.courseId);
      const s = { id: nextId('s'), courseId: d.courseId, pos: courseSections(d.courseId).length + 1, title: i18nField(d.title, true), intro: i18nField(d.intro), required: d.required !== false };
      db.sections.push(s); audit(a, 'section.create', 'section', s.id, null, s);
      if (d.skill) setSectionSkill(a, s, d.skill);
      return clone(s);
    }

    // A section can carry one practical skill: a manager watches the person do it on shift and signs it off.
    // `opt` is { enabled, title: {en, ar}, desc: {en, ar} }. The skill title falls back to the section title.
    const sectionSkill = sectionId => db.skills.find(k => k.sectionId === sectionId);
    function setSectionSkill(a, s, opt) {
      const k = sectionSkill(s.id);
      if (opt.enabled) {
        const title = { en: clean(opt.title && opt.title.en) || s.title.en, ar: clean(opt.title && opt.title.ar) || s.title.ar };
        const desc = i18nField(opt.desc);
        if (k) { const before = clone(k); Object.assign(k, { title, desc, requiresSignoff: true }); audit(a, 'skill.update', 'skill', k.id, before, k); }
        else { const nk = { id: nextId('k'), courseId: s.courseId, sectionId: s.id, title, desc, requiresSignoff: true }; db.skills.push(nk); audit(a, 'skill.create', 'skill', nk.id, null, nk); }
      } else if (k) {
        if (db.signoffs.some(x => x.skillId === k.id)) throw new ApiError('has_history', 'People already have sign-offs for this skill, so it cannot be removed.');
        db.skills = db.skills.filter(x => x.id !== k.id); audit(a, 'skill.remove', 'skill', k.id, k, null);
      }
    }

    function moveSection(actorId, sectionId, dir) {
      const a = actorOf(actorId); const s = byId('sections', sectionId); if (!s) throw new ApiError('not_found');
      needCourse(a, 'content.edit', s.courseId);
      const list = courseSections(s.courseId); const i = list.indexOf(s); const j = i + (dir < 0 ? -1 : 1);
      if (j < 0 || j >= list.length) return list.map(clone);
      [list[i].pos, list[j].pos] = [list[j].pos, list[i].pos];
      audit(a, 'section.reorder', 'section', s.id, { pos: list[j].pos }, { pos: s.pos });
      return courseSections(s.courseId).map(clone);
    }

    function removeSection(actorId, sectionId) {
      const a = actorOf(actorId); const s = byId('sections', sectionId); if (!s) throw new ApiError('not_found');
      needCourse(a, 'content.edit', s.courseId);
      db.sections = db.sections.filter(x => x.id !== s.id);
      db.files = db.files.filter(f => f.sectionId !== s.id);
      db.exams = db.exams.filter(x => x.sectionId !== s.id);
      // The section's practical skill is removed with it, unless people already have sign-offs:
      // then it stays on the course so those records keep their skill.
      db.skills = db.skills.filter(k => k.sectionId !== s.id || db.signoffs.some(x => x.skillId === k.id));
      db.skills.forEach(k => { if (k.sectionId === s.id) k.sectionId = null; });
      courseSections(s.courseId).forEach((x, i) => { x.pos = i + 1; });
      audit(a, 'section.remove', 'section', s.id, s, null);
      return true;
    }

    const KIND_BY_MIME = m => (/pdf/.test(m) ? 'pdf' : /^video\//.test(m) ? 'video' : /^image\//.test(m) ? 'image' : 'doc');

    function addFiles(actorId, sectionId, picked) {
      const a = actorOf(actorId); const s = byId('sections', sectionId); if (!s) throw new ApiError('not_found');
      needCourse(a, 'files.manage', s.courseId);
      const added = [];
      (picked || []).forEach(p => {
        if (!p.driveId || !p.title) return;
        if (sectionFiles(s.id).some(f => f.driveId === p.driveId)) return; // already attached
        const f = { id: nextId('f'), sectionId: s.id, pos: sectionFiles(s.id).length + 1, driveId: p.driveId, title: clean(p.title), mime: p.mime || 'application/octet-stream', kind: KIND_BY_MIME(p.mime || ''), size: p.size || null, link: p.link || null, addedBy: a.id, addedAt: iso(now()) };
        db.files.push(f); added.push(f);
      });
      audit(a, 'file.attach', 'section', s.id, null, { files: added.map(f => f.title) });
      return added.map(clone);
    }

    // Product cards uploaded as PDF files. `path` is the storage key handed out for this section.
    function addCards(actorId, sectionId, cards) {
      const a = actorOf(actorId); const s = byId('sections', sectionId); if (!s) throw new ApiError('not_found');
      needCourse(a, 'files.manage', s.courseId);
      const list = (cards || []).slice(0, 300);
      const added = [];
      list.forEach(c => {
        const path = clean(c && c.path);
        const title = clean(c && c.title).slice(0, 200);
        if (!path.startsWith(s.id + '/') || !/\.pdf$/i.test(path) || !title) throw new ApiError('invalid', 'Each card needs a PDF file and a title.');
        if (Number(c.size) > 50 * 1024 * 1024) throw new ApiError('invalid', 'Each PDF must be 50 MB or smaller.');
        if (db.files.some(f => f.path === path)) return;
        const f = { id: nextId('f'), sectionId: s.id, pos: sectionFiles(s.id).length + 1, source: 'upload', path, title, mime: 'application/pdf', kind: 'pdf', size: Number(c.size) || null, addedBy: a.id, addedAt: iso(now()) };
        db.files.push(f); added.push(f);
      });
      audit(a, 'file.upload', 'section', s.id, null, { files: added.map(f => f.title) });
      return added.map(clone);
    }

    function moveFile(actorId, fileId, dir) {
      const a = actorOf(actorId); const f = byId('files', fileId); if (!f) throw new ApiError('not_found');
      const s = byId('sections', f.sectionId); needCourse(a, 'files.manage', s.courseId);
      const list = sectionFiles(s.id); const i = list.indexOf(f); const j = i + (dir < 0 ? -1 : 1);
      if (j >= 0 && j < list.length) { [list[i].pos, list[j].pos] = [list[j].pos, list[i].pos]; audit(a, 'file.reorder', 'file', f.id, null, { pos: f.pos }); }
      return sectionFiles(s.id).map(clone);
    }

    function replaceFile(actorId, fileId, p) {
      const a = actorOf(actorId); const f = byId('files', fileId); if (!f) throw new ApiError('not_found');
      const s = byId('sections', f.sectionId); needCourse(a, 'files.manage', s.courseId);
      const before = clone(f);
      if (p && p.path) {
        const path = clean(p.path);
        if (!path.startsWith(s.id + '/') || !/\.pdf$/i.test(path)) throw new ApiError('invalid', 'Upload a PDF file.');
        delete f.driveId; delete f.link;
        Object.assign(f, { source: 'upload', path, title: clean(p.title) || f.title, mime: 'application/pdf', kind: 'pdf', size: Number(p.size) || null, addedBy: a.id, addedAt: iso(now()) });
      } else {
        delete f.path;
        Object.assign(f, { source: 'drive', driveId: p.driveId, title: clean(p.title), mime: p.mime, kind: KIND_BY_MIME(p.mime || ''), size: p.size || null, link: p.link || null, addedBy: a.id, addedAt: iso(now()) });
      }
      // A replaced card counts as new: people go through it again before the quiz.
      db.progress.forEach(pr => { if (pr.sectionId === s.id) pr.viewed = pr.viewed.filter(id => id !== f.id); });
      audit(a, 'file.replace', 'file', f.id, before, f);
      return clone(f);
    }

    function renameFile(actorId, fileId, title) {
      const a = actorOf(actorId); const f = byId('files', fileId); if (!f) throw new ApiError('not_found');
      const s = byId('sections', f.sectionId); needCourse(a, 'files.manage', s.courseId);
      const tt = clean(title).slice(0, 200);
      if (!tt) throw new ApiError('invalid', 'A title is required.');
      const before = clone(f); f.title = tt;
      audit(a, 'file.rename', 'file', f.id, before, f);
      return clone(f);
    }

    function removeFile(actorId, fileId) {
      const a = actorOf(actorId); const f = byId('files', fileId); if (!f) throw new ApiError('not_found');
      const s = byId('sections', f.sectionId); needCourse(a, 'files.manage', s.courseId);
      db.files = db.files.filter(x => x.id !== f.id);
      sectionFiles(s.id).forEach((x, i) => { x.pos = i + 1; });
      // Only the link is removed. The original Google Drive file is never touched.
      audit(a, 'file.detach', 'file', f.id, f, null);
      return true;
    }

    function validateExam(d) {
      const errs = [];
      const n = Number(d.passPct); if (!(n >= 1 && n <= 100)) errs.push('pass_pct');
      const tl = Number(d.timeLimitMin || 0); if (!(tl >= 0 && tl <= 180)) errs.push('time_limit');
      const ma = Number(d.maxAttempts || 0); if (!(ma >= 0 && ma <= 10)) errs.push('max_attempts');
      if (!['none', 'after_submit', 'after_pass'].includes(d.review)) errs.push('review');
      if (!d.questions || !d.questions.length) errs.push('no_questions');
      (d.questions || []).forEach((q, i) => {
        if (!clean(q.prompt && (q.prompt.en || q.prompt.ar))) errs.push('q' + (i + 1) + '_prompt');
        if (!['mc', 'tf'].includes(q.type)) errs.push('q' + (i + 1) + '_type');
        const ch = (q.choices || []).filter(c => clean(c.text && (c.text.en || c.text.ar)));
        if (q.type === 'mc' && ch.length < 2) errs.push('q' + (i + 1) + '_choices');
        if (q.type === 'tf' && ch.length !== 2) errs.push('q' + (i + 1) + '_choices');
        if ((q.choices || []).filter(c => c.correct).length !== 1) errs.push('q' + (i + 1) + '_correct');
      });
      return errs;
    }

    function saveExam(actorId, d) {
      const a = actorOf(actorId);
      const courseId = d.sectionId ? (byId('sections', d.sectionId) || {}).courseId : d.courseId;
      needCourse(a, 'exams.manage', courseId);
      const errs = validateExam(d);
      if (errs.length) throw new ApiError('invalid', 'Fix the exam before saving.', errs);
      const existing = d.id ? byId('exams', d.id) : (d.sectionId ? sectionExam(d.sectionId) : finalExam(courseId));
      const ex = {
        id: existing ? existing.id : nextId('x'), courseId, sectionId: d.sectionId || null, kind: d.sectionId ? 'section' : 'final',
        title: i18nField(d.title || { en: d.sectionId ? 'Section quiz' : 'Final assessment', ar: d.sectionId ? 'اختبار القسم' : 'التقييم النهائي' }, true),
        passPct: Number(d.passPct), timeLimitMin: Number(d.timeLimitMin || 0), maxAttempts: Number(d.maxAttempts || 0),
        allowRetake: !!d.allowRetake, review: d.review, shuffle: !!d.shuffle,
        questions: d.questions.map(q => ({
          id: q.id || nextId('q'), type: q.type, prompt: i18nField(q.prompt, true),
          choices: q.choices.filter(c => clean(c.text && (c.text.en || c.text.ar))).map(c => ({ id: c.id || nextId('o'), text: i18nField(c.text, true), correct: !!c.correct }))
        }))
      };
      if (existing) { const before = clone(existing); Object.assign(existing, ex); audit(a, 'exam.update', 'exam', ex.id, before, ex); }
      else { db.exams.push(ex); audit(a, 'exam.create', 'exam', ex.id, null, ex); }
      return clone(ex);
    }

    function removeExam(actorId, examId) {
      const a = actorOf(actorId); const ex = byId('exams', examId); if (!ex) throw new ApiError('not_found');
      needCourse(a, 'exams.manage', ex.courseId);
      if (db.attempts.some(t => t.examId === examId)) throw new ApiError('has_history', 'People have taken this exam. Edit it instead.');
      db.exams = db.exams.filter(x => x.id !== examId); audit(a, 'exam.remove', 'exam', examId, ex, null); return true;
    }

    /* ---------- assignments ---------- */

    function newEnrollment(userId, courseId, assignmentId, dueOn) {
      const c = byId('courses', courseId);
      const e = { id: nextId('e'), userId, courseId, version: c.version, assignmentId, assignedAt: iso(now()), dueOn, startedAt: null, completedAt: null, active: true };
      db.enrollments.push(e);
      return e;
    }

    function targetUsers(a, target) {
      const pool = db.users.filter(u => u.status === 'active' && userInScope(a, u) && (u.id !== a.id || target.kind === 'user'));
      if (target.kind === 'user') return pool.filter(u => (target.ids || [target.id]).includes(u.id));
      if (target.kind === 'team') return pool.filter(u => u.teamId === target.id);
      if (target.kind === 'location') return pool.filter(u => u.locationId === target.id);
      if (target.kind === 'role') return pool.filter(u => u.role === target.role);
      return [];
    }

    function assign(actorId, d) {
      const a = actorOf(actorId); need(a, 'assign.manage');
      const c = byId('courses', d.courseId); if (!c) throw new ApiError('not_found');
      if (!courseInScope(a, c.id)) throw new ApiError('forbidden_scope', 'This course is outside your access.');
      if (c.status !== 'published') throw new ApiError('invalid', 'Only published courses can be assigned.');
      const s = scopeOf(a);
      if (!s.global) {
        if (d.target.kind === 'location' && !s.locations.has(d.target.id)) throw new ApiError('forbidden_scope', 'That location is outside your access.');
        if (d.target.kind === 'team') { const t = byId('teams', d.target.id); if (!t || !(s.teams.has(t.id) || s.locations.has(t.locationId))) throw new ApiError('forbidden_scope', 'That team is outside your access.'); }
        if (d.target.kind === 'user') (d.target.ids || [d.target.id]).forEach(id => { if (!userInScope(a, user(id))) throw new ApiError('forbidden_scope', 'Someone selected is outside your access.'); });
      }
      const dueOn = d.dueOn || dateOnly(now() + c.dueDays * DAY);
      if (Date.parse(dueOn) < Date.parse(dateOnly(now()))) throw new ApiError('invalid', 'The due date is in the past.');
      const asg = { id: nextId('g'), courseId: c.id, target: clone(d.target), dueOn, assignedBy: a.id, at: iso(now()), scope: s.global ? null : { locations: [...s.locations], teams: [...s.teams], users: [...s.users] } };
      db.assignments.push(asg);
      let created = 0, skipped = 0;
      targetUsers(a, d.target).forEach(u => {
        const cur = enrollmentFor(u.id, c.id);
        if (cur && cur.version === c.version) { skipped++; return; }
        if (cur) cur.active = false;
        newEnrollment(u.id, c.id, asg.id, dueOn); created++;
        notify(u.id, 'assigned', { en: 'New training assigned', ar: 'تم إسناد تدريب جديد' },
          { en: `${c.title.en}, due ${humanDate(dueOn, 'en')}.`, ar: `${c.title.ar}، الموعد النهائي ${humanDate(dueOn, 'ar')}.` }, 'course:' + c.id, 'assigned:' + asg.id + ':' + u.id);
      });
      audit(a, 'assignment.create', 'assignment', asg.id, null, { ...asg, created, skipped });
      return { assignment: clone(asg), created, skipped };
    }

    function autoAssignByRole(u, a) {
      db.assignments.filter(g => g.target.kind === 'role' && g.target.role === u.role).forEach(g => {
        const c = byId('courses', g.courseId);
        if (!c || c.status !== 'published' || enrollmentFor(u.id, c.id)) return;
        if (g.scope && !(g.scope.locations.includes(u.locationId) || g.scope.teams.includes(u.teamId))) return;
        newEnrollment(u.id, c.id, g.id, dateOnly(now() + c.dueDays * DAY));
      });
    }

    function listAssignments(actorId) {
      const a = actorOf(actorId); need(a, 'assign.manage');
      const s = scopeOf(a);
      return db.assignments.filter(g => s.global || g.assignedBy === a.id || (g.target.kind === 'location' && s.locations.has(g.target.id)) || (g.target.kind === 'team' && s.teams.has(g.target.id)))
        .map(g => ({ ...clone(g), course: clone((byId('courses', g.courseId) || {}).title) })).reverse();
    }

    /* ---------- practical skills ---------- */

    function listSignoffs(actorId, f = {}) {
      const a = actorOf(actorId); need(a, 'signoff.manage');
      const rows = [];
      db.enrollments.filter(e => e.active).forEach(e => {
        const u = user(e.userId);
        if (!u || u.status !== 'active' || !userInScope(a, u) || u.id === a.id) return;
        if (f.courseId && e.courseId !== f.courseId) return;
        if (f.locationId && u.locationId !== f.locationId) return;
        courseSkills(e.courseId).forEach(k => rows.push({ skill: clone(k), user: { id: u.id, name: u.name, locationId: u.locationId }, course: clone(byId('courses', e.courseId).title), signoff: clone(latestSignoff(k.id, u.id)) }));
      });
      return rows;
    }

    function setSignoff(actorId, skillId, userId, status, notes) {
      const a = actorOf(actorId); const t = user(userId);
      needUser(a, 'signoff.manage', t);
      if (t.id === a.id) throw new ApiError('forbidden_scope', 'You cannot sign off your own skills.');
      const k = byId('skills', skillId); if (!k) throw new ApiError('not_found');
      if (!['passed', 'needs_practice', 'not_assessed'].includes(status)) throw new ApiError('invalid');
      if (!enrollmentFor(t.id, k.courseId)) throw new ApiError('invalid', 'This person is not enrolled in the course.');
      const s = { id: nextId('so'), skillId, userId, status, notes: clean(notes).slice(0, 500), by: a.id, at: iso(now()) };
      db.signoffs.push(s);
      audit(a, 'signoff.set', 'signoff', s.id, clone(latestSignoff(skillId, userId)), s);
      let cert = null;
      if (status === 'passed') { const e = enrollmentFor(t.id, k.courseId); if (e) cert = tryComplete(e, a.id); }
      return { signoff: clone(s), certificate: clone(cert) };
    }

    /* ---------- certificates ---------- */

    function listCerts(actorId, f = {}) {
      const a = actorOf(actorId); need(a, 'certs.view');
      const q = clean(f.q).toLowerCase();
      return db.certs.filter(c => userInScope(a, user(c.userId)))
        .filter(c => !f.status || c.status === f.status)
        .filter(c => !q || [c.no, c.holder.en, c.holder.ar, c.courseTitle.en, c.courseTitle.ar].join(' ').toLowerCase().includes(q))
        .map(clone).reverse();
    }

    function revokeCert(actorId, certId, reason) {
      const a = actorOf(actorId); const c = byId('certs', certId); if (!c) throw new ApiError('not_found');
      needUser(a, 'certs.revoke', user(c.userId));
      if (clean(reason).length < 5) throw new ApiError('invalid', 'A reason is required.');
      if (c.status !== 'valid') throw new ApiError('conflict', 'Only valid certificates can be revoked.');
      const before = clone(c);
      Object.assign(c, { status: 'revoked', revokedAt: iso(now()), revokedBy: a.id, reason: clean(reason) });
      audit(a, 'certificate.revoke', 'certificate', c.id, before, c, clean(reason));
      return clone(c);
    }

    function reissueCert(actorId, certId, reason) {
      const a = actorOf(actorId); const c = byId('certs', certId); if (!c) throw new ApiError('not_found');
      needUser(a, 'certs.reissue', user(c.userId));
      if (clean(reason).length < 5) throw new ApiError('invalid', 'A reason is required.');
      if (c.status === 'replaced') throw new ApiError('conflict', 'This certificate was already replaced.');
      const u = user(c.userId);
      const before = clone(c);
      const n = { ...clone(c), id: nextId('c'), no: newCertNo(), holder: clone(u.name), business: clone(db.settings.business), issuedAt: iso(now()), issuedBy: a.id, status: 'valid', revokedAt: null, revokedBy: null, reason: null, replaces: c.id };
      c.status = 'replaced'; c.reason = clean(reason);
      db.certs.push(n);
      audit(a, 'certificate.reissue', 'certificate', n.id, before, n, clean(reason));
      return clone(n);
    }

    /* ---------- record corrections ---------- */

    function correctRecord(actorId, d) {
      const a = actorOf(actorId); need(a, 'records.correct');
      const reason = clean(d.reason);
      if (reason.length < 5) throw new ApiError('invalid', 'A reason is required for every correction.');
      if (d.kind === 'attempt') {
        const t = byId('attempts', d.id); if (!t) throw new ApiError('not_found');
        const u = user(t.userId); needUser(a, 'records.correct', u);
        const ex = byId('exams', t.examId);
        const v = Number(d.value); if (!(v >= 0 && v <= 100)) throw new ApiError('invalid', 'Score must be 0 to 100.');
        const before = clone(t);
        t.scorePct = v; t.passed = v >= ex.passPct; t.corrected = true;
        db.corrections.push({ id: nextId('r'), userId: u.id, entity: 'attempt', entityId: t.id, field: 'scorePct', old: before.scorePct, new: v, reason, by: a.id, at: iso(now()) });
        if (t.passed && ex.kind === 'section') {
          let p = progressOf(u.id, ex.sectionId, t.version);
          if (!p) { p = { userId: u.id, sectionId: ex.sectionId, version: t.version, viewed: [], completedAt: null }; db.progress.push(p); }
          if (!p.completedAt) p.completedAt = iso(now());
        }
        audit(a, 'record.correct', 'attempt', t.id, before, t, reason);
        const e = enrollmentFor(u.id, ex.courseId); const cert = e && t.passed ? tryComplete(e, a.id) : null;
        return { ok: true, certificate: clone(cert) };
      }
      if (d.kind === 'section') {
        const u = user(d.userId); needUser(a, 'records.correct', u);
        const s = byId('sections', d.id); if (!s) throw new ApiError('not_found');
        const e = enrollmentFor(u.id, s.courseId); if (!e) throw new ApiError('invalid', 'Not enrolled.');
        let p = progressOf(u.id, s.id, e.version);
        const before = clone(p) || null;
        if (!p) { p = { userId: u.id, sectionId: s.id, version: e.version, viewed: [], completedAt: null }; db.progress.push(p); }
        p.completedAt = d.value ? iso(now()) : null; p.corrected = true;
        db.corrections.push({ id: nextId('r'), userId: u.id, entity: 'section', entityId: s.id, field: 'completed', old: !!(before && before.completedAt), new: !!d.value, reason, by: a.id, at: iso(now()) });
        audit(a, 'record.correct', 'section_progress', s.id + ':' + u.id, before, p, reason);
        const cert = d.value ? tryComplete(e, a.id) : null;
        return { ok: true, certificate: clone(cert) };
      }
      throw new ApiError('invalid');
    }

    /* ---------- KPIs ---------- */

    function kpis(actorId, f = {}) {
      const a = actorOf(actorId); need(a, 'reports.view');
      const th = db.settings.kpi;
      const users = db.users.filter(u => userInScope(a, u) && u.id !== a.id && u.status === 'active')
        .filter(u => !f.locationId || u.locationId === f.locationId)
        .filter(u => !f.teamId || u.teamId === f.teamId)
        .filter(u => !f.userId || u.id === f.userId);
      const uids = new Set(users.map(u => u.id));
      const inRange = t => (!f.from || t >= f.from) && (!f.to || t <= f.to + 'T23:59:59.999Z');
      const ens = db.enrollments.filter(e => e.active && uids.has(e.userId) && (!f.courseId || e.courseId === f.courseId) && inRange(e.assignedAt));
      const done = ens.filter(e => e.completedAt);
      const overdue = ens.filter(e => enrollmentStatus(e) === 'overdue');
      const atts = db.attempts.filter(t => t.submittedAt && uids.has(t.userId) && (!f.courseId || byId('exams', t.examId).courseId === f.courseId) && inRange(t.submittedAt));
      const pairs = {};
      atts.forEach(t => { const k = t.userId + '|' + t.examId; (pairs[k] = pairs[k] || []).push(t); });
      const pairList = Object.values(pairs).map(l => l.sort((x, y) => x.no - y.no));
      const best = pairList.map(l => Math.max(...l.map(t => t.scorePct)));
      const passedPairs = pairList.filter(l => l.some(t => t.passed)).length;
      const firstPass = pairList.filter(l => l[0].passed).length;
      const retakes = atts.filter(t => t.no > 1).length;
      const days = done.map(e => (Date.parse(e.completedAt) - Date.parse(e.assignedAt)) / DAY);

      const so = { passed: 0, needs_practice: 0, not_assessed: 0 };
      ens.forEach(e => courseSkills(e.courseId).filter(k => k.requiresSignoff).forEach(k => { const s = latestSignoff(k.id, e.userId); so[s ? s.status : 'not_assessed']++; }));
      const soTotal = so.passed + so.needs_practice + so.not_assessed;

      const courses = db.courses.filter(c => c.status !== 'draft' && (!f.courseId || c.id === f.courseId));
      const byCourse = courses.map(c => {
        const ce = ens.filter(e => e.courseId === c.id); const cd = ce.filter(e => e.completedAt);
        const cb = pairList.filter(l => byId('exams', l[0].examId).courseId === c.id).map(l => Math.max(...l.map(t => t.scorePct)));
        return { courseId: c.id, title: clone(c.title), version: c.version, assigned: ce.length, completed: cd.length, rate: pct(cd.length, ce.length), overdue: ce.filter(e => enrollmentStatus(e) === 'overdue').length, avgScore: cb.length ? Math.round(cb.reduce((x, y) => x + y, 0) / cb.length) : null };
      }).filter(r => r.assigned > 0 || f.courseId);

      const bySection = [];
      courses.forEach(c => courseSections(c.id).forEach(s => {
        const ce = ens.filter(e => e.courseId === c.id);
        const started = ce.filter(e => { const p = progressOf(e.userId, s.id, e.version); return p; }).length;
        const comp = ce.filter(e => sectionDone(e.userId, s, e.version)).length;
        bySection.push({ courseId: c.id, course: clone(c.title), sectionId: s.id, title: clone(s.title), pos: s.pos, enrolled: ce.length, started, completed: comp, rate: pct(comp, ce.length) });
      }));

      const byPerson = users.map(u => {
        const ue = ens.filter(e => e.userId === u.id);
        const ub = pairList.filter(l => l[0].userId === u.id);
        const scores = ub.map(l => Math.max(...l.map(t => t.scorePct)));
        return {
          userId: u.id, name: clone(u.name), locationId: u.locationId, teamId: u.teamId, assigned: ue.length,
          completed: ue.filter(e => e.completedAt).length, overdue: ue.filter(e => enrollmentStatus(e) === 'overdue').length,
          avgScore: scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null,
          attempts: atts.filter(t => t.userId === u.id).length, rate: pct(ue.filter(e => e.completedAt).length, ue.length)
        };
      }).filter(r => r.assigned > 0);

      // "May need support": several independent signals, never a single score.
      const support = [];
      users.forEach(u => {
        const sig = [];
        const ue = ens.filter(e => e.userId === u.id);
        const od = ue.filter(e => enrollmentStatus(e) === 'overdue' && now() - endOfDay(e.dueOn) > th.overdueDays * DAY);
        if (od.length) sig.push({ code: 'overdue', n: od.length, days: Math.max(...od.map(e => Math.floor((now() - endOfDay(e.dueOn)) / DAY))) });
        const fails = pairList.filter(l => l[0].userId === u.id && !l.some(t => t.passed) && l.filter(t => !t.passed).length >= th.failedAttempts);
        if (fails.length) sig.push({ code: 'repeat_fail', n: fails.length, exam: clone(byId('exams', fails[0][0].examId).title) });
        const scores = pairList.filter(l => l[0].userId === u.id).map(l => Math.max(...l.map(t => t.scorePct)));
        if (scores.length >= 2) { const avg = scores.reduce((x, y) => x + y, 0) / scores.length; if (avg < th.lowAverage) sig.push({ code: 'low_avg', avg: Math.round(avg), n: scores.length }); }
        const np = db.signoffs.filter(s => s.userId === u.id).filter(s => latestSignoff(s.skillId, u.id) === s && s.status === 'needs_practice' && now() - Date.parse(s.at) > th.needsPracticeDays * DAY);
        if (np.length) sig.push({ code: 'needs_practice', n: np.length, skill: clone(byId('skills', np[0].skillId).title) });
        const open = ue.filter(e => !e.completedAt);
        if (open.length) {
          const acts = [...db.attempts.filter(t => t.userId === u.id).map(t => t.startedAt), ...db.progress.filter(p => p.userId === u.id).map(p => p.completedAt).filter(Boolean), ...ue.map(e => e.startedAt).filter(Boolean)];
          const last = acts.length ? Math.max(...acts.map(Date.parse)) : Math.min(...open.map(e => Date.parse(e.assignedAt)));
          if (now() - last > th.inactiveDays * DAY) sig.push({ code: 'inactive', days: Math.floor((now() - last) / DAY) });
        }
        if (sig.length >= th.minSignals) support.push({ userId: u.id, name: clone(u.name), locationId: u.locationId, signals: sig });
      });

      const review = db.courses.filter(c => c.status === 'published').map(c => ({ courseId: c.id, title: clone(c.title), version: c.version, reviewDue: c.reviewDue, status: reviewStatus(c) }));

      return {
        filters: clone(f), people: users.length,
        completionRate: { value: pct(done.length, ens.length), num: done.length, den: ens.length },
        overdue: { value: overdue.length, den: ens.length },
        avgScore: { value: best.length ? Math.round(best.reduce((x, y) => x + y, 0) / best.length) : null, n: best.length },
        passRate: { value: pct(passedPairs, pairList.length), num: passedPairs, den: pairList.length },
        firstAttemptPass: { value: pct(firstPass, pairList.length), num: firstPass, den: pairList.length },
        retakes: { value: retakes, attempts: atts.length },
        medianDays: { value: days.length ? Math.round(median(days) * 10) / 10 : null, n: days.length },
        signoffs: { ...so, total: soTotal, value: pct(so.passed, soTotal) },
        byCourse, bySection, byPerson, support, review, thresholds: clone(th)
      };
    }

    function exportReport(actorId, report, f = {}, lang = 'en') {
      const a = actorOf(actorId); need(a, 'reports.export');
      const k = kpis(actorId, f);
      const L = o => (o ? o[lang] || o.en : '');
      const loc = id => L((byId('locations', id) || {}).name);
      const day = dateOnly(now());
      let header, rows;
      if (report === 'people') {
        header = ['Name', 'Location', 'Assigned', 'Completed', 'Completion %', 'Overdue', 'Average best score %', 'Exam attempts'];
        rows = k.byPerson.map(r => [L(r.name), loc(r.locationId), r.assigned, r.completed, r.rate, r.overdue, r.avgScore, r.attempts]);
      } else if (report === 'courses') {
        header = ['Course', 'Version', 'Assigned', 'Completed', 'Completion %', 'Overdue', 'Average best score %'];
        rows = k.byCourse.map(r => [L(r.title), r.version, r.assigned, r.completed, r.rate, r.overdue, r.avgScore]);
      } else if (report === 'sections') {
        header = ['Course', 'Section', 'Enrolled', 'Started', 'Completed', 'Completion %'];
        rows = k.bySection.map(r => [L(r.course), r.pos + '. ' + L(r.title), r.enrolled, r.started, r.completed, r.rate]);
      } else if (report === 'support') {
        header = ['Name', 'Location', 'Signals'];
        rows = k.support.map(r => [L(r.name), loc(r.locationId), r.signals.map(s => s.code).join('; ')]);
      } else throw new ApiError('invalid', 'Unknown report.');
      const rec = { id: nextId('x'), kind: 'report', report, format: 'csv', filters: clone(f), by: a.id, status: 'succeeded', destination: 'download', rows: rows.length, error: null, attempts: 1, startedAt: iso(now()), finishedAt: iso(now()) };
      db.exports.unshift(rec);
      audit(a, 'report.export', 'export', rec.id, null, { report, rows: rows.length, filters: f });
      return { filename: `training-${report}-${day}.csv`, csv: toCSV(header, rows), rows: rows.length, kpis: k };
    }

    function exportToDrive(actorId, report, f = {}) {
      const a = actorOf(actorId); need(a, 'reports.export');
      const rec = { id: nextId('x'), kind: 'report', report, format: 'csv', filters: clone(f), by: a.id, status: 'running', destination: 'drive', rows: null, error: null, attempts: 0, startedAt: iso(now()), finishedAt: null, driveFile: null };
      db.exports.unshift(rec);
      runExport(a, rec);
      return clone(rec);
    }

    function runExport(a, rec) {
      rec.attempts += 1; rec.startedAt = iso(now());
      const drive = db.integrations.drive;
      // The database stays the primary record; a failed export changes nothing else.
      if (!drive.connected || !drive.reportsFolder) {
        Object.assign(rec, { status: 'failed', error: 'drive_not_connected', finishedAt: iso(now()) });
      } else if (db.sim.driveDown) {
        Object.assign(rec, { status: 'failed', error: 'drive_unavailable', finishedAt: iso(now()) });
      } else {
        const name = rec.kind === 'backup' ? `backup-${dateOnly(now())}.json` : `training-${rec.report}-${dateOnly(now())}.csv`;
        let rows = 0;
        if (rec.kind === 'report') rows = exportReport(a.id, rec.report, rec.filters).rows, db.exports.shift();
        else rows = db.users.length;
        Object.assign(rec, { status: 'succeeded', error: null, finishedAt: iso(now()), rows, driveFile: { name, folder: rec.kind === 'backup' ? drive.backupsFolder : drive.reportsFolder } });
      }
      audit(a, rec.kind + '.drive_export', 'export', rec.id, null, { status: rec.status, error: rec.error, attempt: rec.attempts });
    }

    function retryExport(actorId, exportId) {
      const a = actorOf(actorId);
      const rec = byId('exports', exportId); if (!rec) throw new ApiError('not_found');
      need(a, rec.kind === 'backup' ? 'data.backup' : 'reports.export');
      if (rec.by !== a.id && !scopeOf(a).global) throw new ApiError('not_found');
      if (rec.status !== 'failed') throw new ApiError('conflict', 'Only failed exports can be retried.');
      rec.status = 'running'; runExport(a, rec);
      return clone(rec);
    }

    function listExports(actorId) {
      const a = actorOf(actorId);
      if (!has(a, 'reports.export') && !has(a, 'data.backup')) throw new ApiError('forbidden_role');
      return db.exports.filter(x => (x.kind === 'backup' ? has(a, 'data.backup') : (scopeOf(a).global || x.by === a.id))).map(clone);
    }

    function runBackup(actorId) {
      const a = actorOf(actorId); need(a, 'data.backup');
      const rec = { id: nextId('x'), kind: 'backup', report: null, format: 'json', filters: null, by: a.id, status: 'running', destination: 'drive', rows: null, error: null, attempts: 0, startedAt: iso(now()), finishedAt: null };
      db.exports.unshift(rec); runExport(a, rec); return clone(rec);
    }

    function fullExport(actorId) {
      const a = actorOf(actorId); need(a, 'data.backup');
      const data = clone(db);
      delete data.sim;
      delete data.loginAttempts;
      (data.users || []).forEach(u => { delete u.auth; });
      // Secrets never leave the server; the export holds data only.
      if (data.integrations && data.integrations.drive) delete data.integrations.drive.token;
      audit(a, 'data.full_export', 'system', null, null, { tables: Object.keys(data).length });
      return { filename: `training-full-export-${dateOnly(now())}.json`, json: JSON.stringify(data, null, 2) };
    }

    /* ---------- reminders ---------- */

    function listRules(actorId) {
      const a = actorOf(actorId); need(a, 'reminders.manage');
      const s = scopeOf(a);
      return db.rules.filter(r => s.global || r.createdBy === a.id).map(clone);
    }

    function saveRule(actorId, d) {
      const a = actorOf(actorId); need(a, 'reminders.manage');
      if (!['assigned', 'due_soon', 'overdue'].includes(d.trigger)) throw new ApiError('invalid', 'Pick a trigger.');
      const days = Number(d.days || 0), every = Number(d.every || 0), max = Number(d.max || 1);
      if (!(days >= 0 && days <= 60) || !(every >= 0 && every <= 30) || !(max >= 1 && max <= 10)) throw new ApiError('invalid', 'Check the numbers.');
      if (d.trigger === 'overdue' && max > 1 && every < 1) throw new ApiError('invalid', 'Set how many days between repeats.');
      const tpl = i18nField(d.template, true);
      const s = scopeOf(a);
      const r = {
        id: d.id || nextId('rr'), trigger: d.trigger, days, every, max, channels: (d.channels || ['in_app']).filter(c => ['in_app', 'email'].includes(c)),
        template: tpl, active: d.active !== false, createdBy: a.id,
        scope: s.global ? null : { locations: [...s.locations], teams: [...s.teams], users: [...s.users] }
      };
      const ex = d.id ? byId('rules', d.id) : null;
      if (ex) {
        if (!s.global && ex.createdBy !== a.id) throw new ApiError('not_found');
        const before = clone(ex); Object.assign(ex, r, { createdBy: ex.createdBy }); audit(a, 'reminder.update', 'reminder_rule', ex.id, before, ex);
        return clone(ex);
      }
      db.rules.push(r); audit(a, 'reminder.create', 'reminder_rule', r.id, null, r); return clone(r);
    }

    function fill(tpl, vars) { return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)); }

    // Runs daily on the server (pg_cron). Safe to run repeatedly: the reminder log and
    // notification keys prevent duplicates, and each person gets at most one reminder a day.
    function runReminders(actorId) {
      let a = null;
      if (actorId) { a = actorOf(actorId); need(a, 'reminders.manage'); }
      const t = now(); const today = dateOnly(t);
      let created = 0, skipped = 0, emailQueued = 0;
      const sentToday = new Set(db.notifications.filter(n => n.kind === 'reminder' && n.at.slice(0, 10) === today).map(n => n.userId));
      db.rules.filter(r => r.active).forEach(r => {
        db.enrollments.filter(e => e.active && !e.completedAt).forEach(e => {
          const u = user(e.userId); if (!u || u.status !== 'active') return;
          if (r.scope && !(r.scope.locations.includes(u.locationId) || r.scope.teams.includes(u.teamId) || r.scope.users.includes(u.id))) return;
          let due = false;
          if (r.trigger === 'assigned') due = t >= Date.parse(e.assignedAt) + r.days * DAY;
          if (r.trigger === 'due_soon') due = e.dueOn && t >= endOfDay(e.dueOn) - r.days * DAY && t <= endOfDay(e.dueOn);
          if (r.trigger === 'overdue') due = e.dueOn && t > endOfDay(e.dueOn) + r.days * DAY;
          if (!due) return;
          const log = db.reminderLog.filter(l => l.ruleId === r.id && l.enrollmentId === e.id);
          if (log.length >= r.max) return;
          if (log.length && (!r.every || t - Date.parse(log[log.length - 1].at) < r.every * DAY)) return;
          if (sentToday.has(u.id)) { skipped++; return; }
          const c = byId('courses', e.courseId);
          const vars = l => ({ name: (u.name[l] || u.name.en).split(' ')[0], course: c.title[l], due: humanDate(e.dueOn, l) });
          const n = notify(u.id, 'reminder', { en: 'Training reminder', ar: 'تذكير بالتدريب' }, { en: fill(r.template.en, vars('en')), ar: fill(r.template.ar, vars('ar')) }, 'course:' + c.id, `rem:${r.id}:${e.id}:${log.length + 1}`);
          if (!n) { skipped++; return; }
          db.reminderLog.push({ ruleId: r.id, enrollmentId: e.id, n: log.length + 1, at: iso(t), channels: r.channels.slice() });
          sentToday.add(u.id); created++;
          if (r.channels.includes('email') && db.integrations.email.provider) emailQueued++;
        });
      });
      if (a) audit(a, 'reminder.run', 'system', null, null, { created, skipped, emailQueued });
      return { created, skipped, emailQueued };
    }

    /* ---------- issues, FAQ ---------- */

    function listIssues(actorId) {
      const a = actorOf(actorId); need(a, 'issues.manage');
      return db.issues.filter(i => (!i.courseId || courseInScope(a, i.courseId))).map(i => ({ ...clone(i), reporter: clone((user(i.userId) || {}).name), course: clone((byId('courses', i.courseId) || {}).title), section: clone((byId('sections', i.sectionId) || {}).title) }));
    }
    function resolveIssue(actorId, issueId, note) {
      const a = actorOf(actorId); need(a, 'issues.manage');
      const i = byId('issues', issueId); if (!i) throw new ApiError('not_found');
      if (i.courseId && !courseInScope(a, i.courseId)) throw new ApiError('forbidden_scope');
      const before = clone(i); Object.assign(i, { status: 'resolved', resolvedBy: a.id, note: clean(note) });
      notify(i.userId, 'issue', { en: 'Your report was resolved', ar: 'تمت معالجة بلاغك' }, { en: clean(note) || 'Thank you for reporting it.', ar: clean(note) || 'شكرًا على البلاغ.' }, null, 'issue:' + i.id);
      audit(a, 'issue.resolve', 'issue', i.id, before, i); return clone(i);
    }
    function saveFaq(actorId, d) {
      const a = actorOf(actorId); need(a, 'faq.manage');
      const f = { id: d.id || nextId('fq'), q: i18nField(d.q, true), a: i18nField(d.a, true), tags: (d.tags || []).map(clean).filter(Boolean) };
      const ex = d.id && byId('faqs', d.id);
      if (ex) { const before = clone(ex); Object.assign(ex, f); audit(a, 'faq.update', 'faq', f.id, before, ex); }
      else { db.faqs.push(f); audit(a, 'faq.create', 'faq', f.id, null, f); }
      return clone(f);
    }
    function deleteFaq(actorId, id) {
      const a = actorOf(actorId); need(a, 'faq.manage');
      const f = byId('faqs', id); if (!f) throw new ApiError('not_found');
      db.faqs = db.faqs.filter(x => x.id !== id); audit(a, 'faq.delete', 'faq', id, f, null); return true;
    }

    /* ---------- settings, integrations, audit ---------- */

    const SETTING_GROUPS = {
      training: ['certificateLine', 'sequential', 'defaultDueDays', 'cardMinSeconds'],
      kpi: ['kpi'],
      system: ['business', 'certPrefix', 'defaultLang', 'retention', 'privacy']
    };

    function getSettings(actorId) {
      actorOf(actorId);
      return clone(db.settings);
    }

    function updateSettings(actorId, group, patch) {
      const a = actorOf(actorId);
      const perm = { training: 'settings.training', kpi: 'settings.kpi', system: 'settings.system' }[group];
      if (!perm) throw new ApiError('invalid');
      need(a, perm);
      const before = clone(db.settings);
      Object.keys(patch).forEach(k => {
        if (!SETTING_GROUPS[group].includes(k)) throw new ApiError('forbidden_role', `"${k}" is not part of ${group} settings.`);
      });
      if (patch.kpi) {
        const k = patch.kpi; const rng = (v, lo, hi) => Number(v) >= lo && Number(v) <= hi;
        if (!rng(k.overdueDays, 0, 60) || !rng(k.failedAttempts, 1, 10) || !rng(k.lowAverage, 1, 100) || !rng(k.needsPracticeDays, 1, 90) || !rng(k.inactiveDays, 1, 90) || !rng(k.minSignals, 2, 5))
          throw new ApiError('invalid', 'A threshold is out of range. Support flags need at least 2 signals.');
        patch.kpi = Object.fromEntries(Object.entries(k).map(([x, v]) => [x, Number(v)]));
      }
      if (patch.retention) {
        const r = patch.retention;
        if (!(Number(r.inactiveUserYears) >= 1 && Number(r.inactiveUserYears) <= 10) || !(Number(r.auditYears) >= 1 && Number(r.auditYears) <= 10)) throw new ApiError('invalid', 'Retention must be 1 to 10 years.');
      }
      if (patch.certPrefix && !/^[A-Z0-9]{2,6}$/.test(String(patch.certPrefix).toUpperCase())) throw new ApiError('invalid', 'Prefix: 2 to 6 letters or digits.');
      if ('cardMinSeconds' in patch) { const n = Number(patch.cardMinSeconds); if (!(n >= 0 && n <= 120)) throw new ApiError('invalid', 'Seconds per card: 0 to 120.'); patch.cardMinSeconds = n; }
      Object.assign(db.settings, clone(patch));
      audit(a, 'settings.' + group, 'settings', group, before, db.settings);
      return clone(db.settings);
    }

    function getIntegrations(actorId) {
      const a = actorOf(actorId);
      const d = clone(db.integrations); delete d.drive.token;
      return { ...d, canManage: has(a, 'integrations.manage'), driveDown: db.sim.driveDown };
    }

    function connectDrive(actorId, d) {
      const a = actorOf(actorId); need(a, 'integrations.manage');
      const before = clone(db.integrations.drive); delete before.token;
      Object.assign(db.integrations.drive, { connected: true, account: clean(d.account) || 'training@btw.example', by: a.id, at: iso(now()), reportsFolder: d.reportsFolder || db.integrations.drive.reportsFolder, backupsFolder: d.backupsFolder || db.integrations.drive.backupsFolder, scope: 'drive.file', token: 'vault://drive-refresh-token' });
      const after = clone(db.integrations.drive); delete after.token;
      audit(a, 'integration.drive_connect', 'integration', 'drive', before, after);
      return after;
    }
    function disconnectDrive(actorId) {
      const a = actorOf(actorId); need(a, 'integrations.manage');
      Object.assign(db.integrations.drive, { connected: false, token: null });
      audit(a, 'integration.drive_disconnect', 'integration', 'drive', null, { connected: false });
      return true;
    }
    function setEmailProvider(actorId, provider) {
      const a = actorOf(actorId); need(a, 'integrations.manage');
      db.integrations.email.provider = provider || null;
      audit(a, 'integration.email', 'integration', 'email', null, { provider: provider || null });
      return true;
    }
    function simulateDriveOutage(actorId, on) {
      const a = actorOf(actorId); need(a, 'integrations.manage');
      db.sim.driveDown = !!on; return db.sim.driveDown;
    }

    function listAudit(actorId, f = {}) {
      const a = actorOf(actorId); need(a, 'audit.view');
      const q = clean(f.q).toLowerCase();
      return db.audit.filter(x => (!f.entity || x.entity === f.entity) && (!q || JSON.stringify(x).toLowerCase().includes(q))).slice(0, f.limit || 200).map(clone);
    }

    /* ---------- search ---------- */

    function search(actorId, q) {
      const a = actorOf(actorId);
      const term = clean(q).toLowerCase();
      if (term.length < 2) return { people: [], courses: [], sections: [], certificates: [] };
      const m = (...xs) => xs.join(' ').toLowerCase().includes(term);
      const people = has(a, 'users.view') ? db.users.filter(u => userInScope(a, u) && m(u.name.en, u.name.ar, u.email, u.code)).slice(0, 8).map(u => ({ id: u.id, name: u.name, role: u.role, locationId: u.locationId })) : [];
      const enrolled = new Set(activeEnrollments(a.id).map(e => e.courseId));
      const manageCourses = ['content.edit', 'assign.manage', 'reports.view'].some(p => has(a, p));
      const courses = db.courses.filter(c => (enrolled.has(c.id) || (manageCourses && courseInScope(a, c.id))) && m(c.title.en, c.title.ar, c.code)).slice(0, 8).map(c => ({ id: c.id, title: c.title, status: c.status, manage: !enrolled.has(c.id) }));
      const sections = db.sections.filter(s => (enrolled.has(s.courseId) || (manageCourses && courseInScope(a, s.courseId))) && m(s.title.en, s.title.ar)).slice(0, 8).map(s => ({ id: s.id, courseId: s.courseId, title: s.title, course: (byId('courses', s.courseId) || {}).title, manage: !enrolled.has(s.courseId) }));
      const certificates = db.certs.filter(c => (c.userId === a.id || (has(a, 'certs.view') && userInScope(a, user(c.userId)))) && m(c.no, c.holder.en, c.holder.ar, c.courseTitle.en, c.courseTitle.ar)).slice(0, 8).map(c => ({ id: c.id, no: c.no, holder: c.holder, courseTitle: c.courseTitle, status: c.status, own: c.userId === a.id }));
      return { people, courses, sections, certificates };
    }

    /* ---------- the person's own copy (live site) ---------- */

    // Permissions that let someone see the people in their scope and their training records.
    const PEOPLE_PERMS = ['users.view', 'users.edit', 'users.deactivate', 'users.import', 'users.remove', 'users.role', 'access.grant', 'progress.view', 'reports.view', 'reports.export', 'signoff.manage', 'certs.view', 'certs.reissue', 'certs.revoke', 'assign.manage', 'records.correct', 'reminders.manage'];
    const COURSE_PERMS = ['content.edit', 'content.publish', 'files.manage', 'exams.manage', 'assign.manage', 'reports.view', 'issues.manage', 'progress.view', 'signoff.manage', 'certs.view'];

    // Everything one signed-in person may read, in the same shape as the full data, so the browser can
    // run the same read functions locally. Nothing else leaves the server: no password hashes, no other
    // people's notifications, no records outside their scope, and no correct answers unless they edit
    // that exam. Every change is still sent to the server and checked again there.
    function scopedView(actorId) {
      const a = actorOf(actorId);
      const P = permsOf(a);
      const any = list => list.some(p => P.has(p));
      const s = scopeOf(a);
      const manager = P.size > 0;
      const full = new Set([a.id]);
      if (any(PEOPLE_PERMS)) db.users.forEach(u => { if (userInScope(a, u)) full.add(u.id); });
      const enrolledCourses = new Set(db.enrollments.filter(e => full.has(e.userId)).map(e => e.courseId));
      const manageCourse = c => manager && any(COURSE_PERMS) && (courseInScope(a, c.id) || P.has('assign.manage'));
      const content = new Set(db.courses.filter(c => enrolledCourses.has(c.id) || manageCourse(c)).map(c => c.id));
      const courses = db.courses.filter(c => content.has(c.id) || (manager && any(COURSE_PERMS.concat(PEOPLE_PERMS))));
      const sectionIds = new Set(db.sections.filter(x => content.has(x.courseId)).map(x => x.id));

      const examView = ex => {
        if (P.has('exams.manage') && courseInScope(a, ex.courseId)) return clone(ex);
        const base = { id: ex.id, courseId: ex.courseId, sectionId: ex.sectionId, kind: ex.kind, title: clone(ex.title), passPct: ex.passPct, timeLimitMin: ex.timeLimitMin, maxAttempts: ex.maxAttempts, allowRetake: ex.allowRetake, review: ex.review, shuffle: ex.shuffle };
        if (manageCourse(byId('courses', ex.courseId) || {})) return { ...base, questions: ex.questions.map(q => ({ id: q.id, type: q.type, prompt: clone(q.prompt), choices: q.choices.map(c => ({ id: c.id, text: clone(c.text) })) })) };
        return { ...base, questions: ex.questions.map(q => ({ id: q.id })) };
      };

      const mine = list => db[list].filter(x => full.has(x.userId)).map(clone);
      const out = {
        meta: { schema: db.meta.schema, me: a.id, scoped: true },
        settings: clone(db.settings),
        locations: db.locations.map(clone), teams: db.teams.map(clone),
        users: db.users.filter(u => full.has(u.id)).map(pub),
        grants: {},
        loginAttempts: [],
        courses: courses.map(clone),
        versions: db.versions.filter(v => content.has(v.courseId)).map(clone),
        sections: db.sections.filter(x => content.has(x.courseId)).map(clone),
        files: db.files.filter(f => sectionIds.has(f.sectionId)).map(clone),
        exams: db.exams.filter(x => content.has(x.courseId)).map(examView),
        skills: db.skills.filter(k => content.has(k.courseId)).map(clone),
        assignments: P.has('assign.manage') ? db.assignments.filter(g => s.global || g.assignedBy === a.id || (g.target.kind === 'location' && s.locations.has(g.target.id)) || (g.target.kind === 'team' && s.teams.has(g.target.id))).map(clone) : [],
        enrollments: mine('enrollments'), progress: mine('progress'), attempts: mine('attempts'), signoffs: mine('signoffs'), certs: mine('certs'), corrections: mine('corrections'),
        notifications: db.notifications.filter(n => n.userId === a.id).map(clone),
        rules: P.has('reminders.manage') ? db.rules.filter(r => s.global || r.createdBy === a.id).map(clone) : [],
        reminderLog: [],
        issues: db.issues.filter(i => i.userId === a.id || (P.has('issues.manage') && (!i.courseId || courseInScope(a, i.courseId)))).map(clone),
        faqs: db.faqs.map(clone),
        exports: (P.has('reports.export') || P.has('data.backup')) ? db.exports.filter(x => (x.kind === 'backup' ? P.has('data.backup') : (s.global || x.by === a.id))).map(clone) : [],
        integrations: { drive: (() => { const d = clone(db.integrations.drive); delete d.token; return d; })(), email: clone(db.integrations.email) },
        audit: P.has('audit.view') ? db.audit.slice(0, 500).map(clone) : [],
        sim: { driveDown: false }
      };
      Object.keys(db.grants).forEach(id => { if (id === a.id || P.has('access.grant') || P.has('users.role')) out.grants[id] = clone(db.grants[id]); });

      // Names for people mentioned in visible records (who signed off, published, resolved…), nothing more.
      const ref = new Set();
      const addRef = id => { if (id && typeof id === 'string' && !full.has(id)) ref.add(id); };
      out.signoffs.forEach(x => addRef(x.by));
      out.certs.forEach(x => { addRef(x.revokedBy); addRef(x.issuedBy); });
      out.versions.forEach(x => addRef(x.publishedBy));
      out.issues.forEach(x => { addRef(x.userId); addRef(x.resolvedBy); });
      out.assignments.forEach(x => addRef(x.assignedBy));
      out.corrections.forEach(x => addRef(x.by));
      out.exports.forEach(x => addRef(x.by));
      out.rules.forEach(x => addRef(x.createdBy));
      out.files.forEach(x => addRef(x.addedBy));
      out.courses.forEach(x => { addRef(x.createdBy); addRef(x.updatedBy); });
      Object.keys(out.grants).forEach(id => { addRef(id); addRef(out.grants[id].updatedBy); });
      out.audit.forEach(x => { addRef(x.actorId); if (x.entity === 'user') addRef(x.entityId); });
      ref.forEach(id => { const u = user(id); if (u) out.users.push({ id: u.id, name: clone(u.name), role: u.role, status: u.status, stub: true }); });
      return out;
    }

    // What the sign-in page may show before anyone signs in.
    function publicInfo() {
      return {
        needsSetup: needsSetup(),
        settings: { business: clone(db.settings.business), privacy: clone(db.settings.privacy), defaultLang: db.settings.defaultLang, certPrefix: db.settings.certPrefix, cardMinSeconds: db.settings.cardMinSeconds }
      };
    }

    // Storage keys of uploaded card PDFs that are still in use.
    const referencedPaths = () => new Set(db.files.filter(f => f.path).map(f => f.path));

    return {
      // identity
      me, check, verifyCertificate, login, setPassword, changeOwnPassword, needsSetup, setupAdmin, recoverAdmin, findLogin: id => pub(findLogin(id)), publicInfo,
      // learner
      learnerHome, learnerCourse, cardState, canViewFile, markFileViewed, completeSection, startAttempt, submitAttempt, myCertificates, getCertificate, mySkills, reportIssue, markNotificationsRead, listFaqs,
      // people
      listUsers, getUser, createUser, updateUser, setUserStatus, removeUser, previewImport, commitImport, getGrant, setGrant, listLocations, saveLocation, saveTeam,
      // content
      listCoursesManage, getCourseManage, createCourse, updateCourse, duplicateCourse, publishCourse, setCourseStatus, deleteCourse, saveSection, moveSection, removeSection, addFiles, addCards, moveFile, replaceFile, renameFile, removeFile, saveExam, removeExam,
      // training records
      assign, listAssignments, listSignoffs, setSignoff, listCerts, revokeCert, reissueCert, correctRecord,
      // reports
      kpis, exportReport, exportToDrive, retryExport, listExports, runBackup, fullExport,
      // reminders, support
      listRules, saveRule, runReminders, listIssues, resolveIssue, saveFaq, deleteFaq,
      // settings
      getSettings, updateSettings, getIntegrations, connectDrive, disconnectDrive, setEmailProvider, simulateDriveOutage, listAudit, search,
      // live site
      scopedView, referencedPaths,
      // internals for the UI and tests
      _db: db, _status: enrollmentStatus, _raw: { findLogin, user }
    };
  }

  /* ------------------------------------------------------------------ */
  /* A fresh installation: no people, no courses. The owner creates the  */
  /* first Admin on the setup screen; everything else is added in-app.   */
  /* ------------------------------------------------------------------ */

  function seed(nowMs) {
    const T = nowMs || Date.now();
    const L = (en, ar) => ({ en, ar });
    return {
      meta: { schema: 5, seq: 1000, seededAt: new Date(T).toISOString() },
      settings: {
        business: L('By The Way', 'باي ذا واي'), certPrefix: 'BTW', defaultLang: 'ar', sequential: false, defaultDueDays: 14, cardMinSeconds: 5,
        certificateLine: L('has successfully completed the training programme', 'أتمّ بنجاح البرنامج التدريبي'),
        kpi: { overdueDays: 7, failedAttempts: 2, lowAverage: 70, needsPracticeDays: 14, inactiveDays: 14, minSignals: 2 },
        retention: { inactiveUserYears: 3, auditYears: 5 },
        privacy: L(
          'We store your name, work email or phone, employee code, branch, team, role and job title, plus your training activity: cards viewed, sections completed, exam attempts and scores, practical sign-offs and certificates. We use it only to run and report on training. Your manager sees it only for the branches and teams they are responsible for. Records of people who leave are kept for the period set by your employer, then deleted. Ask your Admin to see or correct your data.',
          'نحفظ اسمك وبريد العمل أو الجوال والرقم الوظيفي والفرع والفريق والدور والمسمى الوظيفي، إضافة إلى نشاطك التدريبي: البطاقات التي اطّلعت عليها والأقسام المكتملة ومحاولات الاختبار والدرجات واعتمادات المهارات والشهادات. نستخدمها لإدارة التدريب وتقاريره فقط. لا يطّلع عليها مديرك إلا للفروع والفرق التي يتولاها. تُحفظ سجلات من يغادر العمل للمدة التي تحددها جهة العمل ثم تُحذف. تواصل مع مسؤول النظام لعرض بياناتك أو تصحيحها.')
      },
      locations: [], teams: [],
      users: [], grants: {}, loginAttempts: [], courses: [], versions: [], sections: [], files: [], exams: [], assignments: [], enrollments: [], progress: [], attempts: [],
      skills: [], signoffs: [], certs: [], notifications: [], rules: [
        { id: 'rr1', trigger: 'assigned', days: 0, every: 0, max: 1, channels: ['in_app'], template: L('Hi {name}, {course} is waiting for you. Due {due}.', 'مرحبًا {name}، دورة {course} بانتظارك. الموعد النهائي {due}.'), active: true, createdBy: null, scope: null },
        { id: 'rr2', trigger: 'due_soon', days: 3, every: 0, max: 1, channels: ['in_app'], template: L('{course} is due on {due}. You can finish it in one shift.', 'موعد إنهاء {course} هو {due}. يمكنك إنهاؤها في وردية واحدة.'), active: true, createdBy: null, scope: null },
        { id: 'rr3', trigger: 'overdue', days: 1, every: 7, max: 3, channels: ['in_app'], template: L('{course} is overdue since {due}. Talk to your manager if you need time on shift.', 'دورة {course} متأخرة منذ {due}. تحدّث مع مديرك إن احتجت وقتًا خلال الوردية.'), active: true, createdBy: null, scope: null }
      ],
      reminderLog: [], issues: [], faqs: [], corrections: [], exports: [],
      integrations: {
        drive: { connected: false, account: null, by: null, at: null, reportsFolder: null, backupsFolder: null, scope: 'drive.file', token: null },
        email: { provider: null }
      },
      audit: [], sim: { driveDown: false }
    };
  }

  // Older saved copies are brought up to the current shape without losing records.
  function upgrade(db) {
    if (!db || !db.meta) return db;
    db.settings = db.settings || {};
    if (db.settings.cardMinSeconds == null) db.settings.cardMinSeconds = 5;
    ['loginAttempts', 'reminderLog', 'corrections', 'exports', 'audit'].forEach(k => { if (!Array.isArray(db[k])) db[k] = []; });
    db.sim = db.sim || { driveDown: false };
    if ((db.meta.schema || 0) < 5) db.meta.schema = 5;
    return db;
  }

  const _internals = { makeAuthWith, mulberry32, humanDate };

  return {
    createBackend, seed, upgrade, sha256, hashPassword, validatePassword, ROLES, RANK, ROLE_LABEL, PERMISSIONS, ROLE_PERMS, GRANTABLE, ApiError, parseCSV, toCSV,
    MUTATIONS, SERVER_READS, LIVE_UNAVAILABLE, SCHEMA: 5,
    IMPORT_COLUMNS: ['employee_code', 'full_name_en', 'full_name_ar', 'email', 'phone', 'location', 'team', 'job_title', 'role'],
    _internals
  };
});
