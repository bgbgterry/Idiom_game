/**
 * js/storage.js
 * StorageManager: Multi-Challenger Cookie + localStorage Dual-Layer Persistence
 * Complies strictly with:
 *   - document.cookie (expires=365 days, path=/, SameSite=Lax)
 *   - 4KB Cookie capacity safeguard with compact encoding
 *   - Instant switching between multiple Challenger profiles
 */

const COOKIE_CHALLENGERS = 'ig_challengers';
const COOKIE_ACTIVE = 'ig_active';
const LS_PREFIX = 'idiom_game_profile_';
const AVATARS = ['⚡', '🔥', '👾', '🦊', '🐱‍👤', '🚀', '💎', '👑', '🎧', '🦖'];

export class StorageManager {
  constructor() {
    this._initDefaultIfNeeded();
  }

  // ==========================================================================
  // Low-level Cookie Helpers (365 days, path=/, SameSite=Lax)
  // ==========================================================================
  setCookie(name, value, days = 365) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    const encoded = encodeURIComponent(value);
    document.cookie = `${name}=${encoded}; expires=${expires}; path=/; SameSite=Lax`;
  }

  getCookie(name) {
    const target = `${name}=`;
    const parts = document.cookie ? document.cookie.split('; ') : [];
    for (const part of parts) {
      if (part.indexOf(target) === 0) {
        try {
          return decodeURIComponent(part.substring(target.length));
        } catch {
          return part.substring(target.length);
        }
      }
    }
    return null;
  }

  deleteCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
  }

  _safeKey(name) {
    // Convert challenger name to short alphanumeric/hex suffix for cookie keys
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash << 5) - hash + name.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  // ==========================================================================
  // Challenger Roster & Active Challenger Management
  // ==========================================================================
  _initDefaultIfNeeded() {
    let challengers = this.getChallengers();
    let active = this.getCookie(COOKIE_ACTIVE) || localStorage.getItem(COOKIE_ACTIVE);

    if (!challengers || challengers.length === 0) {
      const defaultName = '會考戰神01';
      challengers = [{ name: defaultName, avatar: '⚡', createdAt: Date.now() }];
      this._saveChallengersList(challengers);
      this.setActiveChallenger(defaultName);
      this._ensureProfile(defaultName, '⚡');
    } else if (!active || !challengers.some((c) => c.name === active)) {
      this.setActiveChallenger(challengers[0].name);
    } else {
      // Sync cookie & localStorage
      this.setActiveChallenger(active);
    }
  }

  getChallengers() {
    const rawCookie = this.getCookie(COOKIE_CHALLENGERS);
    const rawLS = localStorage.getItem(COOKIE_CHALLENGERS);
    const source = rawCookie || rawLS;
    if (!source) return [];
    try {
      const parsed = JSON.parse(source);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _saveChallengersList(list) {
    const json = JSON.stringify(list);
    this.setCookie(COOKIE_CHALLENGERS, json, 365);
    localStorage.setItem(COOKIE_CHALLENGERS, json);
  }

  getActiveChallengerName() {
    return (
      this.getCookie(COOKIE_ACTIVE) ||
      localStorage.getItem(COOKIE_ACTIVE) ||
      '會考戰神01'
    );
  }

  setActiveChallenger(name) {
    const clean = String(name || '').trim();
    if (!clean) return;
    this.setCookie(COOKIE_ACTIVE, clean, 365);
    localStorage.setItem(COOKIE_ACTIVE, clean);
    this._ensureProfile(clean);
  }

  createChallenger(name, avatar = null) {
    const clean = String(name || '').trim().slice(0, 16);
    if (!clean) return { ok: false, message: '請輸入挑戰者名稱！' };

    const list = this.getChallengers();
    const existing = list.find((c) => c.name === clean);
    const chosenAvatar =
      avatar || AVATARS[list.length % AVATARS.length];

    if (!existing) {
      list.push({ name: clean, avatar: chosenAvatar, createdAt: Date.now() });
      this._saveChallengersList(list);
    }
    this._ensureProfile(clean, chosenAvatar);
    this.setActiveChallenger(clean);
    return { ok: true, name: clean };
  }

  deleteChallenger(name) {
    let list = this.getChallengers();
    if (list.length <= 1) {
      return { ok: false, message: '至少需保留一位挑戰者檔案！' };
    }
    list = list.filter((c) => c.name !== name);
    this._saveChallengersList(list);

    const sk = this._safeKey(name);
    this.deleteCookie(`ig_prog_${sk}`);
    this.deleteCookie(`ig_wq_${sk}`);
    localStorage.removeItem(`${LS_PREFIX}${name}`);

    if (this.getActiveChallengerName() === name) {
      this.setActiveChallenger(list[0].name);
    }
    return { ok: true, active: this.getActiveChallengerName() };
  }

  // ==========================================================================
  // Challenger Profile Read / Write (Dual Cookie + localStorage)
  // ==========================================================================
  _createEmptyProfile(name, avatar = '⚡') {
    return {
      name,
      avatar,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      levelScores: {}, // { "1": 95, "2": 80, ... }
      levelAttempts: {}, // { "1": 2, ... }
      stats: {
        totalQuizzes: 0,
        totalAnswered: 0,
        totalCorrect: 0,
        maxCombo: 0,
      },
      // Keyed by targetIdiom so each idiom's wrong history & custom note are unified
      wrongQuestions: {},
      customNotes: {},
    };
  }

  _ensureProfile(name, avatar = '⚡') {
    const profile = this.getProfile(name, avatar);
    this.saveProfile(profile);
    return profile;
  }

  getProfile(name = null, fallbackAvatar = '⚡') {
    const targetName = name || this.getActiveChallengerName();
    const sk = this._safeKey(targetName);
    const challengerMeta =
      this.getChallengers().find((c) => c.name === targetName) || {};
    const avatar = challengerMeta.avatar || fallbackAvatar;

    // 1. Read full profile from localStorage if available
    let profile = null;
    const rawLS = localStorage.getItem(`${LS_PREFIX}${targetName}`);
    if (rawLS) {
      try {
        profile = JSON.parse(rawLS);
      } catch {
        profile = null;
      }
    }
    if (!profile) {
      profile = this._createEmptyProfile(targetName, avatar);
    }

    // 2. Reconcile level progress summary from Cookie (`ig_prog_<sk>`)
    // Format: "s1,s2,...,s20|totalQuizzes,totalAnswered,totalCorrect,maxCombo"
    const progCookie = this.getCookie(`ig_prog_${sk}`);
    if (progCookie) {
      try {
        const [scoresPart, statsPart] = progCookie.split('|');
        if (scoresPart) {
          const scoresArr = scoresPart.split(',').map((n) => parseInt(n, 10) || 0);
          scoresArr.forEach((sc, idx) => {
            const lvl = idx + 1;
            if (sc > (profile.levelScores[lvl] || 0)) {
              profile.levelScores[lvl] = sc;
            }
          });
        }
        if (statsPart) {
          const [tq, ta, tc, mc] = statsPart.split(',').map((n) => parseInt(n, 10) || 0);
          profile.stats.totalQuizzes = Math.max(profile.stats.totalQuizzes || 0, tq);
          profile.stats.totalAnswered = Math.max(profile.stats.totalAnswered || 0, ta);
          profile.stats.totalCorrect = Math.max(profile.stats.totalCorrect || 0, tc);
          profile.stats.maxCombo = Math.max(profile.stats.maxCombo || 0, mc);
        }
      } catch {
        // Ignore malformed cookie
      }
    }

    // 3. Reconcile compressed wrong-question & notes summary from Cookie (`ig_wq_<sk>`)
    // Format: Array of [idiomName, qId, userAns, corrAns, mastered(0/1), note]
    const wqCookie = this.getCookie(`ig_wq_${sk}`);
    if (wqCookie) {
      try {
        const compactArr = JSON.parse(wqCookie);
        if (Array.isArray(compactArr)) {
          compactArr.forEach(([iName, qId, uAns, cAns, mst, note, lvl]) => {
            if (note && !profile.customNotes[iName]) {
              profile.customNotes[iName] = note;
            }
            if (!profile.wrongQuestions[iName]) {
              profile.wrongQuestions[iName] = {
                targetIdiom: iName,
                level: lvl || 1,
                questionId: qId,
                userAnswer: uAns,
                correctAnswer: cAns,
                mastered: Boolean(mst),
                wrongCount: 1,
                customNote: note || '',
                updatedAt: Date.now(),
              };
            }
          });
        }
      } catch {
        // Ignore malformed cookie
      }
    }

    profile.name = targetName;
    profile.avatar = avatar;
    return profile;
  }

  saveProfile(profile) {
    if (!profile || !profile.name) return;
    profile.updatedAt = Date.now();
    const sk = this._safeKey(profile.name);

    // 1. Save full rich profile to localStorage
    localStorage.setItem(`${LS_PREFIX}${profile.name}`, JSON.stringify(profile));

    // 2. Save compact 20-level progress & stats to document.cookie (`ig_prog_<sk>`)
    const scoresArr = [];
    for (let lvl = 1; lvl <= 20; lvl++) {
      scoresArr.push(profile.levelScores[lvl] || 0);
    }
    const st = profile.stats || {};
    const progStr = `${scoresArr.join(',')}|${st.totalQuizzes || 0},${st.totalAnswered || 0},${st.totalCorrect || 0},${st.maxCombo || 0}`;
    this.setCookie(`ig_prog_${sk}`, progStr, 365);

    // 3. Save compressed wrong questions & custom notes to document.cookie (`ig_wq_<sk>`)
    // Guarded to stay well under the 4KB per-cookie browser limit
    const wqEntries = Object.values(profile.wrongQuestions || {});
    const compactList = [];
    for (const item of wqEntries) {
      const note =
        profile.customNotes[item.targetIdiom] || item.customNote || '';
      compactList.push([
        item.targetIdiom,
        item.questionId || '',
        (item.userAnswer || '').slice(0, 24),
        (item.correctAnswer || '').slice(0, 24),
        item.mastered ? 1 : 0,
        note.slice(0, 32),
        item.level || 1,
      ]);
      // Check encoded byte length to never exceed 2800 bytes in cookie
      if (encodeURIComponent(JSON.stringify(compactList)).length > 2600) {
        compactList.pop();
        break;
      }
    }
    this.setCookie(`ig_wq_${sk}`, JSON.stringify(compactList), 365);
  }

  // ==========================================================================
  // Gameplay Recording Helpers
  // ==========================================================================
  recordQuizResult(level, score, answeredCount, correctCount, maxComboInRun) {
    const profile = this.getProfile();
    const prevHigh = profile.levelScores[level] || 0;
    profile.levelScores[level] = Math.max(prevHigh, score);
    profile.levelAttempts[level] = (profile.levelAttempts[level] || 0) + 1;
    profile.stats.totalQuizzes = (profile.stats.totalQuizzes || 0) + 1;
    profile.stats.totalAnswered = (profile.stats.totalAnswered || 0) + answeredCount;
    profile.stats.totalCorrect = (profile.stats.totalCorrect || 0) + correctCount;
    profile.stats.maxCombo = Math.max(profile.stats.maxCombo || 0, maxComboInRun);
    this.saveProfile(profile);
    return profile;
  }

  recordWrongQuestion(questionObj, userChosenKey, userChosenText, correctText) {
    const profile = this.getProfile();
    const key = questionObj.targetIdiom;
    const prev = profile.wrongQuestions[key];
    const existingNote =
      profile.customNotes[key] || (prev && prev.customNote) || '';

    profile.wrongQuestions[key] = {
      targetIdiom: key,
      level: questionObj.level,
      questionId: questionObj.id,
      typeName: questionObj.typeName || '會考成語題',
      yearTags: questionObj.yearTags || [],
      question: questionObj.question,
      options: questionObj.options,
      userAnswerKey: userChosenKey,
      userAnswer: userChosenText,
      correctAnswerKey: questionObj.answer,
      correctAnswer: correctText,
      explanation: questionObj.explanation,
      wrongCount: prev ? (prev.wrongCount || 1) + 1 : 1,
      mastered: false, // Reset to unmastered when answered wrong again
      customNote: existingNote,
      updatedAt: Date.now(),
    };
    this.saveProfile(profile);
    return profile.wrongQuestions[key];
  }

  toggleMastered(targetIdiom, forceState = null) {
    const profile = this.getProfile();
    const item = profile.wrongQuestions[targetIdiom];
    if (!item) return null;
    item.mastered = forceState !== null ? Boolean(forceState) : !item.mastered;
    item.updatedAt = Date.now();
    this.saveProfile(profile);
    return item.mastered;
  }

  removeWrongQuestion(targetIdiom) {
    const profile = this.getProfile();
    if (profile.wrongQuestions[targetIdiom]) {
      delete profile.wrongQuestions[targetIdiom];
      this.saveProfile(profile);
    }
  }

  saveCustomNote(targetIdiom, noteText) {
    const profile = this.getProfile();
    const clean = String(noteText || '').trim();
    profile.customNotes[targetIdiom] = clean;
    if (profile.wrongQuestions[targetIdiom]) {
      profile.wrongQuestions[targetIdiom].customNote = clean;
      profile.wrongQuestions[targetIdiom].updatedAt = Date.now();
    }
    this.saveProfile(profile);
    return clean;
  }

  // ==========================================================================
  // Gamification: Rank & Stars Calculation
  // ==========================================================================
  getStarsForScore(score) {
    if (!score || score < 60) return 0;
    if (score >= 95) return 3;
    if (score >= 80) return 2;
    return 1;
  }

  getRankInfo(profile = null) {
    const p = profile || this.getProfile();
    let clearedCount = 0;
    let totalStars = 0;
    let totalScoreSum = 0;

    for (let lvl = 1; lvl <= 20; lvl++) {
      const sc = p.levelScores[lvl] || 0;
      totalScoreSum += sc;
      if (sc >= 60) clearedCount++;
      totalStars += this.getStarsForScore(sc);
    }

    const tiers = [
      { minCleared: 0,  lv: 'Lv.1',  title: '國文脆友',     icon: '🌱', color: '#CCFF00', nextAt: 2 },
      { minCleared: 2,  lv: 'Lv.3',  title: '語感覺醒者',   icon: '⚡', color: '#00F0FF', nextAt: 5 },
      { minCleared: 5,  lv: 'Lv.5',  title: '成語練習生',   icon: '🎧', color: '#FFB800', nextAt: 10 },
      { minCleared: 10, lv: 'Lv.10', title: '考場破防王',   icon: '🔥', color: '#FF2E93', nextAt: 15 },
      { minCleared: 15, lv: 'Lv.15', title: '速記小卡大師', icon: '💎', color: '#7C4DFF', nextAt: 20 },
      { minCleared: 20, lv: 'Lv.20', title: '5A++會考戰神', icon: '👑', color: '#CCFF00', nextAt: 20 },
    ];

    let currentTier = tiers[0];
    for (const t of tiers) {
      if (clearedCount >= t.minCleared) currentTier = t;
    }

    const accuracy =
      p.stats && p.stats.totalAnswered > 0
        ? Math.round((p.stats.totalCorrect / p.stats.totalAnswered) * 100)
        : 0;

    return {
      ...currentTier,
      clearedCount,
      totalStars,
      maxStars: 60,
      avgScore: clearedCount > 0 ? Math.round(totalScoreSum / clearedCount) : 0,
      accuracy,
    };
  }
}
