/**
 * js/app.js
 * Main Application Controller for Idiom_game (會考成語大亂鬥)
 */

import { SoundEffects, launchConfetti } from './sound.js';
import { StorageManager } from './storage.js';

const AVATAR_CHOICES = ['⚡', '🔥', '👾', '🦊', '🐱‍👤', '🚀', '💎', '👑', '🎧', '🦖'];

class IdiomGameApp {
  constructor() {
    this.sound = new SoundEffects();
    this.storage = new StorageManager();

    this.idioms = [];
    this.idiomMap = new Map();
    this.questions = [];
    this.questionsByLevel = new Map();
    this.levelMeta = new Map();

    this.currentView = 'map'; // 'map' | 'quiz' | 'notebook' | 'dex'
    this.selectedAvatar = '⚡';

    // Quiz State
    this.quizState = {
      mode: 'level', // 'level' | 'repractice'
      level: 1,
      pool: [],
      currentIndex: 0,
      score: 0,
      combo: 0,
      maxCombo: 0,
      correctCount: 0,
      answered: false,
      history: [],
      startTime: 0,
    };

    // Notebook Filter State
    this.nbFilter = {
      search: '',
      level: 'all',
      year: 'all',
      status: 'all', // 'all' | 'unmastered' | 'mastered'
    };

    // Dex Filter State
    this.dexFilter = {
      search: '',
      level: 'all',
      year: 'all',
      stars: 'all',
    };
  }

  async init() {
    this._initTheme();
    this._bindGlobalEvents();
    this._updateAudioButton();

    try {
      const [idiomsRes, questionsRes] = await Promise.all([
        fetch('./data/idioms.json'),
        fetch('./data/questions.json'),
      ]);

      if (!idiomsRes.ok || !questionsRes.ok) {
        throw new Error('題庫載入失敗，請確認 data/ 目錄檔案是否存在。');
      }

      this.idioms = await idiomsRes.json();
      this.questions = await questionsRes.json();

      this._indexData();
      this.refreshAllUI();
      this._hideLoadingScreen();
    } catch (err) {
      console.error(err);
      const loader = document.getElementById('app-loader');
      if (loader) {
        loader.innerHTML = `
          <div class="nb-card p-8 max-w-md text-center">
            <div class="text-4xl mb-3">⚠️</div>
            <h2 class="text-xl font-black mb-2">題庫載入失敗</h2>
            <p class="text-sm opacity-80 mb-4">${this._escapeHtml(err.message)}</p>
            <button onclick="location.reload()" class="nb-btn nb-btn-lime px-5 py-2.5">重新整理</button>
          </div>
        `;
      }
    }
  }

  _indexData() {
    this.idiomMap.clear();
    this.questionsByLevel.clear();
    this.levelMeta.clear();

    for (let lvl = 1; lvl <= 20; lvl++) {
      this.questionsByLevel.set(lvl, []);
      this.levelMeta.set(lvl, {
        level: lvl,
        title: `Level ${lvl}`,
        badge: '會考必考',
        idioms: [],
        yearsSet: new Set(),
      });
    }

    for (const it of this.idioms) {
      this.idiomMap.set(it.name, it);
      const meta = this.levelMeta.get(it.level);
      if (meta) {
        meta.title = it.levelTitle || meta.title;
        meta.badge = it.levelBadge || meta.badge;
        meta.idioms.push(it);
        (it.yearTags || []).forEach((y) => meta.yearsSet.add(y));
      }
    }

    for (const q of this.questions) {
      const list = this.questionsByLevel.get(q.level);
      if (list) list.push(q);
    }

    this._populateFilterDropdowns();
  }

  _populateFilterDropdowns() {
    // Populate level dropdowns & year dropdowns in Notebook and Dex
    const allYears = new Set();
    this.idioms.forEach((it) => (it.yearTags || []).forEach((y) => allYears.add(y)));
    const sortedYears = Array.from(allYears).sort((a, b) => {
      const na = parseInt(a, 10) || 0;
      const nb = parseInt(b, 10) || 0;
      if (nb !== na) return nb - na;
      return a.localeCompare(b);
    });

    const nbLevelSel = document.getElementById('nb-filter-level');
    const dexLevelSel = document.getElementById('dex-filter-level');
    if (nbLevelSel && dexLevelSel) {
      let lvlHtml = '<option value="all">全部關卡 (Level 1~20)</option>';
      for (let lvl = 1; lvl <= 20; lvl++) {
        const meta = this.levelMeta.get(lvl);
        lvlHtml += `<option value="${lvl}">Level ${lvl}｜${this._escapeHtml(meta.title)}</option>`;
      }
      nbLevelSel.innerHTML = lvlHtml;
      dexLevelSel.innerHTML = lvlHtml;
    }

    const nbYearSel = document.getElementById('nb-filter-year');
    const dexYearSel = document.getElementById('dex-filter-year');
    if (nbYearSel && dexYearSel) {
      let yrHtml = '<option value="all">全部歷屆年份 (115~102年)</option>';
      sortedYears.forEach((yr) => {
        yrHtml += `<option value="${this._escapeHtml(yr)}">${this._escapeHtml(yr)}</option>`;
      });
      nbYearSel.innerHTML = yrHtml;
      dexYearSel.innerHTML = yrHtml;
    }
  }

  _hideLoadingScreen() {
    const loader = document.getElementById('app-loader');
    if (loader) {
      loader.classList.add('opacity-0', 'pointer-events-none');
      setTimeout(() => loader.remove(), 250);
    }
  }

