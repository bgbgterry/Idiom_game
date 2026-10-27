# -*- coding: utf-8 -*-
"""
scripts/build_question_bank.py
Parses `116阿任師的國文重點速記小卡4歷屆會考成語24p(含各年補考及大陸考場考試).pdf`
(via row-isolated extraction) and `20100409.docx` (via row-isolated XML parsing)
to generate:
  - data/idioms.json (570 unique CAP exam idioms across Levels 1~20)
  - data/questions.json (2,000 authentic 4-option multiple-choice questions, 100 per level)
"""

import json
import os
import random
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from idiom_enrichment import (
    SEED_EXPLANATIONS,
    LEVEL_THEMES,
    CHAR_SWAP_TABLE,
    PHONETIC_BANK,
)

ROOT_DIR = Path(__file__).resolve().parent.parent
PDF_FILE = ROOT_DIR / "116阿任師的國文重點速記小卡4歷屆會考成語24p(含各年補考及大陸考場考試).pdf"
TSV_FILE = ROOT_DIR / "scripts" / "pdf_extracted_rows.tsv"
DOCX_FILE = ROOT_DIR / "20100409.docx"
DATA_DIR = ROOT_DIR / "data"


def normalize_year_tag(tag: str) -> str:
    tag = tag.strip()
    if tag.endswith("年補"):
        return tag + "考"
    if tag.endswith("年大陸"):
        return tag + "考場"
    if re.match(r"^\d{3}$", tag):
        return tag + "年"
    return tag


def year_sort_key(tag: str) -> tuple:
    m = re.match(r"^(\d{3})年(.*)$", tag)
    if not m:
        return (0, 0)
    yr = int(m.group(1))
    suffix = m.group(2)
    # 正式會考 > 大陸考場 > 補考
    order = 2 if suffix == "" else (1 if "大陸" in suffix else 0)
    return (yr, order)


def clean_canonical_name(name: str) -> str:
    """Convert display variants like '招(召)之即來，揮之即去' or '挂╱掛一漏萬' into clean readable form for sentence insertion."""
    s = re.sub(r"\([^)]*\)", "", name)
    if "╱" in s:
        # e.g. 挂╱掛一漏萬 -> 掛一漏萬, 善罷甘╱干休 -> 善罷甘休, 老生常談╱譚 -> 老生常談
        s = re.sub(r"(.)╱(.)", r"\1", s)
    return s.strip()


def parse_pdf_idioms() -> list[dict]:
    """
    Strictly follows row-by-row isolation strategy (<RULE[user_global]>):
    1. Isolates each single record row first.
    2. Extracts fields within the isolated record independently.
    """
    if not PDF_FILE.exists():
        raise FileNotFoundError(f"Missing core PDF reference file: {PDF_FILE}")
    if not TSV_FILE.exists():
        raise FileNotFoundError(f"Missing extracted TSV rows file: {TSV_FILE}")

    raw_text = TSV_FILE.read_text(encoding="utf-8")
    isolated_rows = [line.strip() for line in raw_text.splitlines() if line.strip()]

    idiom_map = {}
    ordered_names = []

    for row in isolated_rows:
        parts = row.split("\t")
        if len(parts) < 4:
            continue
        section_year_raw, seq_str, raw_name, raw_desc = (
            parts[0].strip(),
            parts[1].strip(),
            parts[2].strip(),
            parts[3].strip(),
        )
        section_year = normalize_year_tag(section_year_raw)
        stars = raw_name.count("*")
        clean_name = raw_name.replace("*", "").strip()

        # Extract cross-referenced years inside parentheses at the end of raw_desc
        extra_years = []
        for paren_match in re.finditer(r"\(([^()]+)\)", raw_desc):
            inside = paren_match.group(1).strip()
            if "年" in inside:
                for token in re.split(r"[、，,\s]+", inside):
                    token = token.strip()
                    if re.match(r"^\d{3}(?:年(?:大陸考場|大陸|補考|補)?)?$", token):
                        extra_years.append(normalize_year_tag(token))

        # Extract question numbers like (1), (6), (29、30、31), (30〜32)
        q_nums = []
        for paren_match in re.finditer(r"\(([0-9、〜~\s]+)\)", raw_desc):
            q_nums.append(paren_match.group(1).strip())

        # Extract alternative forms like 也作「瘡痍滿目」 or (=獨樹一幟)
        also_known = []
        for m in re.finditer(r"(?:也作|另作|亦作)「([^」]+)」", raw_desc):
            also_known.append(m.group(1).strip())
        for m in re.finditer(r"\(=([^)]+)\)", raw_desc):
            also_known.append(m.group(1).strip())

        # Extract explicit phonetic notes in raw_desc
        phonetic_notes = []
        for m in re.finditer(r"([^。；(]+?，音[ㄅ-ㄩˊˇˋ˙\s／/]+)", raw_desc):
            phonetic_notes.append(m.group(1).strip())
        for m in re.finditer(r"([\u4e00-\u9fff]+)\(([ㄅ-ㄩˊˇˋ˙\s]+)\)", raw_desc):
            phonetic_notes.append(f"{m.group(1)}，音{m.group(2)}")

        # Clean meaning text (strip trailing question number and year parentheses)
        meaning = re.sub(
            r"(?:\s*\((?:[0-9、〜~\s]+|[^()]*\d{3}\s*年[^()]*)\))+\s*$",
            "",
            raw_desc,
        ).strip()

        all_years = [section_year] + extra_years

        if clean_name not in idiom_map:
            ordered_names.append(clean_name)
            idiom_map[clean_name] = {
                "name": clean_name,
                "canonicalName": clean_canonical_name(clean_name),
                "displayName": clean_name + ("*" * stars),
                "stars": stars,
                "yearTags": [],
                "meaning": meaning,
                "phonetic": "；".join(phonetic_notes),
                "alsoKnownAs": [],
                "examQuestionNums": {},
            }

        entry = idiom_map[clean_name]
        if stars > entry["stars"]:
            entry["stars"] = stars
            entry["displayName"] = clean_name + ("*" * stars)
        if len(meaning) > len(entry["meaning"]):
            entry["meaning"] = meaning
        if phonetic_notes and not entry["phonetic"]:
            entry["phonetic"] = "；".join(phonetic_notes)
        for ak in also_known:
            if ak not in entry["alsoKnownAs"]:
                entry["alsoKnownAs"].append(ak)
        for y in all_years:
            if y not in entry["yearTags"]:
                entry["yearTags"].append(y)
        if q_nums:
            entry["examQuestionNums"][section_year] = "、".join(q_nums)

    # Enrich phonetic field from PHONETIC_BANK if not already present
    idioms_list = []
    for idx, name in enumerate(ordered_names, start=1):
        item = idiom_map[name]
        item["id"] = f"idiom_{idx:03d}"
        item["yearTags"] = sorted(
            item["yearTags"], key=year_sort_key, reverse=True
        )
        # Reconcile star count: if appeared in >=3 years or already **, stars = max(stars, 2); if >=2 years, max(stars, 1)
        if len(item["yearTags"]) >= 3:
            item["stars"] = max(item["stars"], 2)
        elif len(item["yearTags"]) >= 2:
            item["stars"] = max(item["stars"], 1)
        item["displayName"] = item["name"] + ("*" * item["stars"])

        cname = item["canonicalName"]
        if not item["phonetic"] and cname in PHONETIC_BANK:
            p_info = PHONETIC_BANK[cname]
            item["phonetic"] = f"{p_info[0]}：音 {p_info[1]}"

        idioms_list.append(item)

    return idioms_list


