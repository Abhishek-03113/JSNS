/**
 * MCQ Form Builder - executor.
 *
 * Deployed once as an "API Executable" in the same Google Cloud project as the
 * web app's OAuth client. The web app calls these functions through the Apps
 * Script API (scripts.run) with the signed-in teacher's OAuth token, so every
 * form is created in that teacher's own Google Drive.
 *
 * Payload shape: { title, description, points, student, pages, shuffle, confirm,
 *   nameLabel, rollLabel, wordLabel, items: [ {section, help} | {q, options, answer, word?} ] }
 */

function createMcqQuiz(payload) {
  if (typeof payload === 'string') payload = JSON.parse(payload);
  if (!payload || !payload.title || !payload.items) throw new Error('Payload needs a title and items.');

  var form = FormApp.create(payload.title);
  form.setTitle(payload.title)
      .setDescription(payload.description || '')
      .setIsQuiz(true)
      .setShuffleQuestions(!!payload.shuffle)
      .setProgressBar(true);
  if (payload.confirm) form.setConfirmationMessage(payload.confirm);

  if (payload.student) {
    form.addTextItem().setTitle(payload.nameLabel || 'Student Name').setRequired(true);
    form.addTextItem().setTitle(payload.rollLabel || 'Roll No.').setRequired(true);
  }

  var points = Math.max(0, parseInt(payload.points, 10) || 0);
  var qNo = 0;
  payload.items.forEach(function (item) {
    if (item.section !== undefined) {
      var header = payload.pages && qNo > 0 ? form.addPageBreakItem() : form.addSectionHeaderItem();
      header.setTitle(item.section).setHelpText(item.help || '');
      return;
    }
    qNo++;
    var mc = form.addMultipleChoiceItem();
    var choices = item.options.map(function (opt, i) {
      return mc.createChoice(opt, i === item.answer);
    });
    mc.setTitle(qNo + '. ' + item.q)
      .setChoices(choices)
      .setPoints(points)
      .setRequired(true);
    if (item.word) mc.setHelpText((payload.wordLabel || 'Underlined word: ') + item.word);
  });

  var publishedUrl = form.getPublishedUrl();
  var shortUrl = '';
  try { shortUrl = form.shortenFormUrl(publishedUrl); } catch (e) { /* the long link still works */ }

  // Two links: editUrl for the teacher, publishedUrl (and its forms.gle shortUrl) for students.
  return {
    formId: form.getId(),
    title: form.getTitle(),
    editUrl: form.getEditUrl(),
    publishedUrl: publishedUrl,
    shortUrl: shortUrl,
    questionCount: qNo
  };
}

/** Response counts for the dashboard. Forms the user can no longer open come back with ok: false. */
function getFormStats(formIds) {
  if (typeof formIds === 'string') formIds = JSON.parse(formIds);
  return (formIds || []).map(function (id) {
    try {
      var form = FormApp.openById(id);
      return {
        formId: id,
        ok: true,
        title: form.getTitle(),
        responses: form.getResponses().length,
        accepting: form.isAcceptingResponses()
      };
    } catch (e) {
      return { formId: id, ok: false, error: String((e && e.message) || e) };
    }
  });
}

/** Health check used by GET /api/executor/ping. */
function ping() {
  return { ok: true, user: Session.getActiveUser().getEmail(), at: new Date().toISOString() };
}