  // ==========================================================================
  // Theme & Audio Controls
  // ==========================================================================
  _initTheme() {
    const saved = localStorage.getItem('idiom_game_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    this._updateThemeButton(saved);
  }

  toggleTheme() {
    this.sound.playClick();
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('idiom_game_theme', next);
    this._updateThemeButton(next);
  }

  _updateThemeButton(theme) {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;
    btn.innerHTML =
      theme === 'dark'
        ? '<span>☀️</span><span class="hidden sm:inline">多巴胺亮色</span>'
        : '<span>🌙</span><span class="hidden sm:inline">暗黑霓虹</span>';
  }

  _updateAudioButton() {
    const btn = document.getElementById('btn-audio-toggle');
    if (!btn) return;
    btn.innerHTML = this.sound.muted ? '🔇' : '🔊';
    btn.title = this.sound.muted ? '開啟街機音效' : '關閉街機音效';
  }

  // ==========================================================================
  // View Navigation & Global Refresh
  // ==========================================================================
  switchView(viewName) {
    this.sound.playClick();
    this.currentView = viewName;

    const views = ['map', 'quiz', 'notebook', 'dex'];
    views.forEach((v) => {
      const el = document.getElementById(`view-${v}`);
      if (el) {
        if (v === viewName) {
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      }
    });

    // Update nav tab active states
    document.querySelectorAll('[data-nav-view]').forEach((btn) => {
      const target = btn.getAttribute('data-nav-view');
      if (target === viewName) {
        btn.classList.add('nb-btn-lime');
        btn.classList.remove('nb-btn-surface');
      } else {
        btn.classList.remove('nb-btn-lime');
        btn.classList.add('nb-btn-surface');
      }
    });

    if (viewName === 'map') this.renderMapView();
    if (viewName === 'notebook') this.renderNotebookView();
    if (viewName === 'dex') this.renderDexView();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  refreshAllUI() {
    this.renderHeaderChallenger();
    this.renderHeroBanner();
    this.renderMapView();
    this.renderNotebookView();
    this.renderDexView();
  }

  // ==========================================================================
  // Header & Hero Banner (Challenger & Rank Info)
  // ==========================================================================
  renderHeaderChallenger() {
    const profile = this.storage.getProfile();
    const rank = this.storage.getRankInfo(profile);
    const wqList = Object.values(profile.wrongQuestions || {});
    const unmasteredCount = wqList.filter((x) => !x.mastered).length;

    const avatarEl = document.getElementById('header-challenger-avatar');
    const nameEl = document.getElementById('header-challenger-name');
    const rankEl = document.getElementById('header-challenger-rank');
    const nbBadge = document.getElementById('nav-nb-badge');
    const quickSelect = document.getElementById('quick-challenger-select');

    if (avatarEl) avatarEl.textContent = profile.avatar || '⚡';
    if (nameEl) nameEl.textContent = profile.name;
    if (rankEl) {
      rankEl.textContent = `${rank.lv} ${rank.title} ${rank.icon}`;
    }
    if (nbBadge) {
      nbBadge.textContent = unmasteredCount;
      nbBadge.classList.toggle('hidden', unmasteredCount === 0);
    }

    // Populate quick dropdown in navbar
    if (quickSelect) {
      const challengers = this.storage.getChallengers();
      quickSelect.innerHTML = challengers
        .map(
          (c) =>
            `<option value="${this._escapeHtml(c.name)}" ${
              c.name === profile.name ? 'selected' : ''
            }>${c.avatar || '⚡'} ${this._escapeHtml(c.name)}</option>`
        )
        .join('');
    }
  }

  renderHeroBanner() {
    const profile = this.storage.getProfile();
    const rank = this.storage.getRankInfo(profile);
    const wqList = Object.values(profile.wrongQuestions || {});
    const unmasteredCount = wqList.filter((x) => !x.mastered).length;
    const masteredCount = wqList.filter((x) => x.mastered).length;

    const heroContainer = document.getElementById('hero-dashboard');
    if (!heroContainer) return;

    const progressPct = Math.round((rank.clearedCount / 20) * 100);

    heroContainer.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <!-- Challenger Identity & Rank Card -->
        <div class="lg:col-span-7 nb-card p-5 sm:p-6 relative overflow-hidden">
          <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div class="flex items-center gap-4">
              <div class="w-16 h-16 rounded-2xl border-3 border-black bg-[#7C4DFF] flex items-center justify-center text-3xl shadow-[3px_3px_0px_#000]">
                ${profile.avatar || '⚡'}
              </div>
              <div>
                <div class="flex flex-wrap items-center gap-2 mb-1">
                  <span class="sticker-badge bg-[#CCFF00] text-black sticker-tilt-left">
                    ${rank.lv} ${rank.title} ${rank.icon}
                  </span>
                  <span class="sticker-badge bg-[#FF2E93] text-white">
                    Cookie 雙重同步中 🍪
                  </span>
                </div>
                <h2 class="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2">
                  <span>${this._escapeHtml(profile.name)}</span>
                  <button id="btn-hero-switch-user" class="text-xs px-2.5 py-1 rounded-lg border-2 border-black bg-[#00F0FF] text-black font-extrabold hover:brightness-105">
                    切換/新增挑戰者 ▾
                  </button>
                </h2>
              </div>
            </div>
            <div class="text-right">
              <div class="text-xs font-bold uppercase tracking-wider opacity-75">總星級評價</div>
              <div class="text-2xl sm:text-3xl font-black text-[#FFB800]">
                ⭐ ${rank.totalStars} <span class="text-sm opacity-70">/ 60</span>
              </div>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="mb-4">
            <div class="flex justify-between text-xs font-bold mb-1.5">
              <span>20 關卡制霸進度（及格 60 分解鎖星級）</span>
              <span class="text-[#CCFF00] bg-black px-2 py-0.5 rounded">${rank.clearedCount} / 20 關 (${progressPct}%)</span>
            </div>
            <div class="w-full h-4 bg-black/40 rounded-full border-2 border-black overflow-hidden p-0.5">
              <div class="h-full bg-gradient-to-r from-[#CCFF00] via-[#00F0FF] to-[#FF2E93] rounded-full transition-all duration-500" style="width: ${Math.max(progressPct, 3)}%"></div>
            </div>
          </div>

          <!-- Stats Row -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
            <div class="p-2.5 rounded-xl bg-black/25 border-2 border-black/40">
              <div class="text-xs opacity-75 font-bold">累計出戰</div>
              <div class="text-lg font-black">${profile.stats?.totalQuizzes || 0} 場</div>
            </div>
            <div class="p-2.5 rounded-xl bg-black/25 border-2 border-black/40">
              <div class="text-xs opacity-75 font-bold">歷史最高連擊</div>
              <div class="text-lg font-black text-[#FF2E93]">Combo x${profile.stats?.maxCombo || 0} 🔥</div>
            </div>
            <div class="p-2.5 rounded-xl bg-black/25 border-2 border-black/40">
              <div class="text-xs opacity-75 font-bold">總體正確率</div>
              <div class="text-lg font-black text-[#00F0FF]">${rank.accuracy}%</div>
            </div>
            <div class="p-2.5 rounded-xl bg-black/25 border-2 border-black/40">
              <div class="text-xs opacity-75 font-bold">待消滅錯題</div>
              <div class="text-lg font-black text-[#FFB800]">${unmasteredCount} 題 <span class="text-xs opacity-70">(已熟練 ${masteredCount})</span></div>
            </div>
          </div>
        </div>

        <!-- Quick Action Arcade Panel -->
        <div class="lg:col-span-5 nb-card p-5 sm:p-6 flex flex-col justify-between bg-gradient-to-br from-[#7C4DFF]/20 to-[#FF2E93]/15">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="sticker-badge bg-[#00F0FF] text-black sticker-tilt-right">GEN-Z 衝刺特區</span>
              <span class="text-xs font-mono font-bold opacity-80">102~115會考全收錄</span>
            </div>
            <h3 class="text-xl font-black mb-1">準備好上場大亂鬥了嗎？</h3>
            <p class="text-xs sm:text-sm opacity-85 mb-4">
              全題庫共 <strong>20 關 × 100 題 = 2,000 道單選題</strong>，每場隨機抽取 20 題（選項自動洗牌），答錯自動收錄至專屬錯題筆記！
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button id="btn-hero-next-level" class="nb-btn nb-btn-lime py-3 px-4 text-sm sm:text-base">
              🚀 挑戰推薦關卡 (Lv.${Math.min(rank.clearedCount + 1, 20)})
            </button>
            <button id="btn-hero-repractice" class="nb-btn nb-btn-pink py-3 px-4 text-sm sm:text-base">
              ⚔️ 錯題重練 (${unmasteredCount})
            </button>
            <button id="btn-hero-open-dex" class="nb-btn nb-btn-cyan py-2.5 px-4 text-xs sm:text-sm">
              🃏 阿任師 570 成語小卡
            </button>
            <button id="btn-hero-cookie-info" class="nb-btn nb-btn-surface py-2.5 px-4 text-xs sm:text-sm">
              🍪 檢視 Cookie 紀錄狀態
            </button>
          </div>
        </div>
      </div>
    `;

    document
      .getElementById('btn-hero-switch-user')
      ?.addEventListener('click', () => this.openChallengerModal());

    document
      .getElementById('btn-hero-next-level')
      ?.addEventListener('click', () => {
        const nextLvl = Math.min(rank.clearedCount + 1, 20);
        this.startLevelQuiz(nextLvl);
      });

    document
      .getElementById('btn-hero-repractice')
      ?.addEventListener('click', () => {
        if (unmasteredCount > 0) {
          this.startRepracticeQuiz();
        } else {
          this.switchView('notebook');
        }
      });

    document
      .getElementById('btn-hero-open-dex')
      ?.addEventListener('click', () => this.switchView('dex'));

    document
      .getElementById('btn-hero-cookie-info')
      ?.addEventListener('click', () => this.openChallengerModal(true));
  }

  // ==========================================================================
  // 20-Level Battle Map Rendering
  // ==========================================================================
  renderMapView() {
    const grid = document.getElementById('levels-grid');
    if (!grid) return;

    const profile = this.storage.getProfile();
    const cardsHtml = [];

    for (let lvl = 1; lvl <= 20; lvl++) {
      const meta = this.levelMeta.get(lvl);
      if (!meta) continue;

      const highScore = profile.levelScores[lvl] || 0;
      const attempts = profile.levelAttempts[lvl] || 0;
      const stars = this.storage.getStarsForScore(highScore);
      const isCleared = highScore >= 60;

      const starsDisplay =
        [1, 2, 3]
          .map((s) => (s <= stars ? '⭐' : '<span class="opacity-25">⭐</span>'))
          .join('') +
        (stars === 3
          ? ' <span class="text-[11px] font-black text-[#CCFF00] bg-black px-1.5 py-0.5 rounded">SSR滿星</span>'
          : '');

      const previewIdioms = meta.idioms.slice(0, 5);
      const highFreqCount = meta.idioms.filter((i) => i.stars > 0).length;

      const badgeColors = [
        'bg-[#CCFF00] text-black',
        'bg-[#FF2E93] text-white',
        'bg-[#00F0FF] text-black',
        'bg-[#FFB800] text-black',
      ];
      const badgeClass = badgeColors[(lvl - 1) % badgeColors.length];

      cardsHtml.push(`
        <div class="nb-card nb-card-interactive p-5 flex flex-col justify-between relative ${
          isCleared ? 'border-[#CCFF00]/80' : ''
        }">
          <div>
            <!-- Top Row: Level Number & Sticker -->
            <div class="flex items-center justify-between gap-2 mb-3">
              <div class="flex items-center gap-2">
                <span class="px-3 py-1 rounded-lg bg-black text-[#CCFF00] font-mono font-black text-sm border-2 border-[#CCFF00]">
                  LEVEL ${String(lvl).padStart(2, '0')}
                </span>
                <span class="sticker-badge ${badgeClass} sticker-tilt-right">
                  ${this._escapeHtml(meta.badge)}
                </span>
              </div>
              <div class="text-sm font-bold">${starsDisplay}</div>
            </div>

            <!-- Title & Subtitle -->
            <h3 class="text-lg font-black mb-1.5 leading-snug">
              ${this._escapeHtml(meta.title)}
            </h3>
            <div class="flex flex-wrap items-center gap-2 text-xs opacity-80 mb-3">
              <span>📚 本關成語：<strong>${meta.idioms.length} 則</strong></span>
              <span>•</span>
              <span>🔥 高頻星號：<strong>${highFreqCount} 則</strong></span>
              <span>•</span>
              <span>🎯 題庫：<strong>100 題</strong></span>
            </div>

            <!-- Sample Idioms Chips -->
            <div class="flex flex-wrap gap-1.5 mb-4">
              ${previewIdioms
                .map(
                  (it) => `
                <span class="text-xs px-2 py-0.5 rounded-md border border-current/30 bg-black/20 font-bold ${
                  it.stars >= 2
                    ? 'text-[#FF2E93]'
                    : it.stars === 1
                    ? 'text-[#CCFF00]'
                    : ''
                }">
                  ${this._escapeHtml(it.displayName)}
                </span>
              `
                )
                .join('')}
              <span class="text-xs px-2 py-0.5 rounded-md opacity-60">+${
                meta.idioms.length - previewIdioms.length
              } 則...</span>
            </div>
          </div>

          <!-- Bottom Score & Action Buttons -->
          <div class="pt-3 border-t-2 border-black/30">
            <div class="flex items-center justify-between text-xs font-bold mb-3">
              <span>
                ${
                  attempts > 0
                    ? `🏆 最高紀錄：<strong class="text-sm ${
                        isCleared ? 'text-[#CCFF00]' : 'text-[#FFB800]'
                      }">${highScore} 分</strong> (${attempts} 次挑戰)`
                    : '<span class="opacity-60">尚未挑戰（滿分 100 分）</span>'
                }
              </span>
              <span class="font-mono opacity-75">隨機抽 20 題</span>
            </div>

            <div class="grid grid-cols-2 gap-2.5">
              <button data-preview-level="${lvl}" class="nb-btn nb-btn-surface py-2 px-3 text-xs sm:text-sm">
                📖 先看小卡 (${meta.idioms.length})
              </button>
              <button data-start-level="${lvl}" class="nb-btn ${
                isCleared ? 'nb-btn-cyan' : 'nb-btn-lime'
              } py-2 px-3 text-xs sm:text-sm">
                ⚔️ ${isCleared ? '再次刷分' : '立即挑戰'}
              </button>
            </div>
          </div>
        </div>
      `);
    }

    grid.innerHTML = cardsHtml.join('');

    grid.querySelectorAll('[data-preview-level]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lvl = parseInt(btn.getAttribute('data-preview-level'), 10);
        this.openLevelFlashcardsModal(lvl);
      });
    });

    grid.querySelectorAll('[data-start-level]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lvl = parseInt(btn.getAttribute('data-start-level'), 10);
        this.startLevelQuiz(lvl);
      });
    });
  }

  // ==========================================================================
  // Level Idiom Flashcards Preview Modal (先看小卡再挑戰)
  // ==========================================================================
  openLevelFlashcardsModal(level) {
    this.sound.playClick();
    const meta = this.levelMeta.get(level);
    if (!meta) return;

    const modal = document.getElementById('modal-flashcards');
    const titleEl = document.getElementById('flashcards-modal-title');
    const bodyEl = document.getElementById('flashcards-modal-body');
    const startBtn = document.getElementById('btn-modal-start-level');
    if (!modal || !titleEl || !bodyEl) return;

    const profile = this.storage.getProfile();

    titleEl.innerHTML = `
      <span class="px-2.5 py-1 rounded bg-black text-[#CCFF00] font-mono text-sm mr-2">LEVEL ${String(
        level
      ).padStart(2, '0')}</span>
      <span>${this._escapeHtml(meta.title)} — 本關成語速記小卡 (${meta.idioms.length} 則)</span>
    `;

    bodyEl.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        ${meta.idioms
          .map((it, idx) => {
            const note = profile.customNotes?.[it.name] || '';
            const starBadge =
              it.stars >= 2
                ? '<span class="sticker-badge bg-[#FF2E93] text-white">SSR 雙星必考 **</span>'
                : it.stars === 1
                ? '<span class="sticker-badge bg-[#CCFF00] text-black">SR 高頻 *</span>'
                : '';
            return `
              <div class="p-4 rounded-xl border-2 border-black bg-black/20 flex flex-col justify-between">
                <div>
                  <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <h4 class="text-lg font-black text-[#00F0FF]">
                      ${idx + 1}. ${this._escapeHtml(it.displayName)}
                    </h4>
                    <div class="flex flex-wrap gap-1">
                      ${starBadge}
                      ${(it.yearTags || [])
                        .map(
                          (y) =>
                            `<span class="text-[11px] font-bold px-2 py-0.5 rounded bg-[#7C4DFF] text-white border border-black">${this._escapeHtml(
                              y
                            )}</span>`
                        )
                        .join('')}
                    </div>
                  </div>
                  <p class="text-sm leading-relaxed mb-2">${this._escapeHtml(it.meaning)}</p>
                  ${
                    it.phonetic
                      ? `<div class="text-xs font-bold text-[#FFB800] mb-1">🔊 注音提示：${this._escapeHtml(
                          it.phonetic
                        )}</div>`
                      : ''
                  }
                  ${
                    it.alsoKnownAs && it.alsoKnownAs.length > 0
                      ? `<div class="text-xs opacity-75">🔄 亦作：${this._escapeHtml(
                          it.alsoKnownAs.join('、')
                        )}</div>`
                      : ''
                  }
                </div>
                ${
                  note
                    ? `<div class="mt-2 pt-2 border-t border-white/10 text-xs text-[#CCFF00]">📌 我的筆記：${this._escapeHtml(
                        note
                      )}</div>`
                    : ''
                }
              </div>
            `;
          })
          .join('')}
      </div>
    `;

    if (startBtn) {
      startBtn.onclick = () => {
        this.closeModal('modal-flashcards');
        this.startLevelQuiz(level);
      };
    }

    modal.classList.remove('hidden');
  }

  // ==========================================================================
  // Quiz Engine (隨機抽 20 題 & 選項隨機洗牌 & 錯題重練模式)
  // ==========================================================================
  _prepareQuestionWithShuffledOptions(rawQ) {
    // Clone question and shuffle options A/B/C/D unless options are sequential counts
    const origOpts = rawQ.options;
    const origAnsKey = rawQ.answer;
    const origCorrectText = origOpts[origAnsKey];

    const values = Object.values(origOpts);
    const isSequentialCount = values.some((v) =>
      /^(一種|兩種|三種|四種|三則|四則|五則|六則)$/.test(v.trim())
    );

    if (isSequentialCount) {
      return {
        ...rawQ,
        options: { ...origOpts },
        answer: origAnsKey,
      };
    }

    // Shuffle the 4 option entries
    const entries = ['A', 'B', 'C', 'D'].map((k) => ({
      origKey: k,
      text: origOpts[k],
    }));

    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }

    const labels = ['A', 'B', 'C', 'D'];
    const newOptions = {};
    let newAnswerKey = 'A';

    entries.forEach((entry, idx) => {
      const newKey = labels[idx];
      newOptions[newKey] = entry.text;
      if (entry.origKey === origAnsKey || entry.text === origCorrectText) {
        newAnswerKey = newKey;
      }
    });

    // Update the header line in explanation so `【正確答案：(X)...】` matches the new shuffled letter
    let updatedExplanation = rawQ.explanation || '';
    updatedExplanation = updatedExplanation.replace(
      /【正確答案：\([ABCD]\)([^】]*)】/,
      `【正確答案：(${newAnswerKey})$1】`
    );

    return {
      ...rawQ,
      options: newOptions,
      answer: newAnswerKey,
      explanation: updatedExplanation,
    };
  }