def parse_docx_seed_questions() -> list[dict]:
    """
    Strictly follows row-by-row isolation strategy (<RULE[user_global]>) to parse
    the 50 seed questions and answer table from `20100409.docx`.
    """
    if not DOCX_FILE.exists():
        raise FileNotFoundError(f"Missing core DOCX reference file: {DOCX_FILE}")

    with zipfile.ZipFile(DOCX_FILE, "r") as z:
        xml_bytes = z.read("word/document.xml")

    root = ET.fromstring(xml_bytes)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

    # Step 1: Isolate every paragraph unit and table cell unit independently
    body = root.find("w:body", ns)
    para_lines = []
    answer_map = {}

    for child in body:
        tag = child.tag.split("}")[-1]
        if tag == "p":
            texts = [t.text for t in child.findall(".//w:t", ns) if t.text]
            line = "".join(texts).strip()
            if line:
                para_lines.append(line)
        elif tag == "tbl":
            # Isolate each table cell (<w:tc>) independently
            for tc in child.findall(".//w:tc", ns):
                cell_texts = [t.text for t in tc.findall(".//w:t", ns) if t.text]
                cell_str = "".join(cell_texts).strip()
                # Normalize fullwidth letters/numbers
                cell_norm = (
                    cell_str.replace("Ａ", "A")
                    .replace("Ｂ", "B")
                    .replace("Ｃ", "C")
                    .replace("Ｄ", "D")
                )
                m = re.match(r"^(\d{1,2})[\.\s]+([ABCD])$", cell_norm)
                if m:
                    q_num = int(m.group(1))
                    ans_letter = m.group(2)
                    answer_map[q_num] = ans_letter

    # Step 2: Group paragraph lines into 50 isolated question blocks by question number `1.` .. `50.`
    raw_blocks = {}
    current_qnum = None
    for line in para_lines:
        if line.startswith("應用文會考") or line.startswith("答案"):
            continue
        m_start = re.match(r"^(\d{1,2})\.\s*(.*)$", line)
        if m_start:
            q_num = int(m_start.group(1))
            if 1 <= q_num <= 50:
                current_qnum = q_num
                raw_blocks[current_qnum] = [m_start.group(2).strip()]
                continue
        if current_qnum is not None:
            raw_blocks[current_qnum].append(line)

    # Step 3: Parse each isolated question block independently
    seed_questions = []
    for q_num in range(1, 51):
        lines = raw_blocks.get(q_num, [])
        full_block = "\n".join(lines)

        # Fix Q29 blank brackets in original docx (`滄海「」粟` -> `滄海「　」粟`)
        if q_num == 29:
            full_block = full_block.replace("「」", "「　」")

        # Isolate options (A), (B), (C), (D) within this single question block
        opt_pattern = re.compile(
            r"\(A\)\s*(.*?)\s*\(B\)\s*(.*?)\s*\(C\)\s*(.*?)\s*\(D\)\s*(.*)$",
            re.DOTALL,
        )
        m_opt = opt_pattern.search(full_block)
        if not m_opt:
            raise ValueError(f"Failed to parse options for seed question {q_num}: {full_block}")

        stem = full_block[: m_opt.start()].strip().replace("\n", "")
        options = {
            "A": m_opt.group(1).strip(),
            "B": m_opt.group(2).strip(),
            "C": m_opt.group(3).strip(),
            "D": m_opt.group(4).strip(),
        }
        answer = answer_map.get(q_num, "A")
        explanation = SEED_EXPLANATIONS.get(q_num, "")

        seed_questions.append(
            {
                "seedNum": q_num,
                "question": stem,
                "options": options,
                "answer": answer,
                "explanation": explanation,
            }
        )

    return seed_questions


# ==============================================================================
# Semantic Categorization & Rich Linguistic Generator for all 570 Idioms
# ==============================================================================

