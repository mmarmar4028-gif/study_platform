// Генерация темы курса из материалов лекции с помощью Claude (официальный SDK Anthropic в браузере).
// Ключ API пользователь вводит сам в профиле; запрос уходит напрямую в Anthropic.
import Anthropic from 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';

const SYSTEM = `Ты — опытный методист и преподаватель. Ты превращаешь материалы одной лекции в учебный модуль для студента, который пропустил занятие и готовится к зачёту.

Требования к содержанию:
- Охвати ВЕСЬ материал лекции, ничего важного не пропускай. Объясняй простым языком, по шагам, с примерами.
- Каждую схему, таблицу, график или картинку со слайдов перерисуй блоком "scheme" (HTML-таблица/блоки) и подробно объясни, как её читать и что она значит.
- Каждую формулу оформи блоком "formula": разбери КАЖДЫЙ компонент, напиши, зачем формула нужна, и дай пример с числами.
- Определения — блоком callout kind "def"; то, что почти наверняка спросят на зачёте, — kind "exam"; ловушки и частые ошибки — kind "warn"; пояснения и примеры — kind "tip".
- В каждом разделе укажи "slides" — номера страниц/слайдов исходного файла, где этот материал (например "12–15"). Нумерация — как страницы в файле.
- Добавь 3–6 интерактивных заданий (widget) разных видов, где это уместно.
- Тест: 20–25 вопросов по всему материалу, 4 варианта ответа, ровно один правильный. У каждого вопроса: "ref" — индекс раздела (с 0) в массиве sections, где объясняется ответ; "hint"; "explain" — объяснение правильного ответа; "why" — почему неверны типичные неправильные варианты (ключ — индекс варианта).
- Не выдумывай фактов, которых нет в лекции. Если на слайде явная опечатка или ошибка в расчёте — отметь это в блоке "warn".
- Язык — язык лекции (обычно русский).

Формат ответа: ТОЛЬКО один JSON-объект, без пояснений и без markdown-обрамления. В HTML-строках разрешены только теги: b, strong, i, em, br, p, ul, ol, li, table, tr, th, td, div, span, small, sup, sub, code, mark. Классы для схем: "flow" (контейнер) с ".node" и ".op" внутри, "grid2" с ".mini", "table-wrap" вокруг table.

Схема JSON:
{
  "short": "короткое название для вкладки (2–4 слова)",
  "title": "полное название темы",
  "lecture": "например: Занятие 3",
  "subtitle": "1–2 предложения о теме",
  "summary": { "intro": "о чём тема и зачем она нужна (HTML)", "points": ["что изучим, пункт 1 (HTML)", "..."] },
  "sections": [
    { "title": "название шага", "slides": "3–7", "blocks": [
      { "type": "html", "html": "<p>объяснение…</p>" },
      { "type": "callout", "kind": "def|exam|warn|tip", "title": "необязательно", "html": "…" },
      { "type": "scheme", "title": "название схемы", "html": "<div class=\\"flow\\"><div class=\\"node\\">A</div><div class=\\"op\\">→</div><div class=\\"node\\">B</div></div>", "explain": "как читать схему" },
      { "type": "formula", "name": "название", "expr": "Прибыль = Выручка − Затраты", "parts": [["Выручка", "что это"], ["Затраты", "что это"]], "why": "зачем нужна", "example": "пример с числами" },
      { "type": "widget", "kind": "flashcards", "title": "…", "cards": [["термин", "определение"]] },
      { "type": "widget", "kind": "classify", "title": "…", "intro": "…", "buckets": ["A", "B"], "items": [{ "text": "…", "bucket": "A", "why": "…" }] },
      { "type": "widget", "kind": "order", "title": "…", "items": ["шаг 1", "шаг 2", "шаг 3"], "explain": "…" },
      { "type": "widget", "kind": "match", "title": "…", "pairs": [["левая часть", "правая часть", "пояснение"]] }
    ] }
  ],
  "cheatsheet": ["главная мысль 1 (HTML)", "..."],
  "quiz": [ { "q": "вопрос", "opts": ["…", "…", "…", "…"], "a": 0, "ref": 0, "hint": "…", "explain": "…", "why": { "1": "…", "2": "…" } } ]
}
Для "order" перечисляй items в ПРАВИЛЬНОМ порядке (сайт сам перемешает). Разделов обычно 6–10.`;

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function parseJson(text) {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Claude не вернул JSON');
  return JSON.parse(t.slice(a, b + 1));
}

export async function generateTopic({ apiKey, model, file, courseTitle, courseContext, topicNumber, previousTitles, onProgress }) {
  if (file.size > 30 * 1024 * 1024) throw new Error('файл больше 30 МБ — раздели лекцию на части');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  const doc = isPdf
    ? { type: 'document', title: file.name, source: { type: 'base64', media_type: 'application/pdf', data: toBase64(await file.arrayBuffer()) } }
    : { type: 'document', title: file.name, source: { type: 'text', media_type: 'text/plain', data: await file.text() } };
  const instruction = `Курс: «${courseTitle}». Это тема № ${topicNumber}.` +
    (previousTitles && previousTitles.length ? ` Уже готовые темы курса: ${previousTitles.map((t, i) => `${i + 1}) ${t}`).join('; ')}. Не повторяй их подробно, но можешь ссылаться.` : '') +
    (courseContext ? ` Что важно о зачёте: ${courseContext}.` : '') +
    ` Сделай учебный модуль по приложенной лекции «${file.name}» строго по схеме. Ответ — только JSON.`;

  const params = {
    model,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    system: SYSTEM,
    messages: [{ role: 'user', content: [doc, { type: 'text', text: instruction }] }]
  };

  const run = async (withFallback) => {
    const stream = withFallback
      ? client.beta.messages.stream(Object.assign({}, params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }))
      : client.messages.stream(params);
    let chars = 0;
    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'thinking') onProgress && onProgress(chars, 'thinking');
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') { chars += event.delta.text.length; if (chars % 2000 < event.delta.text.length) onProgress && onProgress(chars, 'text'); }
    }
    return stream.finalMessage();
  };

  let msg;
  try {
    msg = await run(true);
  } catch (e) {
    const status = e && e.status;
    if (status === 401) { const err = new Error('API-ключ не подошёл (401). Проверь ключ в профиле.'); err.fatal = true; throw err; }
    if (status === 400 && /fallback/i.test(String(e.message))) msg = await run(false);
    else if (status === 429) throw new Error('слишком много запросов (429). Подожди минуту и добавь эту лекцию заново в «Управлении курсом».');
    else if (status === 529 || status >= 500) throw new Error(`сервер Anthropic перегружен (${status}). Попробуй позже.`);
    else throw new Error((e && e.message) || 'ошибка запроса');
  }
  if (msg.stop_reason === 'refusal') throw new Error('Claude отказался обрабатывать этот файл.');
  if (msg.stop_reason === 'max_tokens') throw new Error('ответ получился слишком длинным и оборвался — раздели лекцию на две части.');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const topic = parseJson(text);
  if (!Array.isArray(topic.sections) || !topic.sections.length) throw new Error('в ответе нет разделов');
  if (!Array.isArray(topic.quiz)) topic.quiz = [];
  return topic;
}