  startLevelQuiz(level) {
    const levelPool = this.questionsByLevel.get(level) || [];
    if (levelPool.length === 0) return;

    // Fisher-Yates shuffle a copy of the 100 questions and pick 20
    const copy = [...levelPool];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    const picked20 = copy
      .slice(0, 20)
      .map((q) => this._prepareQuestionWithShuffledOptions(q));

    this.quizState = {
      mode: 'level',
      level,
      pool: picked20,
      currentIndex: 0,
      score: 0,
      combo: 0,
      maxCombo: 0,
      correctCount: 0,
      answered: false,
      history: [],
      startTime: Date.now(),
    };

    this.switchView('quiz');
    this.renderQuizQuestion();
  }

  startRepracticeQuiz() {
    const profile = this.storage.getProfile();
    const allWrong = Object.values(profile.wrongQuestions || {});
    let targetWrong = allWrong.filter((w) => !w.mastered);
    if (targetWrong.length === 0) {
      targetWrong = allWrong;
    }
    if (targetWrong.length === 0) {
      this.showToast('目前沒有待複習的錯題！快去關卡挑戰吧！');
      return;
    }

    // Shuffle wrong items and pick up to 20
    const shuffled = [...targetWrong];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const selected = shuffled.slice(0, 20);
    // Find matching full questions from this.questions (or reconstruct from saved wrong entry)
    const qById = new Map(this.questions.map((q) => [q.id, q]));
    const quizPool = selected.map((w) => {
      const baseQ = qById.get(w.questionId) || {
        id: w.questionId || `WQ_${w.targetIdiom}`,
        level: w.level || 1,
        typeName: w.typeName || '錯題重練',
        targetIdiom: w.targetIdiom,
        yearTags: w.yearTags || [],
        question: w.question,
        options: w.options,
        answer: w.correctAnswerKey || 'A',
        explanation: w.explanation || '',
      };
      return this._prepareQuestionWithShuffledOptions(baseQ);
    });

    this.quizState = {
      mode: 'repractice',
      level: 0,
      pool: quizPool,
      currentIndex: 0,
      score: 0,
      combo: 0,
      maxCombo: 0,
      correctCount: 0,
      answered: false,
      history: [],
      startTime: Date.now(),
    };

    this.switchView('quiz');
    this.renderQuizQuestion();
  }