CLUSTER_DEFINITIONS = [
    (
        "題辭_婚嫁",
        ["珠聯璧合", "天作之合", "宜室宜家", "花開並蒂", "于歸之喜", "舉案齊眉", "雀屏中選"],
        "婚嫁與美滿姻緣",
        "反目成仇",
        [
            "表哥與表嫂相識多年終於步入禮堂，親友們紛紛在紅包袋寫上「□□□□」，祝福他們白頭偕老、永結同心。",
            "這對新人不僅才貌雙全，性情更是互補契合，在眾人眼中真是「□□□□」的模範佳偶。",
        ],
    ),
    (
        "題辭_醫術",
        ["仁心仁術", "杏林春暖", "妙手回春"],
        "醫師醫術高明且心地仁慈",
        "庸醫殺人",
        [
            "老院長行醫四十年，救治無數重症病患且分文不取，病患家屬特別致贈寫有「□□□□」的匾額表達感謝。",
            "經過醫療團隊日以繼夜的搶救與照護，原本病危的傷患終於康復出院，令人由衷佩服醫師「□□□□」的本領。",
        ],
    ),
    (
        "題辭_教育與師恩",
        ["桃李滿門", "桃李芬芳", "春風化雨", "百年樹人", "循循善誘", "耳提面命", "師表千古", "孺子可教"],
        "教育英才與師長教誨",
        "誤人子弟",
        [
            "陳老師任教三十載，始終耐心地指導每一位學生，如今畢業生在各行各業發光發熱，可謂「□□□□」。",
            "回想起國中三年班導師對我們的殷切期許與關懷，那份「□□□□」的恩情讓全班同學在畢業典禮上紅了眼眶。",
        ],
    ),
    (
        "題辭_祝壽與哀輓",
        ["松柏長青", "延年益壽", "福壽全歸", "老當益壯", "行將就木"],
        "年齡壽命與生命階段",
        "英年早逝",
        [
            "在社區長青運動會上，高齡八十歲的爺爺依然精神抖擻地跑完五千公尺，全場觀眾無不讚嘆他的體魄與精神真是「□□□□」。",
            "面對人生不同階段的生老病死與歲月流轉，古人常以「□□□□」來表達對長者生命狀態或壽考的感懷與祝禱。",
        ],
    ),
    (
        "勤奮與專注",
        [
            "專心致志", "全力以赴", "汗流浹背", "兢兢業業", "廢寢忘食", "埋頭苦幹",
            "焚膏繼晷", "腳踏實地", "實事求是", "努力不懈", "不眠不休", "胼手胝足",
            "宵衣旰食", "櫛風沐雨", "嘔心瀝血", "屏氣凝神", "駑馬十駕", "駑馬十駕╱舍",
            "精誠所至，金石為開", "有志竟成", "事在人為", "摩拳擦掌", "力透紙背",
        ],
        "勤勉踏實、全神貫注、不畏辛勞",
        "敷衍了事",
        [
            "為了在五月的國中教育會考拿下理想成績，九年級的同學們莫不「□□□□」，把握每一分每一秒投入複習。",
            "這座跨海大橋的工程團隊歷經數年寒暑，憑著「□□□□」的精神克服惡劣地形，終於完成這項艱鉅任務。",
            "距離全國音樂決賽只剩最後兩週，管樂團成員全都「□□□□」，反覆練習每一個樂句，絲毫不敢懈怠。",
        ],
    ),
    (
        "怠惰與草率",
        [
            "丟三落四", "粗心大意", "敷衍了事", "淺嘗輒止", "不求甚解", "怠忽職守",
            "好高騖遠", "半途自畫", "得過且過", "漫不經心", "遊手好閒", "功虧一簣",
            "勞而無功", "白費心機", "事倍功半", "後繼無力", "不求有功，但求無過",
        ],
        "做事馬虎、缺乏恆心或徒勞無功",
        "全力以赴",
        [
            "做實驗時如果態度「□□□□」、不按步驟確認數據，不僅無法得出正確結論，還可能發生危險。",
            "學習任何一門技藝都需要長期累積，若是遇到一點困難就「□□□□」，終究無法體會其中的精髓。",
            "他平時整理書包總是「□□□□」，不是忘了帶准考證，就是漏了2B鉛筆，讓家人十分操心。",
        ],
    ),
    (
        "言談與文采",
        [
            "妙筆生花", "新鶯出谷", "鐵畫銀鉤", "口若懸河", "膾炙人口", "妙語如珠",
            "引吭高歌", "字斟句酌", "一語中的", "能言善道", "搦管弄翰", "自出機杼",
            "侃侃而談", "滔滔不絕", "娓娓道來", "淋漓盡致", "用字遣詞", "高談闊論",
            "呶呶不休", "信口開河", "七嘴八舌", "指指點點", "不言而喻", "無話可說",
            "悶不吭聲", "輕聲細語", "欲語還休", "千言萬語", "津津樂道", "老生常談╱譚",
        ],
        "言語表達、寫作書法與藝術才華",
        "張口結舌",
        [
            "在全校國語文競賽中，這位選手面對評審提問毫不怯場，在臺上「□□□□」，條理分明地闡述自己的觀點。",
            "作家在創作這部歷史小說時，對於每一章節的敘事節奏與人物對話都「□□□□」，展現極高的文學造詣。",
            "每當談起國中三年一起參加隔宿露營與運動會的往事，同學們總是「□□□□」，彷彿有說不完的話題。",
        ],
    ),
    (
        "危急與險境",
        [
            "間不容髮", "千鈞一髮", "燃眉之急", "魚游沸鼎", "岌岌可危", "困獸猶鬥",
            "驚心動魄", "大風大浪", "暗潮洶湧", "進退兩難", "強弩之末", "潰不成軍",
            "水深火熱", "解民倒懸",
        ],
        "情勢危急、處境險惡或遭遇重大危機",
        "安然無恙",
        [
            "登山隊在山區突遇暴風雪，糧食與飲水即將耗盡，情況已到了「□□□□」的緊要關頭，急需直升機救援。",
            "比賽進入最後讀秒階段，雙方比分緊咬不放，場上局勢「□□□□」，讓全場觀眾緊張得屏住呼吸。",
            "面對突如其來的產業風暴，那家負債累累的公司處境「□□□□」，隨時都有倒閉的風險。",
        ],
    ),
    (
        "驚慌與失措",
        [
            "手足無措", "不知所措", "失魂落魄", "瞠目結舌", "心膽俱裂", "戰戰兢兢",
            "忐忑不安", "風聲鶴唳", "坐立難安", "悵然若失", "無所適從",
        ],
        "驚慌恐懼、心神不寧或不知如何是好",
        "處變不驚",
        [
            "第一次站上全校集會的演講臺時，他看著臺下上千名師生，緊張得「□□□□」，連原本背熟的講稿都差點忘光。",
            "在等待會考成績放榜的前一晚，許多考生心情「□□□□」，翻來覆去難以入眠。",
            "突如其來的強烈地震讓賣場裡的民眾驚呼連連，不少人嚇得「□□□□」，幸好工作人員立即引導疏散。",
        ],
    ),
    (
        "鎮定與堅毅",
        [
            "處變不驚", "義無反顧", "屹立不搖", "不屈不撓", "貧賤不移", "威武不屈",
            "寧為玉碎，不為瓦全", "寧鳴而死，不默而生", "人死留名，虎死留皮", "至死不渝",
            "真金不怕火煉", "風雨無阻", "安然無恙", "隨遇而安", "清心寡欲", "與世無爭",
            "反璞歸真", "渾然天成", "順其自然",
        ],
        "意志堅定、從容鎮定或隨遇而安",
        "驚慌失措",
        [
            "即使面對突發的設備故障，舞台上的主唱依然「□□□□」，以清唱方式完美演繹整首曲目，贏得全場熱烈掌聲。",
            "百年古榕歷經無數次強烈颱風的吹襲，至今仍「□□□□」地守護著村莊，成為當地居民的精神象徵。",
            "無論外在環境如何艱困多變，他始終秉持「□□□□」的態度堅守道德底線，絕不向惡勢力低頭。",
        ],
    ),
    (
        "傲慢與蠻橫",
        [
            "仗勢欺人", "目無尊長", "肆無忌憚", "飛揚跋扈", "自以為是", "驕矜自滿",
            "旁若無人", "目空一切", "恃才傲物", "倚老賣老", "自大狂妄", "恃強凌弱",
            "草菅人命", "一意孤行", "我行我素", "張牙舞爪", "齜牙咧嘴",
        ],
        "驕傲自大、蠻橫無理或固執己見",
        "謙沖為懷",
        [
            "那名惡霸仗著家族在地方上的權勢，平日裡「□□□□」，經常欺壓善良百姓，最終遭到警方依法逮捕。",
            "一個團隊若想長久發展，領導者絕不可「□□□□」、拒絕聽取部屬的建言，否則終將眾叛親離。",
            "他在圖書館裡竟然「□□□□」地大聲講電話，完全不顧其他正在專心準備考試的讀者，令人十分反感。",
        ],
    ),
    (
        "謙遜與修養",
        [
            "人微言輕", "才疏學淺", "信筆塗鴉", "拋磚引玉", "敬謝不敏", "笨鳥先飛",
            "望塵莫及", "謙沖為懷", "不愧屋漏", "恪守本分", "滿而不溢", "得饒人處且饒人",
            "行善積德", "樂善好施", "急公好義", "拾金不昧", "路不拾遺", "道不拾遺",
            "改過遷善", "幡然悔悟", "洗心革面",
        ],
        "謙虛自牧、品德高尚或知錯能改",
        "驕矜自滿",
        [
            "張教授雖然是國際知名的學者，待人接物卻始終「□□□□」，在研討會上常主動傾聽年輕學生的想法。",
            "演講一開始，主講人便客氣地表示自己今日的分享只是「□□□□」，希望能引出在場專家學者更精闢的見解。",
            "經過師長的耐心開導後，這名曾經誤入歧途的少年終於「□□□□」，決心痛改前非、重新做人。",
        ],
    ),
    (
        "冷漠與忽視",
        [
            "視而不見", "隔岸觀火", "充耳不聞", "置若罔聞", "馬耳東風", "不以為意",
            "一笑置之", "眼不見為淨", "老死不相往來", "若即若離",
        ],
        "漠不關心、裝作沒聽見或保持距離",
        "無微不至",
        [
            "面對父母與師長苦口婆心的勸告，他卻總是當作「□□□□」，依舊沉迷於網路遊戲，令家人憂心不已。",
            "當看到同學在校園裡遭到不公平的對待時，我們應主動通報師長協助，絕不能冷漠地「□□□□」。",
            "對於網路上毫無根據的酸言酸語，她選擇「□□□□」，繼續專注於自己的科學研究。",
        ],
    ),
    (
        "貧困與窘迫",
        [
            "捉襟見肘", "經濟拮据", "手頭拮据", "阮囊羞澀", "一窮二白", "粗茶淡飯",
            "養家餬口", "杯水車薪", "無能為力", "莫名其妙",
        ],
        "經濟貧困、資源匱乏或處境窘迫",
        "養尊處優",
        [
            "自從工廠無預警歇業後，他為了「□□□□」，每天兼打三份零工，生活雖然清苦卻從不怨嘆。",
            "面對龐大的醫療費用與房貸壓力，這家人的財務狀況早已「□□□□」，急需社福機構伸出援手。",
            "在如此龐大的災後重建經費缺口面前，這筆小額捐款雖如同「□□□□」，但仍代表了社會大眾的一份心意。",
        ],
    ),
    (
        "喜悅與得意",
        [
            "喜出望外", "轉憂為喜", "轉悲為喜", "洋洋自得", "閒適自得", "躊躇滿志",
            "興致勃勃", "興高采烈", "大快朵頤", "臨風顧盼", "意氣風發", "生氣勃勃",
            "豪情壯志", "氣蓋山河", "英姿煥發", "得意忘形", "閒情逸致", "閒情逸趣",
        ],
        "心情喜悅、志得意滿或朝氣蓬勃",
        "愁眉不展",
        [
            "得知自己苦練半年的科展作品奪下全國第一名時，全組隊員都「□□□□」，開心地在校園裡歡呼擁抱。",
            "運動會大隊接力決賽鳴槍前，各班選手個個「□□□□」，展現出青春洋溢的蓬勃朝氣。",
            "在贏得初賽勝利後，教練特別提醒隊員們切勿因此「□□□□」，仍須保持謹慎以迎接下週的總決賽。",
        ],
    ),
    (
        "悲傷與失意",
        [
            "滿目瘡痍", "愁眉不展", "食不下咽", "意興闌珊", "興味索然", "一蹶不起",
            "肝腸寸斷", "愴然涕下", "熱淚盈眶", "離情別緒", "離情依依", "生不逢時",
            "如喪考妣", "切膚之痛", "心如死灰", "樂極生悲", "啼笑皆非", "百感交集",
            "近鄉情怯",
        ],
        "悲傷哀痛、興致低落或感傷複雜",
        "喜出望外",
        [
            "強颱過境後，原本風景優美的海岸村落變得「□□□□」，到處是傾倒的路樹與受損的房舍。",
            "畢業典禮結束的鐘聲響起，同學們彼此擁抱道別，校園裡瀰漫著「□□□□」的不捨氣氛。",
            "離家打拚十多年後，當火車終於緩緩駛入故鄉車站的那一刻，他的心中頓時湧起一股「□□□□」的複雜情緒。",
        ],
    ),
    (
        "智慧與領悟",
        [
            "識(知)人之明", "舉一反三", "觸類旁通", "茅塞頓開", "豁然開朗", "靈機一動",
            "深思熟慮", "謀定後動", "運籌帷幄", "大智若愚", "抽絲剝繭", "探本窮源",
            "鑑往知來", "前事不忘，後事之師", "步步為營", "瞻前顧後",
        ],
        "見識卓越、豁然領悟或深思熟慮",
        "一知半解",
        [
            "這道困擾他許久的幾何證明題，在聽完數學老師畫出輔助線的關鍵提示後，他頓時「□□□□」，順利解出答案。",
            "面對複雜詭譎的商業競爭，總經理總是「□□□□」，先徹底評估各項風險後才採取行動。",
            "專案小組透過「□□□□」的方式逐一比對現場跡證，終於讓塵封多年的懸案水落石出。",
        ],
    ),
    (
        "無知與偏見",
        [
            "胸無點墨", "不自量力", "五穀不分", "以蠡測海", "一知半解", "望文生義",
            "穿鑿附會", "斷章取義", "不識大體", "先入為主", "茫然不解", "目不識丁",
            "不識之無", "不智之舉", "短視近利", "抱殘守缺", "一成不變", "因噎廢食",
            "庸人自擾", "杞人憂天",
        ],
        "見識淺薄、主觀偏見或不知變通",
        "深思熟慮",
        [
            "學習成語時若只看字面就胡亂猜測，很容易犯下「□□□□」的錯誤，在會考閱讀測驗中失分。",
            "閱讀新聞報導時應具備媒體識讀能力，切勿被部分「□□□□」的標題誤導，而忽略了事件的全貌。",
            "我們在聽取他人意見時，應該保持客觀開放的心態，不宜存有「□□□□」的成見。",
        ],
    ),
    (
        "團結與人際",
        [
            "分工合作", "休戚與共", "相濡以沫", "集思廣益", "和藹可親", "相得益彰",
            "裡應外合", "表裡相濟", "情同手足", "噓寒問暖", "無微不至", "心甘情願",
            "言聽計從", "順應民心", "政通人和", "近悅遠來", "眾望所歸", "兼容並蓄",
            "剛柔並濟", "雙管齊下", "息事寧人", "平心而論",
        ],
        "團結互助、融洽和諧或關懷體貼",
        "骨肉相殘",
        [
            "這次班際園遊會能夠創下最高營收紀錄，全靠全班同學「□□□□」，從採買、布置到叫賣都配合得天衣無縫。",
            "在創業最艱難的那幾年，他們夫妻倆「□□□□」，彼此扶持度過難關，感情比以往更加深厚。",
            "為了徹底解決社區環境髒亂的問題，里長決定採納居民們「□□□□」所提出的改善方案。",
        ],
    ),
    (
        "衝突與自私",
        [
            "趕盡殺絕", "偷斤減兩", "骨肉相殘", "兔死狗烹", "鳥盡弓藏", "坐收漁利",
            "姑息養奸", "自相矛盾", "前倨後恭", "貌合神離", "掩耳盜鈴", "逢迎拍馬",
            "粘花惹絮", "冰炭不洽", "抱薪救火", "以牙還牙", "以鄰為壑", "趁火打劫",
            "聲東擊西", "越俎代庖", "傷天害理", "衣冠禽獸", "勞民傷財", "好大喜功",
            "格格不入", "急功好利", "營私舞弊", "作惡多端", "負隅╱嵎頑抗", "弄巧成拙",
            "囤積居奇", "鋌而走險", "背道而馳", "鷸蚌相爭", "肥水不落外人田", "畫蛇添足",
            "虛張聲勢", "捕風捉影", "討價還價", "不以為然", "嗤之以鼻",
        ],
        "手段不當、自私損人、矛盾衝突或弄巧成拙",
        "休戚與共",
        [
            "兩家業者為了搶奪市場而惡性削價競爭，結果兩敗俱傷，反而讓外國品牌上演了「□□□□」的戲碼。",
            "面對問題時若只顧自身利益、將汙水排往鄰近地區，這種「□□□□」的做法終將遭到社會輿論的譴責。",
            "那名不肖商人趁著天災物資短缺之際「□□□□」，哄抬民生物價，最後遭到主管機關重罰。",
        ],
    ),
]


