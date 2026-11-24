# Data Sources & Licences (`ext/data/`)

- `bands_en.json`, `ranks_en.json`: Derived from HermitDave `FrequencyWords` (`2018/en/en_50k.txt`, sourced from OpenSubtitles 2018). Licensed under CC BY-SA 4.0 / MIT (see https://github.com/hermitdave/FrequencyWords).
- `fe_en.json`: Extracted from English Wiktionary categories (`English_phrasal_verbs`, `English_idioms`, `English_proverbs`, `English_similes`) via `en.wiktionary.org/w/api.php`, formatted with IdiomsTube `*` (0–3 word) wildcard templates per Lin (2022), ReCALL 34(2). Licensed under CC BY-SA 4.0.
- To swap in Phoebe Lin's full 53,635-template IdiomsTube database later, replace `fe_en.json` keeping the `[pattern, display, type, priority, maxBand]` schema.
- `fe_zh.json`: en.wiktionary Chinese entries via Kaikki (CC BY-SA 4.0), CC-CEDICT (CC BY-SA 4.0), zh.wiktionary via Kaikki (CC BY-SA 4.0). Built by `_dev/build_idioms.py`.
- `fe_yue.json`: built by `_dev/build_yue.py` from
  - kfcd 粵語詞典 (Cantonese–Mandarin, CC BY 3.0),
  - en.wiktionary Cantonese senses via Kaikki (CC BY-SA 4.0),
  - CC-Canto (CC BY-SA 3.0),
  - HKCanCor, Hong Kong Cantonese Corpus (CC BY 4.0), for idiom tags and frequency,
  - 18 productive frames written for this project.
  Types, English meanings and literal glosses marked `en_by`/`lit_by: "model"` were written by DeepSeek V4.1 Flash and are not human-checked.
- `fe_ja.json`: JMdict (CC BY-SA 4.0), Electronic Dictionary Research and Development Group. Type labels (expression, collocation, grammar frame) are our own rules.
- `fe_ko.json`: en.wiktionary and ko.wiktionary via Kaikki (CC BY-SA 4.0).
- `fe_en_gloss.json`: meanings from Open English WordNet (CC BY 4.0), ECDICT (MIT) and zh.wiktionary (CC BY-SA 4.0).
- Not used: words.hk (licence does not allow this reuse), IdiomsTube's own list.

- `fe_zh.json` also uses THUOCL chengyu frequency (MIT, thunlp) and chinese-xinhua chengyu and xiehouyu headwords (MIT repository; its explanations are not shipped).
- `fe_yue.json` also uses rime-cantonese `fixed_expressions.csv` (CanCLID, CC BY 4.0).
- `fe_ja.json` also uses ja.wiktionary via Kaikki (CC BY-SA 4.0); Japanese definitions in `extra.def_ja`.
- `fe_fr`, `fe_de`, `fe_es`, `fe_it`, `fe_pt`, `fe_ru` also use the French, German, Spanish, Italian, Portuguese and Russian Wiktionary editions via Kaikki (CC BY-SA 4.0); those entries carry `extra.src = "wikt-<lang>"`.
- `fe_ko.json` also uses 한국어기초사전 and 우리말샘 (National Institute of Korean Language, CC BY-SA 2.0 KR), from the Hugging Face dumps hac541309/basic_korean_dict and hac541309/woori_spring_dict.

- `fe_zh.json`: English meanings for 746 chengyu are dictionary translations from PETCI (Tang 2022, github.com/kenantang/petci, Apache-2.0).
- `fe_ko.json`: 2,312 사자성어 (four-character Sino-Korean idioms) with hanja and Korean meanings come from github.com/LiF-Lee/idioms (MIT). `extra.eq.zh` links each one to the same chengyu in fe_zh.

- `gloss_<src>_<ui>.json` (121 files, about 126k entries): built by `_dev/build_nxn_gloss.py`. Equivalents come from English Wiktionary translation tables via Kaikki (CC BY-SA 4.0): a source expression is linked to an English headword sense when it is listed in that sense's translation table, or when its English meaning is that headword. The learner's own-language words from the same table are the gloss. Chinese and Japanese four-character idioms written with the same characters are linked from fe_zh/fe_ja. No model-written text.