  renderQuizQuestion() {
    const container = document.getElementById('quiz-arena-content');
    if (!container) return;

    const st = this.quizState;
    if (st.currentIndex >= st.pool.length) {
      this.renderQuizResult();
      return;
    }

    const q = st.pool[st.currentIndex];
    const total = st.pool.length;
    const progressPct = Math.round(((st.currentIndex + 1) / total) * 100);
    const idiomInfo = this.idiomMap.get(q.targetIdiom);
    const stars = idiomInfo ? idiomInfo.stars : 0;

    const modeTitle =
      st.mode === 'repractice'
        ? '⚔️ 錯題重練（消滅錯題特訓）'
        : `LEVEL ${String(st.level).padStart(2, '0')}｜${
            this.levelMeta.get(st.level)?.title || ''
          }`;

    const starSticker =
      stars >= 2
        ? '<span class="sticker-badge bg-[#FF2E93] text-white sticker-tilt-right">SSR 雙星高頻 **</span>'
        : stars === 1
        ? '<span class="sticker-badge bg-[#CCFF00] text-black sticker-tilt-right">SR 歷屆高頻 *</span>'
        : '';

    container.innerHTML = `
      <div class="max-w-3xl mx-auto">
        <!-- Top Status Bar -->
        <div class="nb-card p-4 mb-5">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div class="flex items-center gap-2">
              <button id="btn-quiz-quit" class="nb-btn nb-btn-surface px-3 py-1 text-xs">
                ← 返回地圖
              </button>
              <span class="font-black text-sm sm:text-base">${this._escapeHtml(modeTitle)}</span>
            </div>

            <div class="flex items-center gap-3">
              <div id="quiz-combo-badge" class="${
                st.combo >= 2 ? 'combo-pop' : 'opacity-40'
              } sticker-badge bg-[#FF2E93] text-white text-xs sm:text-sm">
                Combo x${st.combo} 🔥
              </div>
              <div class="px-3 py-1 rounded-xl bg-black text-[#CCFF00] font-mono font-black text-sm border-2 border-[#CCFF00]">
                SCORE: ${st.score}
              </div>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="flex items-center gap-3">
            <div class="text-xs font-mono font-black whitespace-nowrap">
              Q ${st.currentIndex + 1} / ${total}
            </div>
            <div class="w-full h-3 bg-black/40 rounded-full border-2 border-black overflow-hidden">
              <div class="h-full bg-[#CCFF00] transition-all duration-300" style="width: ${progressPct}%"></div>
            </div>
          </div>
        </div>

        <!-- Question Card -->
        <div class="nb-card p-5 sm:p-7 mb-5 relative">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="sticker-badge bg-[#00F0FF] text-black sticker-tilt-left">
                ${this._escapeHtml(q.typeName || '會考成語題')}
              </span>
              ${starSticker}
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${(q.yearTags || [])
                .map(
                  (yr) =>
                    `<span class="text-xs font-black px-2.5 py-0.5 rounded-full bg-[#7C4DFF] text-white border-2 border-black">🔥 ${this._escapeHtml(
                      yr
                    )}會考</span>`
                )
                .join('')}
            </div>
          </div>

          <h2 class="text-lg sm:text-2xl font-black leading-relaxed mb-6">
            ${this._escapeHtml(q.question)}
          </h2>

          <!-- 4 Options -->
          <div class="space-y-3" id="quiz-options-list">
            ${['A', 'B', 'C', 'D']
              .map(
                (key) => `
              <button
                type="button"
                data-option-key="${key}"
                class="quiz-option-btn group"
              >
                <span class="w-8 h-8 rounded-lg border-2 border-black bg-[#CCFF00] text-black font-mono font-black flex items-center justify-center shrink-0 group-hover:bg-[#00F0FF]">
                  ${key}
                </span>
                <span class="text-base sm:text-lg font-bold leading-snug pt-0.5">
                  ${this._escapeHtml(q.options[key])}
                </span>
              </button>
            `
              )
              .join('')}
          </div>
        </div>

        <!-- Instant Feedback Panel (Hidden until option clicked) -->
        <div id="quiz-feedback-panel" class="hidden"></div>
      </div>
    `;

    document.getElementById('btn-quiz-quit')?.addEventListener('click', () => {
      this.switchView(st.mode === 'repractice' ? 'notebook' : 'map');
    });

    container.querySelectorAll('[data-option-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const chosenKey = btn.getAttribute('data-option-key');
        this.handleOptionSelect(chosenKey);
      });
    });
  }

  handleOptionSelect(chosenKey) {
    const st = this.quizState;
    if (st.answered) return;
    st.answered = true;

    const q = st.pool[st.currentIndex];
    const isCorrect = chosenKey === q.answer;
    const ptsPerQ = Math.round(100 / st.pool.length);

    if (isCorrect) {
      st.score = Math.min(100, st.score + ptsPerQ);
      st.combo += 1;
      st.maxCombo = Math.max(st.maxCombo, st.combo);
      st.correctCount += 1;
      this.sound.playCorrect(st.combo);

      // In repractice mode, automatically mark as mastered when answered right!
      if (st.mode === 'repractice') {
        this.storage.toggleMastered(q.targetIdiom, true);
      }
    } else {
      st.combo = 0;
      this.sound.playWrong();
      // Record wrong question into active Challenger's Wrong Question Notebook
      this.storage.recordWrongQuestion(
        q,
        chosenKey,
        q.options[chosenKey],
        q.options[q.answer]
      );
    }

    st.history.push({
      question: q,
      chosenKey,
      isCorrect,
    });

    // Update Combo Badge
    const comboBadge = document.getElementById('quiz-combo-badge');
    if (comboBadge) {
      comboBadge.textContent = `Combo x${st.combo} 🔥`;
      comboBadge.className = `${
        st.combo >= 2 ? 'combo-pop' : 'opacity-40'
      } sticker-badge bg-[#FF2E93] text-white text-xs sm:text-sm`;
    }

    // Highlight Option Buttons
    document.querySelectorAll('[data-option-key]').forEach((btn) => {
      btn.disabled = true;
      const key = btn.getAttribute('data-option-key');
      if (key === q.answer) {
        btn.classList.add('option-correct');
      } else if (key === chosenKey && !isCorrect) {
        btn.classList.add('option-wrong');
      }
    });

    // Show Instant Feedback & 阿任師小卡詳解
    const feedbackEl = document.getElementById('quiz-feedback-panel');
    if (!feedbackEl) return;

    const idiomInfo = this.idiomMap.get(q.targetIdiom);
    const profile = this.storage.getProfile();
    const existingNote = profile.customNotes?.[q.targetIdiom] || '';
    const isLast = st.currentIndex + 1 >= st.pool.length;

    feedbackEl.classList.remove('hidden');
    feedbackEl.innerHTML = `
      <div class="nb-card p-5 sm:p-6 border-3 ${
        isCorrect ? 'border-[#22C55E]' : 'border-[#FF2E93]'
      }">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div class="flex items-center gap-2.5">
            <span class="text-2xl">${isCorrect ? '🎉' : '💥'}</span>
            <div>
              <h3 class="text-lg sm:text-xl font-black ${
                isCorrect ? 'text-[#CCFF00]' : 'text-[#FF2E93]'
              }">
                ${
                  isCorrect
                    ? `答對了！+${ptsPerQ} 分 ${
                        st.combo >= 3 ? `（連擊 Combo x${st.combo} 🔥）` : ''
                      }`
                    : `答錯了！已自動收錄至「${this._escapeHtml(
                        profile.name
                      )}」的錯題筆記 📓`
                }
              </h3>
              ${
                st.mode === 'repractice' && isCorrect
                  ? '<div class="text-xs font-bold text-[#00F0FF]">✅ 已將此成語標記為「已熟練（Mastered）」！</div>'
                  : ''
              }
            </div>
          </div>

          <button id="btn-next-question" class="nb-btn nb-btn-lime px-6 py-2.5 text-sm sm:text-base">
            ${isLast ? '🏆 查看結算戰報 →' : '下一題 →'}
          </button>
        </div>

        <!-- 阿任師小卡核心重點 -->
        ${
          idiomInfo
            ? `
          <div class="p-4 rounded-xl bg-black/30 border-2 border-black mb-3">
            <div class="flex flex-wrap items-center gap-2 mb-1">
              <span class="sticker-badge bg-[#FFB800] text-black">阿任師速記小卡</span>
              <span class="font-black text-base text-[#00F0FF]">${this._escapeHtml(
                idiomInfo.displayName
              )}</span>
              <span class="text-xs font-bold opacity-80">（歷屆出現年份：${this._escapeHtml(
                (idiomInfo.yearTags || []).join('、')
              )}）</span>
            </div>
            <p class="text-sm leading-relaxed">${this._escapeHtml(idiomInfo.meaning)}</p>
            ${
              idiomInfo.phonetic
                ? `<div class="text-xs font-bold text-[#CCFF00] mt-1">🔊 注音提示：${this._escapeHtml(
                    idiomInfo.phonetic
                  )}</div>`
                : ''
            }
          </div>
        `
            : ''
        }

        <!-- 詳解內容 -->
        <div class="text-xs sm:text-sm whitespace-pre-line leading-relaxed opacity-90 bg-black/15 p-3.5 rounded-xl border border-current/15 mb-3">${this._escapeHtml(
          q.explanation
        )}</div>

        <!-- 即時口訣筆記欄 -->
        <div class="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center pt-2 border-t border-current/15">
          <input
            id="quiz-inline-note"
            type="text"
            value="${this._escapeHtml(existingNote)}"
            placeholder="✍️ 為「${this._escapeHtml(
              q.targetIdiom
            )}」寫下你的專屬口訣或筆記..."
            class="flex-1 px-3 py-2 rounded-lg bg-black/30 border-2 border-black text-sm focus:outline-none focus:border-[#CCFF00]"
          />
          <button id="btn-quiz-save-note" class="nb-btn nb-btn-purple px-4 py-2 text-xs">
            💾 儲存口訣筆記
          </button>
        </div>
      </div>
    `;

    document
      .getElementById('btn-next-question')
      ?.addEventListener('click', () => {
        this.sound.playClick();
        st.currentIndex += 1;
        st.answered = false;
        this.renderQuizQuestion();
      });

    document
      .getElementById('btn-quiz-save-note')
      ?.addEventListener('click', () => {
        const input = document.getElementById('quiz-inline-note');
        if (input) {
          this.storage.saveCustomNote(q.targetIdiom, input.value);
          this.showToast(`已儲存「${q.targetIdiom}」的專屬筆記！`);
        }
      });

    this.renderHeaderChallenger();
    feedbackEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  renderQuizResult() {
    const container = document.getElementById('quiz-arena-content');
    if (!container) return;

    const st = this.quizState;
    const total = st.pool.length;
    const finalScore =
      total === 20
        ? st.score
        : Math.round((st.correctCount / Math.max(total, 1)) * 100);

    if (st.mode === 'level') {
      this.storage.recordQuizResult(
        st.level,
        finalScore,
        total,
        st.correctCount,
        st.maxCombo
      );
    }

    const stars = this.storage.getStarsForScore(finalScore);
    if (finalScore >= 60) {
      this.sound.playFanfare();
      launchConfetti();
    }

    this.renderHeaderChallenger();
    this.renderHeroBanner();

    const wrongInRun = st.history.filter((h) => !h.isCorrect);

    container.innerHTML = `
      <div class="max-w-3xl mx-auto nb-card p-6 sm:p-8 text-center">
        <div class="inline-block sticker-badge bg-[#CCFF00] text-black mb-3 text-sm">
          ${st.mode === 'repractice' ? '錯題消滅戰報' : `LEVEL ${String(st.level).padStart(2, '0')} 結算戰報`}
        </div>

        <div class="text-4xl sm:text-5xl mb-2">
          ${
            stars === 3
              ? '⭐⭐⭐'
              : stars === 2
              ? '⭐⭐'
              : stars === 1
              ? '⭐'
              : '💪'
          }
        </div>

        <h2 class="text-3xl sm:text-5xl font-black mb-2 text-[#CCFF00]">
          ${finalScore} 分
        </h2>
        <p class="text-sm sm:text-base font-bold opacity-85 mb-6">
          答對 <strong>${st.correctCount} / ${total}</strong> 題 ｜ 最高連擊 <strong>Combo x${
      st.maxCombo
    } 🔥</strong>
        </p>

        ${
          wrongInRun.length > 0
            ? `
          <div class="text-left p-4 rounded-2xl bg-black/30 border-2 border-[#FF2E93] mb-6">
            <h3 class="text-sm font-black text-[#FF2E93] mb-2">
              📓 本場答錯並自動收錄至「錯題筆記」之成語（共 ${wrongInRun.length} 題）：
            </h3>
            <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
              ${wrongInRun
                .map(
                  (h) => `
                <div class="p-2.5 rounded-lg bg-black/40 border border-white/10 text-xs flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span class="font-black text-[#00F0FF] text-sm mr-2">${this._escapeHtml(
                      h.question.targetIdiom
                    )}</span>
                    <span class="text-[#FF2E93]">❌ 誤選：(${h.chosenKey}) ${this._escapeHtml(
                    h.question.options[h.chosenKey]
                  )}</span>
                  </div>
                  <div class="text-[#CCFF00] font-bold">
                    ✅ 正解：(${h.question.answer}) ${this._escapeHtml(
                    h.question.options[h.question.answer]
                  )}
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        `
            : `
          <div class="p-4 rounded-2xl bg-[#CCFF00]/15 border-2 border-[#CCFF00] mb-6 font-black text-[#CCFF00]">
            👑 太神啦！本場次全數答對，零失誤完美通關！
          </div>
        `
        }

        <div class="flex flex-wrap justify-center gap-3">
          ${
            st.mode === 'level'
              ? `
            <button id="btn-result-retry" class="nb-btn nb-btn-lime px-6 py-3 text-sm sm:text-base">
              🔄 再戰一場（重新抽20題）
            </button>
            ${
              st.level < 20
                ? `<button id="btn-result-next-lvl" class="nb-btn nb-btn-cyan px-6 py-3 text-sm sm:text-base">
                    🚀 前往下一關 (Level ${st.level + 1})
                  </button>`
                : ''
            }
          `
              : `
            <button id="btn-result-repractice-again" class="nb-btn nb-btn-lime px-6 py-3 text-sm sm:text-base">
              ⚔️ 繼續消滅錯題
            </button>
          `
          }
          <button id="btn-result-notebook" class="nb-btn nb-btn-pink px-6 py-3 text-sm sm:text-base">
            📓 查看錯題筆記
          </button>
          <button id="btn-result-map" class="nb-btn nb-btn-surface px-6 py-3 text-sm sm:text-base">
            🗺️ 返回 20 關卡地圖
          </button>
        </div>
      </div>
    `;

    document
      .getElementById('btn-result-retry')
      ?.addEventListener('click', () => this.startLevelQuiz(st.level));

    document
      .getElementById('btn-result-next-lvl')
      ?.addEventListener('click', () => this.startLevelQuiz(st.level + 1));

    document
      .getElementById('btn-result-repractice-again')
      ?.addEventListener('click', () => this.startRepracticeQuiz());

    document
      .getElementById('btn-result-notebook')
      ?.addEventListener('click', () => this.switchView('notebook'));

    document
      .getElementById('btn-result-map')
      ?.addEventListener('click', () => this.switchView('map'));
  }

  // ==========================================================================
  // Wrong Question Notebook View (錯題筆記功能)
  // ==========================================================================
  renderNotebookView() {
    const profile = this.storage.getProfile();
    const allItems = Object.values(profile.wrongQuestions || {}).sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
    );

    const unmasteredCount = allItems.filter((x) => !x.mastered).length;
    const masteredCount = allItems.filter((x) => x.mastered).length;

    const summaryEl = document.getElementById('nb-summary-bar');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="sticker-badge bg-[#FF2E93] text-white sticker-tilt-left">專屬錯題庫</span>
              <span class="text-xs font-bold opacity-80">挑戰者：${profile.avatar || '⚡'} ${this._escapeHtml(
        profile.name
      )}</span>
            </div>
            <h2 class="text-2xl font-black">
              📓 錯題筆記本（共 ${allItems.length} 則成語｜🔥 待熟練 ${unmasteredCount}｜✅ 已熟練 ${masteredCount}）
            </h2>
          </div>

          <div class="flex flex-wrap gap-2.5">
            <button id="btn-nb-start-repractice" class="nb-btn nb-btn-lime px-5 py-2.5 text-sm" ${
              allItems.length === 0 ? 'disabled' : ''
            }>
              ⚔️ 錯題重練（消滅錯題）
            </button>
          </div>
        </div>
      `;

      document
        .getElementById('btn-nb-start-repractice')
        ?.addEventListener('click', () => this.startRepracticeQuiz());
    }

    // Apply multi-dimensional filters
    const filtered = allItems.filter((item) => {
      const idiom = this.idiomMap.get(item.targetIdiom) || {};
      const years = item.yearTags || idiom.yearTags || [];
      const customNote =
        profile.customNotes?.[item.targetIdiom] || item.customNote || '';

      if (this.nbFilter.level !== 'all') {
        if (String(item.level) !== String(this.nbFilter.level)) return false;
      }
      if (this.nbFilter.year !== 'all') {
        if (!years.includes(this.nbFilter.year)) return false;
      }
      if (this.nbFilter.status === 'unmastered' && item.mastered) return false;
      if (this.nbFilter.status === 'mastered' && !item.mastered) return false;

      if (this.nbFilter.search.trim() !== '') {
        const kw = this.nbFilter.search.trim().toLowerCase();
        const hay = `${item.targetIdiom} ${idiom.meaning || ''} ${
          item.question || ''
        } ${customNote}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    const listEl = document.getElementById('nb-cards-list');
    if (!listEl) return;

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="nb-card p-10 text-center">
          <div class="text-4xl mb-3">✨</div>
          <h3 class="text-xl font-black mb-1">
            ${
              allItems.length === 0
                ? `「${this._escapeHtml(profile.name)}」目前還沒有任何錯題紀錄！`
                : '沒有符合目前篩選條件的錯題筆記'
            }
          </h3>
          <p class="text-sm opacity-75 mb-4">
            在闖關挑戰中答錯的題目，系統都會自動連同當時誤選答案與阿任師小卡釋義收錄在這裡！
          </p>
          <button id="btn-nb-empty-go-map" class="nb-btn nb-btn-lime px-5 py-2.5 text-sm">
            🗺️ 前往 20 關卡挑戰
          </button>
        </div>
      `;
      document
        .getElementById('btn-nb-empty-go-map')
        ?.addEventListener('click', () => this.switchView('map'));
      return;
    }

    listEl.innerHTML = filtered
      .map((item, idx) => {
        const idiom = this.idiomMap.get(item.targetIdiom) || {};
        const years = item.yearTags || idiom.yearTags || [];
        const meaning = idiom.meaning || item.explanation || '';
        const phonetic = idiom.phonetic || '';
        const noteVal =
          profile.customNotes?.[item.targetIdiom] || item.customNote || '';

        return `
          <div class="nb-card p-5 border-3 ${
            item.mastered ? 'border-[#22C55E]/70' : 'border-[#FF2E93]/80'
          }">
            <!-- Top Header: Idiom Name, Level, Years, Status Toggle -->
            <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div>
                <div class="flex flex-wrap items-center gap-2 mb-1">
                  <span class="px-2.5 py-0.5 rounded bg-black text-[#CCFF00] font-mono text-xs font-black">
                    Level ${item.level || 1}
                  </span>
                  <span class="sticker-badge ${
                    item.mastered
                      ? 'bg-[#CCFF00] text-black'
                      : 'bg-[#FF2E93] text-white'
                  }">
                    ${item.mastered ? '✅ 已熟練 Mastered' : `🔥 待熟練 (累計錯 ${item.wrongCount || 1} 次)`}
                  </span>
                  ${years
                    .map(
                      (y) =>
                        `<span class="text-xs font-black px-2 py-0.5 rounded bg-[#7C4DFF] text-white border border-black">${this._escapeHtml(
                          y
                        )}</span>`
                    )
                    .join('')}
                </div>
                <h3 class="text-2xl font-black text-[#00F0FF]">
                  ${this._escapeHtml(idiom.displayName || item.targetIdiom)}
                </h3>
              </div>

              <div class="flex items-center gap-2">
                <button
                  data-nb-toggle-master="${this._escapeHtml(item.targetIdiom)}"
                  class="nb-btn ${
                    item.mastered ? 'nb-btn-surface' : 'nb-btn-lime'
                  } px-3.5 py-1.5 text-xs"
                >
                  ${item.mastered ? '↩️ 移回待複習' : '✅ 標記已熟練'}
                </button>
                <button
                  data-nb-delete="${this._escapeHtml(item.targetIdiom)}"
                  class="nb-btn nb-btn-surface px-2.5 py-1.5 text-xs text-[#FF2E93]"
                  title="從錯題筆記移除"
                >
                  🗑️
                </button>
              </div>
            </div>

            <!-- 阿任師小卡完整釋義 -->
            <div class="p-3.5 rounded-xl bg-black/25 border-2 border-black/40 mb-3">
              <div class="text-xs font-black text-[#FFB800] mb-1">📖 阿任師重點小卡釋義：</div>
              <p class="text-sm sm:text-base leading-relaxed font-medium">${this._escapeHtml(
                meaning
              )}</p>
              ${
                phonetic
                  ? `<div class="text-xs font-bold text-[#CCFF00] mt-1.5">🔊 注音提示：${this._escapeHtml(
                      phonetic
                    )}</div>`
                  : ''
              }
            </div>

            <!-- 展開查看當時答錯的原題目與誤選答案 vs 正確答案 -->
            <details class="mb-3 rounded-xl bg-black/20 border-2 border-black/40 overflow-hidden">
              <summary class="px-4 py-2.5 cursor-pointer font-black text-xs sm:text-sm flex items-center justify-between select-none hover:bg-white/5">
                <span>📂 展開查看當時答錯原題（誤選：${this._escapeHtml(
                  item.userAnswer || ''
                )} vs 正解：${this._escapeHtml(item.correctAnswer || '')}）</span>
                <span class="text-xs opacity-70">點擊展開 ▾</span>
              </summary>
              <div class="p-4 border-t-2 border-black/40 text-xs sm:text-sm space-y-2.5">
                <div class="font-black text-base">${this._escapeHtml(
                  item.question || '（原題紀錄）'
                )}</div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div class="p-2.5 rounded-lg bg-[#FF2E93]/20 border-2 border-[#FF2E93] font-bold">
                    ❌ 玩家當時誤選：${
                      item.userAnswerKey ? `(${item.userAnswerKey}) ` : ''
                    }${this._escapeHtml(item.userAnswer || '')}
                  </div>
                  <div class="p-2.5 rounded-lg bg-[#CCFF00]/20 border-2 border-[#22C55E] font-bold">
                    ✅ 本題正確答案：${
                      item.correctAnswerKey ? `(${item.correctAnswerKey}) ` : ''
                    }${this._escapeHtml(item.correctAnswer || '')}
                  </div>
                </div>
                ${
                  item.explanation
                    ? `<div class="p-3 rounded-lg bg-black/30 whitespace-pre-line leading-relaxed opacity-90">${this._escapeHtml(
                        item.explanation
                      )}</div>`
                    : ''
                }
              </div>
            </details>

            <!-- 自訂筆記欄位 -->
            <div class="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                id="nb-note-input-${idx}"
                value="${this._escapeHtml(noteVal)}"
                placeholder="✍️ 輸入你的記憶口訣、易錯字提醒或自訂筆記..."
                class="flex-1 px-3.5 py-2 rounded-xl bg-black/30 border-2 border-black text-sm focus:outline-none focus:border-[#CCFF00]"
              />
              <button
                data-nb-save-note="${this._escapeHtml(item.targetIdiom)}"
                data-nb-input-id="nb-note-input-${idx}"
                class="nb-btn nb-btn-purple px-4 py-2 text-xs sm:text-sm shrink-0"
              >
                💾 儲存筆記
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('[data-nb-toggle-master]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playClick();
        const iname = btn.getAttribute('data-nb-toggle-master');
        const newState = this.storage.toggleMastered(iname);
        this.showToast(
          newState ? `已將「${iname}」標記為 ✅ 已熟練！` : `已將「${iname}」移回 🔥 待複習！`
        );
        this.renderHeaderChallenger();
        this.renderHeroBanner();
        this.renderNotebookView();
      });
    });

    listEl.querySelectorAll('[data-nb-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playClick();
        const iname = btn.getAttribute('data-nb-delete');
        this.storage.removeWrongQuestion(iname);
        this.showToast(`已從錯題筆記移除「${iname}」`);
        this.renderHeaderChallenger();
        this.renderHeroBanner();
        this.renderNotebookView();
      });
    });

    listEl.querySelectorAll('[data-nb-save-note]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playClick();
        const iname = btn.getAttribute('data-nb-save-note');
        const inputId = btn.getAttribute('data-nb-input-id');
        const inputEl = document.getElementById(inputId);
        if (inputEl) {
          this.storage.saveCustomNote(iname, inputEl.value);
          this.showToast(`已儲存「${iname}」的自訂口訣筆記！`);
        }
      });
    });
  }

  // ==========================================================================
  // 570 Idioms Full Dex View (阿任師歷屆成語全圖鑑)
  // ==========================================================================
  renderDexView() {
    const grid = document.getElementById('dex-cards-grid');
    const countEl = document.getElementById('dex-count-label');
    if (!grid) return;

    const filtered = this.idioms.filter((it) => {
      if (this.dexFilter.level !== 'all' && String(it.level) !== String(this.dexFilter.level)) {
        return false;
      }
      if (this.dexFilter.year !== 'all' && !(it.yearTags || []).includes(this.dexFilter.year)) {
        return false;
      }
      if (this.dexFilter.stars === '2' && it.stars < 2) return false;
      if (this.dexFilter.stars === '1' && it.stars < 1) return false;

      if (this.dexFilter.search.trim() !== '') {
        const kw = this.dexFilter.search.trim().toLowerCase();
        const hay = `${it.displayName} ${it.meaning} ${it.phonetic || ''}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    if (countEl) {
      countEl.textContent = `符合條件：共 ${filtered.length} / ${this.idioms.length} 則歷屆會考成語`;
    }

    grid.innerHTML = filtered
      .map((it) => {
        const starBadge =
          it.stars >= 2
            ? '<span class="sticker-badge bg-[#FF2E93] text-white">SSR 雙星 **</span>'
            : it.stars === 1
            ? '<span class="sticker-badge bg-[#CCFF00] text-black">SR 高頻 *</span>'
            : '';
        return `
          <div class="nb-card p-4 flex flex-col justify-between">
            <div>
              <div class="flex flex-wrap items-center justify-between gap-1.5 mb-2">
                <span class="px-2 py-0.5 rounded bg-black text-[#CCFF00] font-mono text-xs font-bold">
                  Lv.${it.level}
                </span>
                <div class="flex flex-wrap gap-1">
                  ${starBadge}
                  ${(it.yearTags || [])
                    .map(
                      (y) =>
                        `<span class="text-[11px] font-bold px-2 py-0.5 rounded bg-[#7C4DFF] text-white border border-black">${this._escapeHtml(
                          y
                        )}</span>`
                    )
                    .join('')}
                </div>
              </div>
              <h3 class="text-xl font-black text-[#00F0FF] mb-1.5">
                ${this._escapeHtml(it.displayName)}
              </h3>
              <p class="text-sm leading-relaxed mb-2">${this._escapeHtml(it.meaning)}</p>
              ${
                it.phonetic
                  ? `<div class="text-xs font-bold text-[#FFB800] mb-1">🔊 ${this._escapeHtml(
                      it.phonetic
                    )}</div>`
                  : ''
              }
            </div>
            <div class="pt-2.5 mt-2 border-t border-current/15 flex items-center justify-between">
              <span class="text-[11px] opacity-70">${this._escapeHtml(it.category || '')}</span>
              <button data-dex-play-level="${it.level}" class="nb-btn nb-btn-lime px-3 py-1 text-xs">
                ⚔️ 挑戰 Lv.${it.level}
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    grid.querySelectorAll('[data-dex-play-level]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lvl = parseInt(btn.getAttribute('data-dex-play-level'), 10);
        this.startLevelQuiz(lvl);
      });
    });
  }

  // ==========================================================================
  // Challenger Switcher Modal & Cookie Inspector
  // ==========================================================================
  openChallengerModal(scrollToCookie = false) {
    this.sound.playClick();
    const modal = document.getElementById('modal-challenger');
    if (!modal) return;
    this.renderChallengerModalContent();
    modal.classList.remove('hidden');

    if (scrollToCookie) {
      setTimeout(() => {
        document
          .getElementById('cookie-inspector-box')
          ?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }

  renderChallengerModalContent() {
    const listEl = document.getElementById('challenger-list-container');
    const avatarPicker = document.getElementById('avatar-picker-row');
    const cookieBox = document.getElementById('cookie-raw-preview');
    if (!listEl) return;

    const activeName = this.storage.getActiveChallengerName();
    const challengers = this.storage.getChallengers();

    // Render Avatar Picker
    if (avatarPicker) {
      avatarPicker.innerHTML = AVATAR_CHOICES.map(
        (av) => `
        <button
          type="button"
          data-pick-avatar="${av}"
          class="w-10 h-10 rounded-xl border-2 border-black text-xl flex items-center justify-center transition ${
            this.selectedAvatar === av
              ? 'bg-[#CCFF00] scale-110 shadow-[2px_2px_0px_#000]'
              : 'bg-black/30 opacity-70 hover:opacity-100'
          }"
        >
          ${av}
        </button>
      `
      ).join('');

      avatarPicker.querySelectorAll('[data-pick-avatar]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.selectedAvatar = btn.getAttribute('data-pick-avatar');
          this.renderChallengerModalContent();
        });
      });
    }

    // Render Challenger Cards
    listEl.innerHTML = challengers
      .map((c) => {
        const prof = this.storage.getProfile(c.name, c.avatar);
        const rank = this.storage.getRankInfo(prof);
        const wqCount = Object.keys(prof.wrongQuestions || {}).length;
        const isCurrent = c.name === activeName;

        return `
          <div class="p-3.5 rounded-xl border-2 ${
            isCurrent
              ? 'border-[#CCFF00] bg-[#7C4DFF]/25'
              : 'border-black bg-black/25'
          } flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-xl border-2 border-black bg-[#7C4DFF] flex items-center justify-center text-2xl">
                ${prof.avatar || '⚡'}
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-black text-base">${this._escapeHtml(c.name)}</span>
                  ${
                    isCurrent
                      ? '<span class="sticker-badge bg-[#CCFF00] text-black text-[10px]">當前挑戰者</span>'
                      : ''
                  }
                </div>
                <div class="text-xs opacity-80">
                  ${rank.lv} ${rank.title} ｜ 破關 ${rank.clearedCount}/20 ｜ ⭐ ${
          rank.totalStars
        } ｜ 錯題 ${wqCount} 則
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2">
              ${
                !isCurrent
                  ? `<button data-switch-challenger="${this._escapeHtml(
                      c.name
                    )}" class="nb-btn nb-btn-cyan px-3 py-1.5 text-xs">
                      🔄 切換載入
                    </button>`
                  : '<span class="text-xs font-bold text-[#CCFF00] px-2">使用中 ✓</span>'
              }
              ${
                challengers.length > 1
                  ? `<button data-delete-challenger="${this._escapeHtml(
                      c.name
                    )}" class="nb-btn nb-btn-surface px-2.5 py-1.5 text-xs text-[#FF2E93]" title="刪除此挑戰者">
                      🗑️
                    </button>`
                  : ''
              }
            </div>
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('[data-switch-challenger]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetName = btn.getAttribute('data-switch-challenger');
        this.storage.setActiveChallenger(targetName);
        this.sound.playClick();
        this.refreshAllUI();
        this.renderChallengerModalContent();
        this.showToast(`已切換至挑戰者「${targetName}」！`);
      });
    });

    listEl.querySelectorAll('[data-delete-challenger]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetName = btn.getAttribute('data-delete-challenger');
        const res = this.storage.deleteChallenger(targetName);
        if (!res.ok) {
          this.showToast(res.message);
          return;
        }
        this.sound.playClick();
        this.refreshAllUI();
        this.renderChallengerModalContent();
        this.showToast(`已刪除挑戰者「${targetName}」`);
      });
    });

    if (cookieBox) {
      cookieBox.textContent =
        document.cookie || '（目前瀏覽器尚未顯示非 HttpOnly Cookie 字串）';
    }
  }

  // ==========================================================================
  // Event Bindings & Utilities
  // ==========================================================================
  _bindGlobalEvents() {
    // Nav view buttons
    document.querySelectorAll('[data-nav-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-nav-view');
        this.switchView(v);
      });
    });

    // Theme & Audio toggles
    document
      .getElementById('btn-theme-toggle')
      ?.addEventListener('click', () => this.toggleTheme());

    document
      .getElementById('btn-audio-toggle')
      ?.addEventListener('click', () => {
        this.sound.toggleMute();
        this._updateAudioButton();
      });

    // Challenger Switcher Modal triggers
    document
      .getElementById('btn-open-challenger-modal')
      ?.addEventListener('click', () => this.openChallengerModal());

    document
      .getElementById('quick-challenger-select')
      ?.addEventListener('change', (e) => {
        const name = e.target.value;
        if (name) {
          this.storage.setActiveChallenger(name);
          this.sound.playClick();
          this.refreshAllUI();
          this.showToast(`已即時載入挑戰者「${name}」的進度與錯題庫！`);
        }
      });

    // Create new challenger form
    document
      .getElementById('form-create-challenger')
      ?.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('input-new-challenger');
        if (!input) return;
        const res = this.storage.createChallenger(
          input.value,
          this.selectedAvatar
        );
        if (!res.ok) {
          this.showToast(res.message);
          return;
        }
        input.value = '';
        this.sound.playCorrect(2);
        this.refreshAllUI();
        this.renderChallengerModalContent();
        this.showToast(`成功建立並切換至挑戰者「${res.name}」！`);
      });

    // Close modal buttons
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-close-modal');
        this.closeModal(modalId);
      });
    });

    // Notebook filter listeners
    document
      .getElementById('nb-filter-search')
      ?.addEventListener('input', (e) => {
        this.nbFilter.search = e.target.value;
        this.renderNotebookView();
      });
    document
      .getElementById('nb-filter-level')
      ?.addEventListener('change', (e) => {
        this.nbFilter.level = e.target.value;
        this.renderNotebookView();
      });
    document
      .getElementById('nb-filter-year')
      ?.addEventListener('change', (e) => {
        this.nbFilter.year = e.target.value;
        this.renderNotebookView();
      });
    document
      .getElementById('nb-filter-status')
      ?.addEventListener('change', (e) => {
        this.nbFilter.status = e.target.value;
        this.renderNotebookView();
      });

    // Dex filter listeners
    document
      .getElementById('dex-filter-search')
      ?.addEventListener('input', (e) => {
        this.dexFilter.search = e.target.value;
        this.renderDexView();
      });
    document
      .getElementById('dex-filter-level')
      ?.addEventListener('change', (e) => {
        this.dexFilter.level = e.target.value;
        this.renderDexView();
      });
    document
      .getElementById('dex-filter-year')
      ?.addEventListener('change', (e) => {
        this.dexFilter.year = e.target.value;
        this.renderDexView();
      });
    document
      .getElementById('dex-filter-stars')
      ?.addEventListener('change', (e) => {
        this.dexFilter.stars = e.target.value;
        this.renderDexView();
      });
  }

  closeModal(modalId) {
    this.sound.playClick();
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
  }

  showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className =
      'nb-card px-4 py-2.5 bg-[#CCFF00] text-black font-black text-xs sm:text-sm border-2 border-black shadow-[3px_3px_0px_#000] flex items-center gap-2';
    toast.innerHTML = `<span>⚡</span><span>${this._escapeHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('opacity-0', 'transition-opacity', 'duration-300');
      setTimeout(() => toast.remove(), 300);
    }, 2400);
  }

  _escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new IdiomGameApp();
  app.init();
});
