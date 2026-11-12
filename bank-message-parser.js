/* Local-only parser for common Alinma debit alert formats. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MasareefiBankParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeText(value) {
    return String(value || '')
      .replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
      .replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\u00a0/g, ' ');
  }

  function extractAmount(message) {
    const number = '([0-9][0-9,٬]*(?:[.٫][0-9]{1,2})?)';
    const currency = '(?:SAR|S\\.?R\\.?|SR|ر\\.?\\s*س\\.?|ريال(?:\\s*سعودي)?)';
    const patterns = [
      new RegExp(`(?:المبلغ\\s*(?!المتبقي)|مبلغ(?:\\s+العملية)?|بقيمة|بمبلغ|القيمة|amount)\\s*[:：]?\\s*(?:${currency}\\s*)?${number}(?:\\s*${currency})?`, 'i'),
      new RegExp(`${number}\\s*${currency}`, 'i'),
      new RegExp(`${currency}\\s*[:：-]?\\s*${number}`, 'i')
    ];
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (!match) continue;
      const amount = Number.parseFloat(match[1].replace(/[,٬]/g, '').replace(/[٫]/g, '.'));
      if (Number.isFinite(amount) && amount > 0) return amount;
    }
    return null;
  }

  function validDate(year, month, day) {
    const y = Number(year), m = Number(month), d = Number(day);
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function extractDate(message) {
    let match = message.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (match) return validDate(match[1], match[2], match[3]);
    match = message.match(/\b(\d{2})-(\d{1,2})-(\d{1,2})\b/);
    if (match) {
      const shortYear = Number(match[1]);
      return validDate(shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear, match[2], match[3]);
    }
    match = message.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
    if (match) return validDate(match[3], match[2], match[1]);
    return null;
  }

  function classify(message) {
    if (/سداد\s*(?:البطاقة|بطاقة)|سداد البطاقة الائتمانية/i.test(message)) return { key: 'card-payment', label: 'سداد بطاقة' };
    if (/حوالة|تحويل\s+(?:صادر|محلي|داخلي|خارجي)|حوالة\s+(?:صادرة|محلية|داخلية)/i.test(message)) return { key: 'transfer', label: 'حوالة صادرة' };
    if (/قسط|تمويل|مرابحة/i.test(message)) return { key: 'installment', label: 'قسط أو التزام تمويلي' };
    if (/فاتورة|سداد\s+فاتورة|السعودية\s+للطاقة|الاتصالات السعودية|stc\b|invoice/i.test(message)) return { key: 'bill', label: 'سداد فاتورة' };
    if (/شراء|\bPOS\b|مدى|\bMada\b|purchase|internet purchase/i.test(message)) return { key: 'purchase', label: 'شراء' };
    if (/سحب\s+نقدي|cash withdrawal/i.test(message)) return { key: 'cash', label: 'سحب نقدي' };
    return { key: 'other', label: 'خصم بنكي' };
  }

  function cleanMerchant(value) {
    return String(value || '')
      .replace(/\s+(?:SAR|S\.R\.?|SR|ريال(?:\s*سعودي)?|ر\.?\s*س\.?).*$/i, '')
      .replace(/\s+(?:في|بتاريخ|حساب|لحساب|at|on)\s+.*$/i, '')
      .replace(/\s+(?:رقم|المتبقي|حد الصرف|الحد المتبقي)\s+.*$/i, '')
      .replace(/^[\s:：،,؛-]+|[\s:：،,؛-]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .slice(0, 70);
  }

  function extractMerchant(message, type) {
    let match = message.match(/(?:^|\s)(?:من|لدى|عند|التاجر|from|merchant|at)\s*[:：]?\s*([^\r\n]+)/i);
    if (match) {
      const merchant = cleanMerchant(match[1]);
      if (merchant) return merchant;
    }
    match = message.match(/(?:^|\s)لـ?\s*(?!الفواتير|حساب)([^\r\n]+)/);
    if (match) {
      const merchant = cleanMerchant(match[1]);
      if (merchant && !/^(?:الفواتير|فواتير|فاتورة|حساب|رقم)(?:\s|$)/i.test(merchant)) return merchant;
    }
    if (type.key === 'installment') {
      match = message.match(/تمويل\s*[:：]\s*([^\r\n]+)/);
      if (match) { const merchant = cleanMerchant(match[1]); if (merchant) return merchant; }
    }
    const excluded = /شراء|\bPOS\b|مدى|بطاقة|حساب|مبلغ|المبلغ|رسوم|حد الصرف|المتبقي|سداد|حوالة|تحويل|قسط|تمويل|مرابحة|فاتورة|فواتير|\bSAR\b|ريال|\b(?:في|at|on)\s+(?:\d|GB)/i;
    const candidates = message.split(/\r?\n/).map(line => line.trim()).filter(line =>
      line.length >= 3 && /[A-Za-z\u0600-\u06ff]/.test(line) && !excluded.test(line) && !/^\d/.test(line) && !/^(?:في|بتاريخ|on|at)\s*[:：]?\s*(?:\d|GB)/i.test(line)
    );
    if (candidates.length) return cleanMerchant(candidates[0]);
    return ({
      'card-payment': 'سداد بطاقة ائتمانية',
      transfer: 'حوالة صادرة',
      installment: 'قسط تمويل',
      bill: 'سداد فاتورة',
      purchase: 'شراء بطاقة',
      cash: 'سحب نقدي',
      other: 'خصم بنكي'
    })[type.key];
  }

  function suggestCategory(message, merchant, type) {
    const text = `${message} ${merchant}`.toLocaleLowerCase('ar');
    if (type.key === 'card-payment' || type.key === 'installment') return 'الالتزامات';
    if (type.key === 'transfer') return 'التحويلات';
    if (type.key === 'bill') return 'الفواتير';
    if (/airbnb|booking|hotel|airline|flight|طيران|فندق|سفر/.test(text)) return 'السفر';
    if (/ejar|إيجار|ايجار|عقار|rent/.test(text)) return 'المنزل';
    if (/panda|tamwinat|tamimi|تموينات|بقالة|سوبرماركت|سوق|مطعم|مقهى|كافيه|restaurant|grocery|market|food/.test(text)) return 'الطعام';
    if (/بنزين|وقود|محطة|uber|careem|أوبر|كريم|petrol|fuel|taxi/.test(text)) return 'النقل';
    if (/صيدلية|مستشفى|عيادة|pharmacy|hospital|clinic/.test(text)) return 'الصحة';
    if (/مدرسة|جامعة|تعليم|school|university|education/.test(text)) return 'التعليم';
    if (/stc|الاتصالات|كهرباء|الطاقة|مياه|فاتورة|internet|electric|utility/.test(text)) return 'الفواتير';
    if (type.key === 'purchase') return 'التسوق';
    return 'أخرى';
  }

  function parse(messageText, todayISO) {
    const message = normalizeText(messageText);
    if (!message.trim()) return { ok: false, error: 'الصق نص رسالة البنك أولاً.' };
    const amount = extractAmount(message);
    if (!amount) return { ok: false, error: 'لم أتمكن من تحديد مبلغ واضح من الرسالة.' };
    const type = classify(message);
    const dateISO = extractDate(message);
    const merchant = extractMerchant(message, type) || type.label;
    return {
      ok: true,
      amount,
      dateISO: dateISO || todayISO,
      dateFound: Boolean(dateISO),
      merchant,
      type: type.key,
      typeLabel: type.label,
      category: suggestCategory(message, merchant, type)
    };
  }

  return { parse, normalizeText };
});