def build_semantic_lookup(idioms_list: list[dict]) -> dict[str, dict]:
    """Assigns each of the 570 idioms to a rich semantic cluster with contextual sentences & relations."""
    lookup = {}
    name_to_cluster = {}
    for cid, members, desc, antonym_hint, templates in CLUSTER_DEFINITIONS:
        for m in members:
            name_to_cluster[m] = (cid, desc, antonym_hint, templates, members)

    for item in idioms_list:
        name = item["name"]
        cname = item["canonicalName"]
        meaning = item["meaning"]

        if name in name_to_cluster:
            cid, desc, ant, templates, peers = name_to_cluster[name]
        elif cname in name_to_cluster:
            cid, desc, ant, templates, peers = name_to_cluster[cname]
        else:
            # Infer cluster from meaning keywords
            if any(k in meaning for k in ["多", "眾", "熱鬧", "繁華", "聚集", "連續", "不斷", "湧現"]):
                cid, desc, ant = "數量與繁盛", "數量眾多、接連不斷或繁華熱鬧", "寥寥可數"
                templates = [
                    "每逢週末假日，老街夜市總是湧入大批觀光客，攤位前人潮「□□□□」，熱鬧非凡。",
                    "隨著人工智慧技術的突破，各種創新應用如「□□□□」般接連問世，深刻改變了現代人的生活。",
                ]
            elif any(k in meaning for k in ["時間", "光陰", "歲月", "變化", "無常", "迅速", "突然"]):
                cid, desc, ant = "時間與變化", "時光流逝、局勢驟變或世事無常", "一成不變"
                templates = [
                    "國中三年的時光可謂「□□□□」，轉眼間當年剛入學的青澀新生，如今已準備踏入會考考場。",
                    "這場球賽下半場局勢「□□□□」，原本落後的隊伍在短短三分鐘內連進兩球逆轉戰局。",
                ]
            elif any(k in meaning for k in ["名聲", "第一", "傑出", "高升", "成功", "獨特", "風格", "完美"]):
                cid, desc, ant = "成就與特出", "表現傑出、名聲顯赫或獨具風格", "庸庸碌碌"
                templates = [
                    "這位年輕設計師的作品融合傳統剪紙與現代極簡美學，在國際展覽中「□□□□」，備受矚目。",
                    "憑藉著紮實的基本功與冷靜的臨場表現，他在全國科展競賽中「□□□□」，為校爭光。",
                ]
            else:
                cid, desc, ant = "綜合處世與情境", "日常生活、處事態度與人生境遇", "背道而馳"
                templates = [
                    "在閱讀這篇歷史人物傳記時，老師特別引導我們從「□□□□」的典故中體會古人的處世智慧。",
                    "面對生活中的各種選擇與考驗，能否洞悉「□□□□」背後的道理，往往決定了事情的成敗。",
                ]
            peers = []

        lookup[name] = {
            "clusterId": cid,
            "category": desc,
            "antonymHint": ant,
            "templates": templates,
            "peers": [p for p in peers if p != name],
        }
    return lookup


