(() => {
  const week = 7 * 86400000;
  const lessons = [
    {lang:'ja', form:'勉強になる', meaning:'You can learn something useful from it.',
      choices:['It will teach you something useful.','You must study for an exam.','You have already mastered the subject.'],
      clips:[
        ['Xww2sDoRPWg',431,'勉強になる','お風呂に関係する言葉がたくさん出てきて','The speaker points to all the bath-related words the listener will encounter. That makes the podcast a chance to learn.'],
        ['Z_5mjr4l4B8',1668,'勉強になる','勉強になるコース','The speaker recommends a course for people curious about accent. The phrase describes what a learner can gain from it.']
      ]},
    {lang:'ko', form:'마음에 들다', meaning:'To like something or find it appealing.',
      choices:['It appeals to the speaker or listener.','It comes back to mind.','It makes someone change their mind.'],
      clips:[
        ['MnAk-innWcc',904,'마음에 들어요','KIA 마음에 들어요','The speaker is choosing a car and singles out KIA. The next line adds that even the name sounds good.'],
        ['O8HLnUelzAw',1384,'마음에 들지','어떤게 더','The speaker asks which of two sweet potato varieties you like better. 더 (“more”) signals a preference.']
      ]}
  ];
  lessons.push(...[
  {
    "lang": "zh",
    "form": "一模一樣",
    "meaning": "Exactly the same",
    "choices": [
      "Exactly the same",
      "Roughly similar",
      "Copied in reverse order",
      "Based on the same subject"
    ],
    "clips": [
      [
        "FhPhMErV1To",
        170,
        "一模一樣",
        "你能長出一模一樣品質的頭髮嗎",
        "The speaker compares the quality of two heads of hair."
      ],
      [
        "qsW4PnfQJ80",
        1584,
        "一模一樣",
        "體感就跟一般的信用卡是一模一樣的",
        "The speaker compares the feel of using this card with using an ordinary credit card."
      ],
      [
        "u3kFwgqkpCI",
        1643,
        "一模一樣",
        "全部跟簡報上面一模一樣",
        "The speaker compares what someone says aloud with the content on their slides."
      ]
    ]
  },
  {
    "lang": "zh",
    "form": "自然而然",
    "meaning": "Naturally, without forcing it",
    "choices": [
      "Naturally, without forcing it",
      "As a last resort",
      "Gradually, by following instructions",
      "On someone else’s advice"
    ],
    "clips": [
      [
        "qsW4PnfQJ80",
        1240,
        "自然而然",
        "那我就會自然而然的",
        "The thought about leverage comes as a natural consequence of the preceding idea."
      ],
      [
        "u3kFwgqkpCI",
        3265,
        "自然而然",
        "我自然而然就把寶寶",
        "Posting about the baby follows naturally from the baby being part of daily life."
      ],
      [
        "TDtJ7oQqZhk",
        2560,
        "自然而然",
        "感覺好像你就自然而然",
        "The speaker expects the preference for a longer life to develop naturally with age."
      ]
    ]
  },
  {
    "lang": "zh",
    "form": "無論如何",
    "meaning": "In any case",
    "choices": [
      "In any case",
      "Only if everything goes well",
      "For the first time",
      "In the same way as before"
    ],
    "clips": [
      [
        "CbNTy8pmIHI",
        1076,
        "無論如何",
        "不過無論如何",
        "The speaker sets the preceding point aside and continues with the dance comparison."
      ],
      [
        "CbNTy8pmIHI",
        2141,
        "無論如何",
        "所以無論如何",
        "The initial acknowledgement of distress applies across different ways of responding."
      ],
      [
        "u3kFwgqkpCI",
        2138,
        "無論如何",
        "無論如何",
        "Despite the surrounding qualifications, the speaker consistently judges their old performances differently today."
      ]
    ]
  }
]);
  lessons.push({
    lang:'zh', form:'權利 / 權力', meaning:'A right or entitlement.', choices:['A right or entitlement.','Power or authority.'],
    clips:[
      ['FhPhMErV1To',2385,'權利','選擇的權利','選擇 identifies what the person is entitled to do. The caption writes 利 in 權利 (quánlì).'],
      ['wOXgaj65oDs',1266,'權利','有權利坐這個位置','The speaker claims an entitlement to this seat. 權利 (quánlì) ends in 利.'],
      ['CbNTy8pmIHI',1493,'權力','握有權力的人','握有 describes someone holding authority. 權力 (quánlì) ends in 力 and sounds the same as 權利.',1]
    ]
  });
  const prefix = 'ss_transfer_v1:';
  const key = lesson => prefix + lesson.lang + ':' + lesson.form;
  function match(lang, source, word, position, videoKey, seconds) {
    for (const lesson of lessons.filter(row => row.lang === lang)) {
      for (const clip of lesson.clips) {
        if (videoKey !== "yt:"+clip[0] || (clip[1] != null && Math.abs(seconds-clip[1]) > 2)) continue;
        const start = source.indexOf(clip[2]);
        if (start < 0 || !source.includes(clip[3])) continue;
        if (position ? position[0] < start + clip[2].length && position[1] > start :
            Boolean(word && (clip[2].includes(word) || word.includes(clip[2])))) return {lesson, clip};
      }
    }
    return null;
  }
  async function schedule(lesson, clip) {
    const id = key(lesson);
    const prior = (await chrome.storage.local.get(id))[id];
    if (prior) return prior;
    const record = {due:Date.now() + week, source:clip[0], ...(lesson.kind ? {lesson} : {})};
    await chrome.storage.local.set({[id]:record});
    return record;
  }
  const ready = chrome.runtime.sendMessage({op:'getDiscoveredLessons'}).then(rows => {
    if (!Array.isArray(rows)) return;
    const seen = new Set(lessons.map(key));
    for (const row of rows) {
      if (!['yue','zh'].includes(row.lang) || !['spelling','sense'].includes(row.kind) ||
          !Array.isArray(row.choices) || row.choices.length !== 2 || !Array.isArray(row.clips) ||
          row.clips.length !== 2 || seen.has(key(row))) continue;
      lessons.push(row);
      seen.add(key(row));
    }
  }).catch(() => {});
  globalThis.SS_TRANSFER = {lessons, key, prefix, match, schedule, ready};
})();
