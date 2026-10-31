/* MCQ core copied from the MCQ Form Builder artifact (used only to check the API matches it). */
var MCQ = (function () {
  var DEV_DIGITS = '०१२३४५६७८९';
  var LABEL_SETS = [
    ['A', 'B', 'C', 'D', 'E', 'F'],
    ['a', 'b', 'c', 'd', 'e', 'f'],
    ['अ', 'ब', 'क', 'ड', 'इ'],
    ['अ', 'ब', 'स', 'द', 'इ']
  ];
  var LBL = '[A-Fa-f]|अ|ब|क|ड|स|द|इ';
  var OPT_START = new RegExp('^(\\*?)\\s*[\\(\\[]?\\s*(' + LBL + ')\\s*[\\)\\]](?:\\s+|$)(.*)$');
  var OPT_START_DOT = /^(\*?)\s*([A-Fa-f])\.\s+(.+)$/;
  var OPT_SPLIT = new RegExp('\\s+(\\*?)[\\(\\[]?(' + LBL + ')[\\)\\]]\\s+', 'g');
  var NUM_LINE = /^(?:(Q(?:uestion|ue)?|प्रश्ना|प्रश्न|प्र)\s*\.?\s*)?(\d{1,3})\s*[.):\-]\s*(.+)$/i;
  var NUM_LINE_Q = /^(Q(?:uestion|ue)?|प्रश्ना|प्रश्न|प्र)\s*\.?\s*(\d{1,3})\s*[.):\-]?\s+(.+)$/i;
  var SECTION = /^(section|part|विभाग|भाग)\s*[-:]?\s*([A-Z]|[IVX]{1,4}|\d{1,2})\b/i;
  var KEY_HEAD = /(answer\s*key|answer\s*sheet|answers\s*:?\s*$|उत्तरपत्रिका|उत्तर\s*पत्रिका|उत्तरसूची|उत्तर\s*सूची|उत्तरतालिका)/i;
  var SEPARATOR = /^[\s\-_=*~—–•·.]{3,}$/;
  var KEY_ITEM = new RegExp('(?:^|[^\\d])(\\d{1,3})\\s*[.):\\-]?\\s*(?:(?:उत्तर|answer|ans)\\s*[:.\\-]?\\s*)?[\\(\\[]?\\s*(' + LBL + ')\\s*(?=[\\)\\].,:;\\s|]|$)', 'gi');
  var CORRECT_MARK = /\s*(?:\(\s*correct\s*\)|\[\s*correct\s*\]|✓|✔|✅|\(\s*बरोबर\s*\))\s*/i;

  function toAscii(s) { return s.replace(/[०-९]/g, function (d) { return String(DEV_DIGITS.indexOf(d)); }); }
  function squash(s) { return s.replace(/[ \t ]+/g, ' ').trim(); }
  function normKey(s) { return s.replace(/\s+/g, '').toLowerCase(); }

  function splitLines(text) {
    return text.replace(/\r\n?/g, '\n').split('\n');
  }

  /* Read word/document.xml (a parsed XML Document) into lines; underlined runs are wrapped in « ». */
  function docxToLines(doc) {
    var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    var body = doc.getElementsByTagNameNS(W, 'body')[0] || doc;
    var paras = body.getElementsByTagNameNS(W, 'p');
    var out = [];
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i];
      var runs = p.getElementsByTagNameNS(W, 'r');
      var text = '', inU = false;
      for (var j = 0; j < runs.length; j++) {
        var r = runs[j];
        var u = false;
        var rPr = r.getElementsByTagNameNS(W, 'rPr')[0];
        if (rPr) {
          var ue = rPr.getElementsByTagNameNS(W, 'u')[0];
          if (ue) { var v = ue.getAttributeNS(W, 'val') || ue.getAttribute('w:val') || 'single'; u = v !== 'none'; }
        }
        var piece = '';
        for (var k = 0; k < r.childNodes.length; k++) {
          var c = r.childNodes[k];
          if (c.localName === 't') piece += c.textContent;
          else if (c.localName === 'tab') piece += '\t';
          else if (c.localName === 'br' || c.localName === 'cr') piece += '\n';
        }
        if (!piece) continue;
        if (u && piece.trim() && !inU) { text += '«'; inU = true; }
        if (!u && inU) { text += '»'; inU = false; }
        text += piece;
      }
      if (inU) text += '»';
      text = text.replace(/«(\s*)/g, '$1«').replace(/(\s*)»/g, '»$1');
      out.push.apply(out, text.split('\n'));
    }
    return out;
  }

  function parseOptionsLine(line) {
    var m = line.match(OPT_START) || line.match(OPT_START_DOT);
    if (!m) return null;
    var first = { label: m[2], text: m[3], star: !!m[1] };
    var rest = first.text;
    var opts = [first];
    var set = LABEL_SETS.filter(function (s) { return s.indexOf(first.label) >= 0; });
    var pieces = [], re = new RegExp(OPT_SPLIT.source, 'g'), mm, last = 0, found = [];
    while ((mm = re.exec(' ' + rest)) !== null) found.push({ idx: mm.index, len: mm[0].length, star: !!mm[1], label: mm[2] });
    var padded = ' ' + rest, prevLabel = first.label, accepted = [];
    for (var i = 0; i < found.length; i++) {
      var f = found[i];
      var ok = set.some(function (s) { return s.indexOf(f.label) === s.indexOf(prevLabel) + 1; });
      if (ok) { accepted.push(f); prevLabel = f.label; }
    }
    if (accepted.length) {
      first.text = padded.slice(1, accepted[0].idx);
      for (var a = 0; a < accepted.length; a++) {
        var start = accepted[a].idx + accepted[a].len;
        var end = a + 1 < accepted.length ? accepted[a + 1].idx : padded.length;
        opts.push({ label: accepted[a].label, text: padded.slice(start, end), star: accepted[a].star });
      }
    }
    opts.forEach(function (o) {
      o.text = squash(o.text);
      if (/\*\s*$/.test(o.text)) { o.star = true; o.text = o.text.replace(/\s*\*+\s*$/, ''); }
      if (CORRECT_MARK.test(o.text)) { o.star = true; o.text = squash(o.text.replace(CORRECT_MARK, ' ')); }
      o.text = o.text.replace(/^\|+\s*/, '').replace(/[«»]/g, '');
    });
    return opts;
  }

  function classify(raw) {
    var line = squash(raw);
    if (!line) return { t: 'blank' };
    if (SEPARATOR.test(line)) return { t: 'blank' };
    var a = toAscii(line);
    if (SECTION.test(a.replace(/[«»]/g, ''))) return { t: 'section', text: line.replace(/[«»]/g, '') };
    var opts = parseOptionsLine(line);
    if (opts) return { t: 'opts', opts: opts };
    var m = a.match(NUM_LINE_Q) || a.match(NUM_LINE);
    if (m) {
      var prefixLen = a.length - m[3].length;
      return { t: 'num', explicit: !!m[1], n: parseInt(m[2], 10), text: line.slice(prefixLen).trim(), raw: line };
    }
    return { t: 'text', text: line };
  }

  function cleanTitle(s) {
    return s.replace(/[«»*]/g, '').replace(/^[^\p{L}\p{N}('"]+/u, '').trim();
  }

  function parse(lines) {
    var keyAt = -1;
    for (var i = 0; i < lines.length; i++) {
      var s = squash(lines[i]);
      if (s && s.length < 80 && KEY_HEAD.test(s) && i > 2) { keyAt = i; break; }
    }
    var bodyLines = keyAt >= 0 ? lines.slice(0, keyAt) : lines;
    var keyText = keyAt >= 0 ? toAscii(lines.slice(keyAt + 1).join('\n')) : '';

    var cls = bodyLines.map(classify).filter(function (c) { return c.t !== 'blank'; });
    var header = [], items = [], cur = null, lastSection = null, sinceSection = false, seenAny = false;
    for (var c = 0; c < cls.length; c++) {
      var L = cls[c];
      if (L.t === 'section') {
        lastSection = { section: L.text, help: '' }; items.push(lastSection); cur = null; sinceSection = true; seenAny = true; continue;
      }
      if (L.t === 'num') {
        var j = c + 1;
        while (j < cls.length && cls[j].t === 'text') j++;
        var isQ = L.explicit || (j < cls.length && cls[j].t === 'opts');
        if (isQ) {
          cur = { n: L.n, q: L.text, opts: [] }; items.push(cur); sinceSection = false; seenAny = true;
        } else {
          lastSection = { section: L.raw.replace(/[«»]/g, ''), help: '' }; items.push(lastSection); cur = null; sinceSection = true; seenAny = true;
        }
        continue;
      }
      if (L.t === 'opts') {
        if (cur) cur.opts = cur.opts.concat(L.opts);
        continue;
      }
      if (L.t === 'text') {
        if (cur && !cur.opts.length) cur.q += ' ' + L.text;
        else if (lastSection && sinceSection) lastSection.help = squash((lastSection.help + ' ' + L.text.replace(/^\((.*)\)$/, '$1')).replace(/[«»]/g, ''));
        else if (!seenAny) header.push(L.text);
      }
    }

    var questions = items.filter(function (it) { return it.q !== undefined; });
    var nums = questions.map(function (q) { return q.n; });
    var uniqueNums = new Set(nums).size === nums.length;

    var key = {};
    if (keyText) {
      var re = new RegExp(KEY_ITEM.source, 'gi'), m;
      while ((m = re.exec(keyText)) !== null) {
        var n = parseInt(m[1], 10);
        if (!(n in key)) key[n] = m[2];
        re.lastIndex = m.index + m[0].length;
      }
    }
    var keyCount = Object.keys(key).length;

    questions.forEach(function (q, idx) {
      q.flags = [];
      var words = [];
      q.q = squash(q.q.replace(/«([^»]*)»/g, function (_, w) { var t = w.trim(); if (t) words.push(t); return '"' + t + '"'; })).replace(/""/g, '"');
      q.word = words.join(', ');
      var seen = {}, opts = [], removed = [], remap = {};
      q.opts.forEach(function (o, oi) {
        var k = normKey(o.text);
        if (k in seen) { removed.push(o); remap[oi] = seen[k]; return; }
        seen[k] = opts.length; remap[oi] = opts.length; opts.push(o);
      });
      var labels = q.opts.map(function (o) { return o.label; });
      q.options = opts.map(function (o) { return { label: o.label, text: o.text }; });

      var keyNum = uniqueNums ? q.n : idx + 1;
      var keyLabel = key[keyNum];
      var keyIdx = -1;
      if (keyLabel) {
        var li = labels.indexOf(keyLabel);
        if (li < 0) li = labels.map(function (l) { return l.toLowerCase(); }).indexOf(keyLabel.toLowerCase());
        if (li < 0) {
          LABEL_SETS.forEach(function (s) { if (li < 0 && s.indexOf(keyLabel) >= 0 && s.indexOf(keyLabel) < labels.length) li = s.indexOf(keyLabel); });
        }
        if (li >= 0) keyIdx = remap[li];
      }
      var starIdx = -1;
      q.opts.forEach(function (o, oi) { if (o.star && starIdx < 0) starIdx = remap[oi]; });

      if (keyIdx >= 0) {
        q.answer = keyIdx; q.source = 'key';
        if (starIdx >= 0 && starIdx !== keyIdx) q.flags.push({ t: 'conflict', alt: starIdx });
      } else if (starIdx >= 0) {
        q.answer = starIdx; q.source = 'mark';
        if (keyCount) q.flags.push({ t: 'nokey' });
      } else {
        q.answer = -1; q.source = 'none';
        q.flags.push({ t: 'noanswer' });
      }
      if (removed.length) q.flags.push({ t: 'dupe', texts: removed.map(function (o) { return o.label + ') ' + o.text; }) });
      if (q.options.length < 2) q.flags.push({ t: 'few' });
      var odd = new RegExp('[\\u3040-\\u30ff\\u3400-\\u9fff\\uac00-\\ud7af\\u0400-\\u04ff\\u0600-\\u06ff\\ufffd]');
      if (odd.test(q.q) || q.options.some(function (o) { return odd.test(o.text); })) q.flags.push({ t: 'odd' });
      delete q.opts;
    });

    var title = header.length ? cleanTitle(header[0]) : '';
    var description = header.slice(1).map(function (h) { return h.replace(/[«»*]/g, '').trim(); }).filter(Boolean).join('\n');
    var out = items.map(function (it) {
      if (it.q === undefined) return { section: it.section.replace(/\*/g, ''), help: it.help };
      return { n: it.n, q: it.q, word: it.word, options: it.options, answer: it.answer, source: it.source, flags: it.flags };
    });
    return { title: title, description: description, items: out, keyFound: keyAt >= 0, keyCount: keyCount };
  }

  function needsLook(q) {
    return q.flags.some(function (f) { return f.t !== 'reviewed'; }) && !q.reviewed;
  }

  function isMarathi(s) { return /[ऀ-ॿ]/.test(s); }

  function buildPayload(model, st) {
    var items = [];
    model.items.forEach(function (it) {
      if (it.section !== undefined) {
        if (st.headings) items.push({ section: it.section, help: it.help || '' });
        return;
      }
      var opts = it.options.map(function (o) { return st.keepLetters ? o.label + ') ' + o.text : o.text; });
      var q = { q: it.q, options: opts, answer: it.answer };
      if (it.word) q.word = it.word;
      items.push(q);
    });
    var mr = isMarathi(st.title + model.items.map(function (i) { return i.q || ''; }).join(''));
    return {
      title: st.title, description: st.description,
      points: Math.max(0, parseInt(st.points, 10) || 0),
      student: !!st.student, pages: !!st.pages, shuffle: !!st.shuffle, confirm: st.confirm,
      nameLabel: mr ? 'विद्यार्थ्याचे नाव (Student Name)' : 'Student Name',
      rollLabel: mr ? 'हजेरी क्रमांक (Roll No.)' : 'Roll No.',
      wordLabel: mr ? 'अधोरेखित शब्द (Underlined word): ' : 'Underlined word: ',
      items: items
    };
  }

  function buildScript(model, st) {
    var items = [];
    model.items.forEach(function (it) {
      if (it.section !== undefined) {
        if (st.headings) items.push({ section: it.section, help: it.help || '' });
        return;
      }
      var opts = it.options.map(function (o) { return st.keepLetters ? o.label + ') ' + o.text : o.text; });
      var q = { q: it.q, options: opts, answer: it.answer };
      if (it.word) q.word = it.word;
      items.push(q);
    });
    var j = function (v) { return JSON.stringify(v); };
    var mr = isMarathi(st.title + model.items.map(function (i) { return i.q || ''; }).join(''));
    var nameLabel = mr ? 'विद्यार्थ्याचे नाव (Student Name)' : 'Student Name';
    var rollLabel = mr ? 'हजेरी क्रमांक (Roll No.)' : 'Roll No.';
    var wordLabel = mr ? 'अधोरेखित शब्द (Underlined word): ' : 'Underlined word: ';
    var count = items.filter(function (i) { return i.q !== undefined; }).length;
    return [
      '/**',
      ' * ' + st.title.replace(/\*\//g, '* /') + ' - Google Form (Quiz) generator',
      ' * ' + count + ' questions. Made with MCQ Form Builder.',
      ' *',
      ' * How to use:',
      ' *   1. Go to https://script.google.com and click New project',
      ' *   2. Delete the default code, paste this whole file, Save',
      ' *   3. Select "createMcqQuiz" in the toolbar and click Run',
      ' *   4. Approve the permissions prompt (first run only)',
      ' *   5. Open the Execution log to get the edit link and the student link',
      ' * Run it once: every run creates a new copy of the form.',
      ' */',
      '',
      'var FORM_TITLE = ' + j(st.title) + ';',
      'var FORM_DESCRIPTION = ' + j(st.description) + ';',
      'var POINTS_PER_QUESTION = ' + (Math.max(0, parseInt(st.points, 10) || 0)) + ';',
      'var ASK_STUDENT_DETAILS = ' + !!st.student + ';   // Name and Roll No. fields at the top',
      'var SECTIONS_ON_SEPARATE_PAGES = ' + !!st.pages + ';',
      'var SHUFFLE_QUESTIONS = ' + !!st.shuffle + ';',
      'var CONFIRMATION_MESSAGE = ' + j(st.confirm) + ';',
      'var NAME_LABEL = ' + j(nameLabel) + ';',
      'var ROLL_LABEL = ' + j(rollLabel) + ';',
      'var WORD_LABEL = ' + j(wordLabel) + ';',
      '',
      '// Items are a section { section, help } or a question { q, options, answer, word? }.',
      '// "answer" is the index of the correct option, starting from 0 (-1 = not set).',
      'var ITEMS = ' + JSON.stringify(items, null, 2) + ';',
      '',
      'function createMcqQuiz() {',
      '  var form = FormApp.create(FORM_TITLE);',
      '  form.setTitle(FORM_TITLE)',
      '      .setDescription(FORM_DESCRIPTION)',
      '      .setIsQuiz(true)',
      '      .setShuffleQuestions(SHUFFLE_QUESTIONS)',
      '      .setProgressBar(true)',
      '      .setConfirmationMessage(CONFIRMATION_MESSAGE);',
      '',
      '  if (ASK_STUDENT_DETAILS) {',
      '    form.addTextItem().setTitle(NAME_LABEL).setRequired(true);',
      '    form.addTextItem().setTitle(ROLL_LABEL).setRequired(true);',
      '  }',
      '',
      '  var qNo = 0;',
      '  ITEMS.forEach(function (item) {',
      '    if (item.section !== undefined) {',
      '      var header = SECTIONS_ON_SEPARATE_PAGES && qNo > 0',
      '        ? form.addPageBreakItem()',
      '        : form.addSectionHeaderItem();',
      '      header.setTitle(item.section).setHelpText(item.help || \'\');',
      '      return;',
      '    }',
      '    qNo++;',
      '    var mc = form.addMultipleChoiceItem();',
      '    var choices = item.options.map(function (opt, i) {',
      '      return mc.createChoice(opt, i === item.answer);',
      '    });',
      '    mc.setTitle(qNo + \'. \' + item.q)',
      '      .setChoices(choices)',
      '      .setPoints(POINTS_PER_QUESTION)',
      '      .setRequired(true);',
      '    if (item.word) mc.setHelpText(WORD_LABEL + item.word);',
      '  });',
      '',
      '  Logger.log(\'Form created with \' + qNo + \' questions.\');',
      '  Logger.log(\'Edit link:    \' + form.getEditUrl());',
      '  Logger.log(\'Student link: \' + form.getPublishedUrl());',
      '}',
      ''
    ].join('\n');
  }

  return { buildPayload: buildPayload, parse: parse, splitLines: splitLines, docxToLines: docxToLines, buildScript: buildScript, needsLook: needsLook, isMarathi: isMarathi };
})();
if (typeof module !== 'undefined') module.exports = MCQ;