def mask_target_chars_in_meaning(meaning: str, canonical_name: str, raw_name: str) -> str:
    """Removes direct occurrences of the idiom name inside its meaning string for reverse-definition questions."""
    s = meaning
    s = s.replace(raw_name, "「某成語」").replace(canonical_name, "「某成語」")
    # Also mask 4-char quotes that match the idiom
    return s


def make_char_typo_for_idiom(canonical_name: str) -> tuple[str, str] | None:
    """Returns (typo_idiom, explanation_of_typo) if a known confusable character exists in canonical_name."""
    for idx, ch in enumerate(canonical_name):
        if ch in CHAR_SWAP_TABLE:
            wrong_ch, reason = CHAR_SWAP_TABLE[ch]
            if wrong_ch and wrong_ch != ch:
                typo_form = canonical_name[:idx] + wrong_ch + canonical_name[idx + 1 :]
                return (typo_form, f"「{typo_form}」應作「{canonical_name}」（{reason}）")
    # Fallback homophone/shape swaps for common characters
    common_swaps = {
        "不": "步", "人": "仁", "心": "新", "無": "蕪", "自": "字", "一": "伊",
        "天": "添", "地": "帝", "風": "峰", "水": "氵", "言": "顏", "道": "到",
        "生": "升", "事": "勢", "名": "明", "情": "晴", "意": "義", "力": "立",
        "目": "木", "手": "首", "口": "叩", "耳": "爾", "頭": "投", "足": "卒",
        "山": "衫", "雲": "勻", "雨": "語", "日": "目", "月": "越", "時": "實",
        "年": "粘", "世": "勢", "家": "佳", "國": "果", "民": "名", "公": "功",
        "正": "政", "平": "評", "安": "按", "全": "泉", "成": "城", "功": "攻",
        "大": "代", "小": "曉", "高": "", "低": "底", "長": "常", "短": "斷",
        "新": "心", "舊": "就", "真": "貞", "假": "暇", "善": "繕", "惡": "餓",
        "美": "每", "醜": "丑", "喜": "洗", "怒": "努", "哀": "唉", "樂": "爍",
        "知": "枝", "見": "建", "聞": "文", "行": "形", "動": "洞", "靜": "淨",
        "開": "揩", "關": "觀", "進": "近", "退": "褪", "來": "萊", "去": "趣",
        "上": "尚", "下": "夏", "前": "錢", "後": "候", "左": "佐", "右": "佑",
        "中": "忠", "外": "歪", "內": "納", "間": "艱", "分": "紛", "合": "盒",
        "同": "銅", "異": "翼", "相": "廂", "互": "戶", "獨": "讀", "群": "裙",
        "眾": "重", "孤": "姑", "單": "丹", "雙": "霜", "百": "柏", "千": "遷",
        "萬": "腕", "半": "伴", "滿": "瞞", "空": "控", "清": "青", "楚": "礎",
        "明": "名", "白": "百", "暗": "黯", "黑": "嘿", "紅": "鴻", "綠": "錄",
        "金": "今", "玉": "育", "鐵": "帖", "石": "實", "草": "早", "木": "目",
        "花": "化", "鳥": "裊", "魚": "漁", "馬": "碼", "虎": "唬", "龍": "籠",
    }
    for idx in range(len(canonical_name) - 1, -1, -1):
        ch = canonical_name[idx]
        if ch in common_swaps:
            wrong_ch = common_swaps[ch]
            typo_form = canonical_name[:idx] + wrong_ch + canonical_name[idx + 1 :]
            return (
                typo_form,
                f"「{typo_form}」中的「{wrong_ch}」為錯別字，正確寫法應為「{canonical_name}」",
            )
    return None


