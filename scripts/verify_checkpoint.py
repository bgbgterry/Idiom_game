# -*- coding: utf-8 -*-
"""
scripts/verify_checkpoint.py
Automated Checkpoint Validator for Idiom_game (會考成語大亂鬥)
Validates:
  1. Total levels == 20
  2. Questions per level == 100 (Total questions == 2,000)
  3. Core Checkpoint: In every level, every idiom assigned to that level has count >= 2
     questions with `targetIdiom == idiom['name']`.
  4. No dummy placeholders ("題目1", "選項A", etc.) in questions, options, or explanations,
     and all required schema fields are present and valid.
"""

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
IDIOMS_PATH = ROOT_DIR / "data" / "idioms.json"
QUESTIONS_PATH = ROOT_DIR / "data" / "questions.json"


def run_verification() -> bool:
    print("=" * 68)
    print("  Idiom_game (會考成語大亂鬥) - 自動化強制檢查點驗證 (Checkpoint)")
    print("=" * 68)

    if not IDIOMS_PATH.exists() or not QUESTIONS_PATH.exists():
        print("[FAIL] Missing data/idioms.json or data/questions.json")
        return False

    idioms = json.loads(IDIOMS_PATH.read_text(encoding="utf-8"))
    questions = json.loads(QUESTIONS_PATH.read_text(encoding="utf-8"))

    all_passed = True

    # Group idioms and questions by level
    idioms_by_level = defaultdict(list)
    for it in idioms:
        idioms_by_level[it["level"]].append(it)

    questions_by_level = defaultdict(list)
    for q in questions:
        questions_by_level[q["level"]].append(q)

    # ------------------------------------------------------------------
    # Check 1: Total Levels == 20
    # ------------------------------------------------------------------
    expected_levels = list(range(1, 21))
    actual_idiom_levels = sorted(idioms_by_level.keys())
    actual_q_levels = sorted(questions_by_level.keys())

    if actual_idiom_levels == expected_levels and actual_q_levels == expected_levels:
        print(f"[PASS] 檢查點 1：總關卡數 == 20 (Level 1 ~ Level 20，共收錄 {len(idioms)} 則歷屆成語)")
    else:
        print(f"[FAIL] 檢查點 1：關卡數異常！成語關卡={actual_idiom_levels}, 題庫關卡={actual_q_levels}")
        all_passed = False

    # ------------------------------------------------------------------
    # Check 2: Every level has exactly 100 questions (Total == 2,000)
    # ------------------------------------------------------------------
    level_counts_ok = True
    for lvl in expected_levels:
        q_cnt = len(questions_by_level[lvl])
        if q_cnt != 100:
            print(f"[FAIL] Level {lvl} 題目數為 {q_cnt}，不等於 100！")
            level_counts_ok = False

    if level_counts_ok and len(questions) == 2000:
        print(f"[PASS] 檢查點 2：每一關的題目總數 == 100 (全遊戲總計 {len(questions)} 題)")
    else:
        print(f"[FAIL] 檢查點 2：總題數異常 ({len(questions)}) 或單關題數不符")
        all_passed = False

    # ------------------------------------------------------------------
    # Check 3: Core Checkpoint - Every idiom in every level has count >= 2 as targetIdiom
    # ------------------------------------------------------------------
    coverage_ok = True
    min_count_overall = 999
    max_count_overall = 0

    for lvl in expected_levels:
        lvl_idiom_names = [it["name"] for it in idioms_by_level[lvl]]
        target_counter = Counter(q["targetIdiom"] for q in questions_by_level[lvl])

        for iname in lvl_idiom_names:
            cnt = target_counter.get(iname, 0)
            min_count_overall = min(min_count_overall, cnt)
            max_count_overall = max(max_count_overall, cnt)
            if cnt < 2:
                print(f"[FAIL] Level {lvl} 成語「{iname}」作為 targetIdiom 的題數僅 {cnt} 題 (< 2)！")
                coverage_ok = False

    if coverage_ok:
        print(
            f"[PASS] 檢查點 3：【核心檢查點】每關所有成語皆至少有 2 題作為 targetIdiom "
            f"(實測每成語題數區間：{min_count_overall} ~ {max_count_overall} 題，100% 達標)"
        )
    else:
        all_passed = False

    # ------------------------------------------------------------------
    # Check 4: No dummy placeholders & Schema integrity
    # ------------------------------------------------------------------
    bad_patterns = [
        r"題目\s*\d+",
        r"選項\s*[ABCD1234]",
        r"placeholder",
        r"TODO",
        r"假資料",
        r"測試題目",
    ]
    bad_regex = re.compile("|".join(bad_patterns), re.IGNORECASE)
    required_keys = {
        "id",
        "level",
        "targetIdiom",
        "yearTags",
        "question",
        "options",
        "answer",
        "explanation",
    }

    placeholder_errors = []
    for q in questions:
        missing = required_keys - set(q.keys())
        if missing:
            placeholder_errors.append(f"{q.get('id')} 缺少欄位: {missing}")
            continue

        opts = q["options"]
        if not isinstance(opts, dict) or set(opts.keys()) != {"A", "B", "C", "D"}:
            placeholder_errors.append(f"{q['id']} options 結構錯誤")
            continue

        if q["answer"] not in {"A", "B", "C", "D"}:
            placeholder_errors.append(f"{q['id']} answer 非 A/B/C/D: {q['answer']}")

        # Check distinct options
        opt_vals = [str(v).strip() for v in opts.values()]
        if len(set(opt_vals)) < 4 or any(len(v) == 0 for v in opt_vals):
            placeholder_errors.append(f"{q['id']} 出現重複或空白選項: {opts}")

        combined_text = (
            q["question"]
            + " "
            + " ".join(opt_vals)
            + " "
            + q["explanation"]
        )
        if bad_regex.search(combined_text):
            placeholder_errors.append(f"{q['id']} 偵測到疑似佔位符文字")

    if not placeholder_errors:
        print("[PASS] 檢查點 4：全數 2,000 題結構完整、選項無重複且無任何佔位符（Placeholder）")
    else:
        print(f"[FAIL] 檢查點 4：發現 {len(placeholder_errors)} 項問題：")
        for err in placeholder_errors[:10]:
            print("  -", err)
        all_passed = False

    print("=" * 68)
    if all_passed:
        print("🎉 CHECKPOINT VALIDATION: 100% PASS! 准許進入前端開發階段！")
    else:
        print("❌ CHECKPOINT VALIDATION: FAILED! 請修正題庫後重新驗證。")
    print("=" * 68)
    return all_passed


if __name__ == "__main__":
    ok = run_verification()
    sys.exit(0 if ok else 1)
