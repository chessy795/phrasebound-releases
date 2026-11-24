# Phrasebound: complete feature brief (v1.1.0, 24 Nov 2026)

**What it is for:** learning a language from real videos and web pages through **formulaic expressions**: idioms, set phrases, sentence frames and social formulas. It applies the IdiomsTube idea (show learners the formulaic language in authentic video) to any video as it plays, in 12 languages, with free AI that runs on the learner's own computer.

**Languages (12):** English, Mandarin, Cantonese, Japanese, Korean, Spanish, French, German, Italian, Portuguese, Russian, Tagalog.

**Status key:** ✅ tested on real videos or pages · 🔧 built and passing automated tests, not yet clicked through live.

## 1. The core: formulaic expressions
| Feature | What it does | Status |
|---|---|---|
| Expression database | About 140,000 expressions across 12 languages, from Wiktionary, CC-CEDICT and other open sources, plus expressions mined from real speech (subtitles, TED) | ✅ |
| Ranked by real use | Each expression has a rate per million words in YouTube talk, films and TED, so common ones come first | ✅ |
| Live highlighting | Expressions are marked in the subtitle line as it plays, including inflected forms ("spilled the beans", "kicks the bucket") | ✅ English, Chinese; 🔧 others less tested |
| Meaning on click | Meaning, literal reading and frequency for each expression | ✅ |
| "Easy to misread" label | Flags deceptive expressions whose words look transparent but are not | ✅ |
| Literal-use guard | Lowers false alarms where a phrase is used literally ("kick the bucket" about a real bucket), using the MAGPIE corpus | ✅ English |
| Idioms tab | Lists every expression in the video, with a gap-fill quiz on those you have heard | 🔧 |

## 2. Watching video
| Feature | What it does | Status |
|---|---|---|
| Two or three subtitle lines | Original plus translation, optional third language | ✅ YouTube |
| Sites | YouTube, Bilibili, Netflix, Prime Video, Disney+, Apple TV+, TED, Coursera, Udemy, edX, Khan Academy, Twitch and other live sites | ✅ YouTube; 🔧 others |
| Reading aids | Furigana and pitch accent for Japanese, pinyin or zhuyin for Mandarin, jyutping for Cantonese, hanja for Korean, stress for Russian | ✅ |
| Line list | Full transcript beside the video; click a line to jump | ✅ |
| Listening keys | A/S/D previous/replay/next line, Q pause after each line, L loop, C copy | ✅ |
| Difficulty chip | Share of words you probably know at your level, and "learn these N words to reach 95%" | ✅ English |
| "One new thing" lines (★) | Marks lines with exactly one unknown word or expression, the ideal next step | 🔧 |
| Burned-in subtitle OCR | Pause and press Alt+O: reads subtitles drawn into the picture (common in Hong Kong and Chinese videos) | ✅ with companion |
| Own files | Drop .srt/.vtt/.ass on any player, or play local videos with subtitles | 🔧 |

## 3. Reading the web and books
| Feature | What it does | Status |
|---|---|---|
| Hover lookup | Hold Shift over any word or phrase on any page for a dictionary card; phrases beat single words | ✅ |
| Select to translate | Select text for a translation | ✅ |
| Whole-page bilingual | Alt+P whole page, Alt+A article only, original and translation side by side | 🔧 |
| Expression glosses on pages | Alt+I adds small meaning chips to expressions on foreign-language pages | 🔧 |
| Saved words follow you | Words you saved glow on other pages; one click marks them known | 🔧 |
| Book reader | EPUB, Markdown, text and subtitle files, with expression noticing and chapter translation; exports a bilingual EPUB | 🔧 |
| Image OCR | Right-click an image, or drag a box, to read and translate the text in it | 🔧 with companion |

## 4. Remembering
| Feature | What it does | Status |
|---|---|---|
| Save, Known, Learning | Marks on any word or expression | ✅ |
| Spaced review | FSRS scheduling (the algorithm Anki now uses) | 🔧 |
| Practice drills | Drills on the video's expressions | 🔧 |
| Concordance | Your saved lines grouped by expression | 🔧 |
| Export | 10 formats, including Anki decks with audio clips and screenshots, and AnkiConnect | 🔧 |

## 5. Free local AI (Windows companion)
| Feature | What it does | Status |
|---|---|---|
| Offline translation | PLaMo 3 Translate 2B on the learner's own GPU or CPU, about 0.2 s per line, nothing sent online | ✅ |
| Subtitle OCR | PP-OCRv5 for burned-in subtitles | ✅ |
| Auto start | The extension starts the companion when it needs it | ✅ |
| Self-update | Checks GitHub every 12 hours, downloads only changed files for both the companion and the extension, and the extension reloads itself. Models are never re-downloaded | ✅ tested from GitHub; extension self-reload not yet seen live |

## 6. Privacy
No account, no ads, no analytics. Saved items stay in the browser. Online lookups only happen when the learner asks, and the companion keeps everything on the computer.

## What is not finished
- Live click-through on Netflix, Prime Video, Disney+ and Bilibili.
- A clean-PC test of the companion, and a run on several Hong Kong videos.
- The Chrome Web Store listing (prepared, not submitted).

## Install (Windows)
1. Unzip `PhraseboundCompanion_Windows.zip` somewhere you will keep it.
2. In Chrome or Edge open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose the `extension` folder inside it.
3. Double-click **Set up (run once).bat** and restart the browser.

Updates arrive automatically: the companion checks this repo every 12 hours and downloads only changed files.

Dictionary and expression data come from openly licensed sources; see `extension/credits.html`. The translation model is PLaMo 3 Translate 2B by Preferred Networks (Built with PLaMo, PLaMo Community License), shipped in the Windows download, not in this repo.