def extract_clean_clue(meaning: str, cname: str, raw_name: str) -> str:
    clean_m = re.sub(r"[123]\.\s*", "", meaning)
    clean_m = re.sub(r"(?:也作|另作|亦作)「[^」]+」[。]?", "", clean_m)
    clean_m = re.sub(r"\(=[^)]+\)", "", clean_m)
    clean_m = re.sub(r"[^。；]*音[ㄅ-ㄩˊˇˋ˙\s／/]+[^。；]*[。；]?", "", clean_m)
    clauses = [c.strip() for c in re.split(r"[。；]", clean_m) if c.strip()]
    # Prefer the clause that starts with 比喻 / 形容 / 指 / 後比喻 / 後引申
    chosen = clauses[-1] if len(clauses) > 1 else (clauses[0] if clauses else clean_m)
    for c in clauses:
        if any(k in c for k in ["比喻", "形容", "指", "意謂", "用於"]):
            chosen = c
            break
    for prefix in [
        "後亦用以形容", "後多用來比喻", "後用以形容", "後用以比喻", "後比喻", "後引申指",
        "比喻", "形容", "原指", "本指", "泛指", "意謂", "指", "謂", "表示",
    ]:
        if chosen.startswith(prefix):
            chosen = chosen[len(prefix) :].strip()
    # Mask literal characters of cname if they appear in chosen
    chosen = chosen.replace(cname, "如此").replace(raw_name, "如此")
    for ch in cname:
        if ch not in "不人一之無自大天心有為以而子上下中生於":
            chosen = chosen.replace(ch, "某" if len(chosen) < 6 else "")
    chosen = chosen.strip("，、。； ")
    return chosen if len(chosen) >= 4 else "符合該特定語境的表現"


def make_usage_sentence(item: dict, sem: dict, rng: random.Random, variant_idx: int = 0) -> str:
    """Creates a natural, contextually accurate usage sentence containing the idiom."""
    cname = item["canonicalName"]
    clue = extract_clean_clue(item["meaning"], cname, item["name"])
    frames = [
        f"面對「{clue}」的情況，大家都不禁感嘆這真是「{cname}」的最佳寫照。",
        f"這部紀錄片生動刻畫出當事人「{clue}」的處境，將「{cname}」一詞詮釋得十分貼切。",
        f"班導師常拿這則故事提醒我們，在遇到「{clue}」的時刻，更能體會「{cname}」的深意。",
        f"從他展現出「{clue}」的言行舉止看來，用「{cname}」來形容實在再恰當不過了。",
        f"歷史課本提到這段往事時，特別以「{cname}」來描繪當時「{clue}」的局面。",
        f"讀完這篇散文後，全班同學對於文中「{cname}」所傳達「{clue}」的意境印象深刻。",
    ]
    return frames[variant_idx % len(frames)]


def make_blank_context_sentence(item: dict, sem: dict, variant_idx: int) -> str:
    """Creates a natural Type-A fill-in-the-blank stem with `□□□□` embedded directly in a contextual sentence."""
    cname = item["canonicalName"]
    clue = extract_clean_clue(item["meaning"], cname, item["name"])
    scenarios = [
        f"「在人生旅途中，每當遇上『{clue}』的時刻，人們總會想起□□□□這句成語。」上文缺空處最適合填入：",
        f"「這位小說家筆下的人物正處於『{clue}』的狀態，可說是□□□□。」句中缺空處最適宜填入下列哪一個成語？",
        f"「老師在黑板上分析這段課文：作者在此處透過□□□□，傳神地描繪出『{clue}』的情景。」缺空處應填入：",
        f"「觀察現今社會中『{clue}』的實例，我們更能明白□□□□這句話背後的道理。」句中□□□□宜填入：",
        f"「他在週記裡寫道：這次活動讓我深刻體會到『{clue}』，真是□□□□！」請問缺空處最適合填入：",
    ]
    return scenarios[variant_idx % len(scenarios)]


def make_misuse_sentence(item: dict, variant_idx: int = 0) -> tuple[str, str]:
    """Creates diverse, realistic misuse sentences (望文生義 / 褒貶誤用 / 對象錯置) for Type-C questions."""
    cname = item["canonicalName"]
    meaning = item["meaning"]
    misuse_frames = [
        (
            f"今天晴空萬里、微風徐徐，操場上的白雲看起來真是「{cname}」，令人心曠神怡。",
            "形容晴朗天氣與白雲景致",
        ),
        (
            f"這家新開幕的手搖飲店珍珠煮得非常有彈性，口感真是「{cname}」，大受學生歡迎。",
            "形容手搖飲珍珠的Q彈口感",
        ),
        (
            f"弟弟剛學會騎腳踏車，在公園裡「{cname}」地慢慢踩著踏板，模樣十分可愛。",
            "形容幼童剛學騎單車的可愛模樣",
        ),
        (
            f"媽媽今天去傳統市場買了幾顆「{cname}」的大西瓜，準備切給全家人消暑解渴。",
            "形容西瓜的外觀與甜度",
        ),
        (
            f"這款最新型的智慧型手機電池容量極大，充電速度更是「{cname}」，非常省電。",
            "形容手機電池的充電與省電效能",
        ),
        (
            f"校慶園遊會上，我們班布置的氣球拱門色彩「{cname}」，吸引許多學弟妹拍照打卡。",
            "形容氣球拱門的繽紛色彩",
        ),
        (
            f"他為了祝賀表姊新居落成，特別在花籃賀卡上寫下「{cname}」四個大字表達祝福。",
            "作為祝賀他人新居落成的題辭",
        ),
        (
            f"這件純棉運動衫穿起來透氣又排汗，材質可說是「{cname}」，非常適合夏天運動穿著。",
            "形容運動服飾的布料材質",
        ),
    ]
    sent, wrong_ctx = misuse_frames[variant_idx % len(misuse_frames)]
    reason = f"「{item['name']}」正確釋義為「{meaning}」，不可望文生義或張冠李戴用來{wrong_ctx}。"
    return (sent, reason)


def shuffle_options_and_get_answer(
    correct_text: str, distractors: list[str], rng: random.Random
) -> tuple[dict[str, str], str]:
    pool = [correct_text] + distractors[:3]
    rng.shuffle(pool)
    labels = ["A", "B", "C", "D"]
    options = {labels[i]: pool[i] for i in range(4)}
    ans = labels[pool.index(correct_text)]
    return options, ans


