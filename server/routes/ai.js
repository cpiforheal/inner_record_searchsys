import { Router } from 'express';

const router = Router();

function chatCompletionsUrl(baseUrl) {
  const clean = String(baseUrl || '').replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(clean)) return clean;
  if (/\/v1$/i.test(clean)) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
}

function stripJsonText(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) return raw.slice(first, last + 1);
  return raw;
}

function clampConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num > 1 && num <= 100) return Math.round(num) / 100;
  return Math.max(0, Math.min(1, num));
}

function normalizeRows(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : Array.isArray(payload) ? payload : [];
  return rows.map((row) => ({
    name: String(row.name || row.patient_name || row.patientName || '').trim(),
    inpatient_no: String(row.inpatient_no || row.inpNo || row.inpatientNo || row.medical_record_no || '').trim(),
    discharge_date: String(row.discharge_date || row.date || '').trim(),
    position_code: String(row.position_code || row.positionCode || row.location_code || row.locationCode || '').trim(),
    confidence: clampConfidence(row.confidence),
    notes: String(row.notes || row.note || '').trim(),
  })).filter(row => row.name || row.inpatient_no || row.position_code);
}

async function callChatCompletions(url, apiKey, body, withResponseFormat) {
  const payload = withResponseFormat
    ? { ...body, response_format: { type: 'json_object' } }
    : body;

  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

router.post('/handwriting', async (req, res, next) => {
  try {
    const apiKey = process.env.AI_API_KEY;
    const baseUrl = process.env.AI_BASE_URL || 'https://code.mrzengchn.com';
    const model = process.env.AI_MODEL || 'gpt-4o-mini';
    const imageDataUrl = String(req.body?.imageDataUrl || '');

    if (!apiKey) {
      return res.status(500).json({ message: '未配置 AI_API_KEY，无法调用手写识别' });
    }
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(imageDataUrl)) {
      return res.status(400).json({ message: '请上传 png、jpg、jpeg 或 webp 图片' });
    }

    const url = chatCompletionsUrl(baseUrl);
    const body = {
      model,
      temperature: 0.1,
      max_tokens: 2200,
      messages: [
        {
          role: 'system',
          content: [
            '你是病案室手写清单识别助手。',
            '请从图片中识别病历清单，重点提取患者姓名、住院号/病案号、位置编号。',
            '位置编号常见为4到5位数字，例如11101代表1号架1排1摞01本；也可能只写到摞位。',
            '如果图片是多列手写名单，请按从左到右、每列从上到下的顺序输出。',
            '不确定的字不要猜满，降低confidence并在notes说明。',
            '只输出JSON，不要解释。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                '请识别这张手写病案清单，输出严格JSON：',
                '{"rows":[{"name":"患者姓名","inpatient_no":"住院号或病案号，没有则空字符串","position_code":"位置编号，没有则空字符串","confidence":0.0,"notes":"疑点或空字符串"}]}',
                '如果只有位置编号和姓名，也要输出对应行。',
              ].join('\n'),
            },
            {
              type: 'image_url',
              image_url: { url: imageDataUrl },
            },
          ],
        },
      ],
    };

    let upstream = await callChatCompletions(url, apiKey, body, true);
    let errorText = '';
    if (!upstream.ok) {
      errorText = await upstream.text();
      if (upstream.status === 400 && /response_format/i.test(errorText)) {
        upstream = await callChatCompletions(url, apiKey, body, false);
        errorText = '';
      }
    }

    if (!upstream.ok) {
      const text = errorText || await upstream.text();
      return res.status(502).json({
        message: `AI识别服务调用失败：${upstream.status}`,
        detail: text.slice(0, 600),
      });
    }

    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({ message: 'AI识别服务未返回可解析内容' });
    }

    let parsed;
    try {
      parsed = JSON.parse(stripJsonText(content));
    } catch (err) {
      return res.status(502).json({
        message: 'AI识别结果不是有效JSON，请重试或换一张更清晰的图片',
        detail: String(content).slice(0, 600),
      });
    }

    const rows = normalizeRows(parsed);
    res.json({
      rows,
      count: rows.length,
      model,
      usage: data.usage || null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
