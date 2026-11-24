# Phrasebound: complete feature brief (v1.1.1, 24 Nov 2026)

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

## Install
1. Install the extension in Edge or Chrome.
2. Optional, Windows only: for offline translation and reading subtitles burned into the picture, click **Get free offline AI** in the extension's popup, or download [PhraseboundSetup.exe](https://github.com/chessy795/phrasebound-releases/releases/latest/download/PhraseboundSetup.exe) and run it. It downloads about 180 MB, connects itself to the browser, and fetches the translation model that suits the PC on first start. Windows may warn about an unknown publisher; choose More info, then Run anyway.

Updates arrive automatically: the companion checks this repo every 12 hours and downloads only changed files.

Dictionary and expression data come from openly licensed sources; see `extension/credits.html`. Translation models are downloaded from their publishers (for example PLaMo 3 Translate 2B by Preferred Networks: Built with PLaMo, PLaMo Community License).

## Privacy policy

Last updated: 24 November 2026

Phrasebound is a browser extension for language learning. It has no accounts, no advertising and no analytics, and the developer receives none of your data.

### What stays on your device
Your settings, saved words, saved subtitle lines and review progress are stored in your browser's own extension storage. They never leave your device unless you export them yourself.

### What is sent to other services, and only when you use the feature
- **Dictionary lookups:** the word or phrase you look up may be sent to Wiktionary (Wikimedia) or to an online learner dictionary to fetch a definition or a pronunciation recording.
- **Online translation:** if you choose an online translator in the settings, the subtitle line or text you translate is sent to that service (Google Translate, or Microsoft Translator with your own key).
- **Your own AI service:** if you enter the address of an AI service in the settings, the text you ask about is sent to that address.
- **The optional companion app** runs on your own computer at 127.0.0.1. Text, images and audio sent to it stay on your computer. It downloads its translation model once from Hugging Face and checks this GitHub repository for code updates every 12 hours; neither request includes anything about you.

These services handle the text under their own privacy policies. Phrasebound sends no information about you, only the text you asked about.

### Web pages and videos
The extension reads subtitles and page text in your browser so it can highlight expressions and show lookups. This happens locally. Phrasebound does not record your browsing history and does not send page content anywhere except for the lookups and translations described above.

### Children
Phrasebound is not directed at children under 13.

### Contact
Questions: open an issue at https://github.com/chessy795/phrasebound-releases/issues