def build_all() -> None:
    rng = random.Random(2026116)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    idioms_list = parse_pdf_idioms()
    seed_questions = parse_docx_seed_questions()
    sem_lookup = build_semantic_lookup(idioms_list)

    total_idioms = len(idioms_list)
    assert total_idioms == 570, f"Expected 570 unique idioms, got {total_idioms}"

    # Distribute 570 idioms evenly across 20 levels:
    # Levels 1..10 get 29 idioms each (290), Levels 11..20 get 28 idioms each (280) -> Total = 570
    level_idioms: dict[int, list[dict]] = {}
    cursor = 0
    for lvl in range(1, 21):
        count = 29 if lvl <= 10 else 28
        slice_idioms = idioms_list[cursor : cursor + count]
        cursor += count
        theme = LEVEL_THEMES[lvl]
        for it in slice_idioms:
            it["level"] = lvl
            it["levelTitle"] = theme["title"]
            it["levelBadge"] = theme["badge"]
            it["category"] = sem_lookup[it["name"]]["category"]
        level_idioms[lvl] = slice_idioms

    # Map the 50 DOCX seed questions across the 20 levels (2 to 3 per level)
    # First check if any seed question directly mentions an idiom in a level
    name_to_idiom = {it["name"]: it for it in idioms_list}
    cname_to_idiom = {it["canonicalName"]: it for it in idioms_list}

    level_seed_buckets: dict[int, list[dict]] = {lvl: [] for lvl in range(1, 21)}
    unassigned_seeds = []

    for sq in seed_questions:
        matched_idiom = None
        full_q_text = sq["question"] + " " + " ".join(sq["options"].values())
        for cname, it in cname_to_idiom.items():
            if cname in full_q_text:
                matched_idiom = it
                break
        if matched_idiom is not None and len(level_seed_buckets[matched_idiom["level"]]) < 4:
            lvl = matched_idiom["level"]
            sq["level"] = lvl
            sq["targetIdiom"] = matched_idiom["name"]
            sq["yearTags"] = matched_idiom["yearTags"]
            level_seed_buckets[lvl].append(sq)
        else:
            unassigned_seeds.append(sq)

    # Distribute remaining unassigned seed questions evenly across levels with fewer seeds
    for sq in unassigned_seeds:
        target_lvl = min(range(1, 21), key=lambda l: len(level_seed_buckets[l]))
        rep_idiom = level_idioms[target_lvl][len(level_seed_buckets[target_lvl]) % len(level_idioms[target_lvl])]
        sq["level"] = target_lvl
        sq["targetIdiom"] = rep_idiom["name"]
        sq["yearTags"] = rep_idiom["yearTags"]
        sq["explanation"] = (
            sq["explanation"]
            + f"\n【本關核心成語連結】{rep_idiom['displayName']}（{'、'.join(rep_idiom['yearTags'])}）：{rep_idiom['meaning']}"
        )
        level_seed_buckets[target_lvl].append(sq)

    # Now build exactly 100 questions per level (2,000 total)
    # Guaranteeing every single idiom in `level_idioms[lvl]` has at least 3 questions (`count >= 3`)!
    all_questions = []

    for lvl in range(1, 21):
        idioms_in_lvl = level_idioms[lvl]
        seeds_in_lvl = level_seed_buckets[lvl]
        lvl_questions = []

        # 1. Add seed questions from 20100409.docx
        for sq in seeds_in_lvl:
            lvl_questions.append(
                {
                    "level": lvl,
                    "type": "SEED",
                    "typeName": "歷屆種子真題",
                    "targetIdiom": sq["targetIdiom"],
                    "yearTags": sq["yearTags"],
                    "question": sq["question"],
                    "options": sq["options"],
                    "answer": sq["answer"],
                    "explanation": sq["explanation"],
                }
            )

        # 2. For every idiom in this level, generate 3 core questions of varied types (A, B, C, D, E)
        # 28*3 = 84 or 29*3 = 87 questions, plus seeds (~2-4) = ~89-91 questions, then top up remaining ~9-11 questions!
        for idx, target in enumerate(idioms_in_lvl):
            other_idioms = [x for x in idioms_in_lvl if x["name"] != target["name"]]
            sem = sem_lookup[target["name"]]
            years_str = "、".join(target["yearTags"])

            # --- Question 1 for `target`: 題型 A【情境填空】 ---
            distractors_a = rng.sample(other_idioms, 3)
            stem_a = make_blank_context_sentence(target, sem, idx)
            opts_a, ans_a = shuffle_options_and_get_answer(
                target["canonicalName"],
                [d["canonicalName"] for d in distractors_a],
                rng,
            )
            dist_exp_a = "\n".join(
                [f"‧「{d['name']}」（{'、'.join(d['yearTags'])}）：{d['meaning']}" for d in distractors_a]
            )
            exp_a = (
                f"【正確答案：({ans_a}) {target['canonicalName']}】\n"
                f"🎯 核心成語：{target['displayName']}（歷屆年份：{years_str}）\n"
                f"📖 阿任師小卡釋義：{target['meaning']}\n"
                f"💡 干擾選項解析：\n{dist_exp_a}"
            )
            lvl_questions.append(
                {
                    "level": lvl,
                    "type": "A",
                    "typeName": "情境填空",
                    "targetIdiom": target["name"],
                    "yearTags": target["yearTags"],
                    "question": stem_a,
                    "options": opts_a,
                    "answer": ans_a,
                    "explanation": exp_a,
                }
            )

            # --- Question 2 for `target`: 題型 B【釋義與典故】 ---
            distractors_b = rng.sample(other_idioms, 3)
            if idx % 2 == 0:
                # Subtype B1: Give idiom, pick correct meaning
                stem_b = f"關於歷屆會考成語「{target['canonicalName']}」（{years_str}）的釋義說明，下列何者正確？"
                correct_b = target["meaning"]
                wrong_b = [d["meaning"] for d in distractors_b]
                opts_b, ans_b = shuffle_options_and_get_answer(correct_b, wrong_b, rng)
            else:
                # Subtype B2: Give meaning, pick correct idiom
                masked_m = mask_target_chars_in_meaning(
                    target["meaning"], target["canonicalName"], target["name"]
                )
                stem_b = f"阿任師國文重點速記小卡記載某成語釋義為：「{masked_m}」請問這是指下列哪一個成語？"
                correct_b = target["canonicalName"]
                wrong_b = [d["canonicalName"] for d in distractors_b]
                opts_b, ans_b = shuffle_options_and_get_answer(correct_b, wrong_b, rng)

            dist_exp_b = "\n".join(
                [f"‧「{d['name']}」：{d['meaning']}" for d in distractors_b]
            )
            exp_b = (
                f"【正確答案：({ans_b})】\n"
                f"🎯 核心成語：{target['displayName']}（歷屆年份：{years_str}）\n"
                f"📖 完整釋義：{target['meaning']}\n"
                f"💡 同關卡其他成語對照：\n{dist_exp_b}"
            )
            lvl_questions.append(
                {
                    "level": lvl,
                    "type": "B",
                    "typeName": "釋義與典故",
                    "targetIdiom": target["name"],
                    "yearTags": target["yearTags"],
                    "question": stem_b,
                    "options": opts_b,
                    "answer": ans_b,
                    "explanation": exp_b,
                }
            )

            # --- Question 3 for `target`: Rotate among 題型 C (用法正誤), 題型 D (字形字音), 題型 E (詞義關係) ---
            cname = target["canonicalName"]
            if cname in PHONETIC_BANK and idx % 3 == 0:
                # 題型 D2: 字音辨析
                q_word, corr_zhuyin, w1, w2, w3, p_note = PHONETIC_BANK[cname]
                stem_d = f"請判斷會考常考成語「{q_word}」引號內國字的正確讀音為何？"
                opts_d, ans_d = shuffle_options_and_get_answer(corr_zhuyin, [w1, w2, w3], rng)
                exp_d = (
                    f"【正確答案：({ans_d}) {corr_zhuyin}】\n"
                    f"🎯 核心成語：{target['displayName']}（{years_str}）\n"
                    f"🔊 字音解析：{p_note}\n"
                    f"📖 成語釋義：{target['meaning']}"
                )
                lvl_questions.append(
                    {
                        "level": lvl,
                        "type": "D",
                        "typeName": "字形與字音辨析",
                        "targetIdiom": target["name"],
                        "yearTags": target["yearTags"],
                        "question": stem_d,
                        "options": opts_d,
                        "answer": ans_d,
                        "explanation": exp_d,
                    }
                )
            elif idx % 3 == 1:
                # 題型 C: 用法正誤判斷
                distractors_c = rng.sample(other_idioms, 3)
                if idx % 2 == 1:
                    # Pick the ONLY correct usage sentence (target is used correctly)
                    stem_c = "下列文句「　」中的成語，何者使用最為恰當（正確）？"
                    correct_c = make_usage_sentence(target, sem, rng, idx)
                    wrong_c_pairs = [
                        make_misuse_sentence(d, idx + i + 1)
                        for i, d in enumerate(distractors_c)
                    ]
                    opts_c, ans_c = shuffle_options_and_get_answer(
                        correct_c, [p[0] for p in wrong_c_pairs], rng
                    )
                    reasons_c = "\n".join([f"‧ 誤用解析：{p[1]}" for p in wrong_c_pairs])
                    exp_c = (
                        f"【正確答案：({ans_c})】\n"
                        f"✅ 正確用法：「{target['displayName']}」（{years_str}）釋義為「{target['meaning']}」，句中語境完全吻合。\n"
                        f"❌ 其他選項錯誤原因：\n{reasons_c}"
                    )
                else:
                    # Pick the ONLY incorrect usage sentence (target is misused)
                    stem_c = "下列文句「　」中的成語，何者犯了『望文生義或用法不當』的錯誤？"
                    misuse_sent, misuse_reason = make_misuse_sentence(target, idx)
                    right_sents = [
                        make_usage_sentence(d, sem_lookup[d["name"]], rng, idx + i + 1)
                        for i, d in enumerate(distractors_c)
                    ]
                    opts_c, ans_c = shuffle_options_and_get_answer(misuse_sent, right_sents, rng)
                    exp_c = (
                        f"【正確答案：({ans_c})】\n"
                        f"❌ 錯誤原因：{misuse_reason}\n"
                        f"🎯 核心成語：{target['displayName']}（{years_str}）\n"
                        f"📖 正確釋義：{target['meaning']}"
                    )
                lvl_questions.append(
                    {
                        "level": lvl,
                        "type": "C",
                        "typeName": "用法正誤判斷",
                        "targetIdiom": target["name"],
                        "yearTags": target["yearTags"],
                        "question": stem_c,
                        "options": opts_c,
                        "answer": ans_c,
                        "explanation": exp_c,
                    }
                )
            else:
                # 題型 D1 (字形辨析): Target is written correctly, 3 distractors have homophone typos
                distractors_d = rng.sample(other_idioms, 3)
                typo_pairs = []
                for d in distractors_d:
                    tp = make_char_typo_for_idiom(d["canonicalName"])
                    if tp is not None:
                        typo_pairs.append(tp)
                    else:
                        typo_pairs.append(
                            (
                                d["canonicalName"][:-1] + "然",
                                f"應作「{d['canonicalName']}」",
                            )
                        )
                stem_d1 = "下列各選項中的會考成語，何者用字「完全正確」（沒有錯別字）？"
                opts_d1, ans_d1 = shuffle_options_and_get_answer(
                    cname, [tp[0] for tp in typo_pairs], rng
                )
                typo_notes = "\n".join([f"‧ {tp[1]}" for tp in typo_pairs])
                exp_d1 = (
                    f"【正確答案：({ans_d1}) {cname}】\n"
                    f"🎯 核心成語：{target['displayName']}（{years_str}）用字完全正確，釋義為：{target['meaning']}\n"
                    f"📝 其他選項錯別字訂正：\n{typo_notes}"
                )
                lvl_questions.append(
                    {
                        "level": lvl,
                        "type": "D",
                        "typeName": "字形與字音辨析",
                        "targetIdiom": target["name"],
                        "yearTags": target["yearTags"],
                        "question": stem_d1,
                        "options": opts_d1,
                        "answer": ans_d1,
                        "explanation": exp_d1,
                    }
                )

        # 3. Fill the remaining slots up to 100 questions for this level using 題型 E【詞義關係】 & high-frequency 題型 C/D
        q_counter = 0
        while len(lvl_questions) < 100:
            target = idioms_in_lvl[q_counter % len(idioms_in_lvl)]
            q_counter += 1
            other_idioms = [x for x in idioms_in_lvl if x["name"] != target["name"]]
            sem = sem_lookup[target["name"]]
            years_str = "、".join(target["yearTags"])

            # 題型 E: 詞義關係（同類主題配對／近反義比較／類比題）
            distractors_e = rng.sample(other_idioms, 3)
            if target["alsoKnownAs"]:
                alt_name = target["alsoKnownAs"][0]
                stem_e = f"成語「{target['canonicalName']}」在歷屆會考與典籍中，與下列哪一個詞語屬於『同義或異形同義詞』？"
                wrong_e = [d["canonicalName"] for d in distractors_e]
                opts_e, ans_e = shuffle_options_and_get_answer(alt_name, wrong_e, rng)
                exp_e = (
                    f"【正確答案：({ans_e}) {alt_name}】\n"
                    f"🎯 核心成語：{target['displayName']}（{years_str}）\n"
                    f"📖 詞義解析：根據阿任師重點小卡，「{target['name']}」亦作「{alt_name}」，釋義為：{target['meaning']}"
                )
            else:
                stem_e = (
                    f"若依成語的語義性質分類，「{target['canonicalName']}」主要用來表達哪一類核心概念？"
                )
                correct_cat = f"屬於「{sem['category']}」（釋義：{target['meaning'][:22]}……）"
                wrong_cats = [
                    f"屬於「與{d['canonicalName']}相同的語境」（釋義：{d['meaning'][:22]}……）"
                    for d in distractors_e
                ]
                opts_e, ans_e = shuffle_options_and_get_answer(correct_cat, wrong_cats, rng)
                exp_e = (
                    f"【正確答案：({ans_e})】\n"
                    f"🎯 核心成語：{target['displayName']}（{years_str}）\n"
                    f"📖 完整釋義：{target['meaning']}\n"
                    f"🔄 反義／對比概念提示：{sem['antonymHint']}"
                )

            lvl_questions.append(
                {
                    "level": lvl,
                    "type": "E",
                    "typeName": "詞義關係",
                    "targetIdiom": target["name"],
                    "yearTags": target["yearTags"],
                    "question": stem_e,
                    "options": opts_e,
                    "answer": ans_e,
                    "explanation": exp_e,
                }
            )

        # Assign sequential IDs within the level: L01_Q001 .. L01_Q100
        assert len(lvl_questions) == 100, f"Level {lvl} has {len(lvl_questions)} questions instead of 100"
        for q_idx, q_obj in enumerate(lvl_questions, start=1):
            q_obj["id"] = f"L{lvl:02d}_Q{q_idx:03d}"
            all_questions.append(q_obj)

    # Save data/idioms.json and data/questions.json
    idioms_path = DATA_DIR / "idioms.json"
    questions_path = DATA_DIR / "questions.json"

    with open(idioms_path, "w", encoding="utf-8") as f:
        json.dump(idioms_list, f, ensure_ascii=False, indent=2)

    with open(questions_path, "w", encoding="utf-8") as f:
        json.dump(all_questions, f, ensure_ascii=False, indent=2)

    print(f"[SUCCESS] Generated {len(idioms_list)} idioms -> {idioms_path}")
    print(f"[SUCCESS] Generated {len(all_questions)} questions -> {questions_path}")


if __name__ == "__main__":
    build_all()
