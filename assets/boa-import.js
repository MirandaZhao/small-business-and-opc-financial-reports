/* Bank of America US checking statements group entries by section, with printed
   statement balances but no running balance or transaction ID on each entry. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data-engine.js'));
  else {
    root.YoushuBoa = factory(root.YoushuData);
    (root.YoushuEnglish ||= []).push({text: root.YoushuBoa.translations});
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';
  const format = 'boa-checking-pdf-v1';
  const sections = new Map([
    ['deposits and other additions', 'deposits'],
    ['withdrawals and other subtractions', 'withdrawals'],
    ['atm and debit card subtractions', 'card'],
    ['other subtractions', 'other'],
    ['checks', 'checks'],
    ['service fees', 'fees']
  ]);
  const messages = {
    product: ['请使用美国银行美元支票账户的原始文字版月结单。', 'Use an original text PDF for a Bank of America U.S. dollar checking account.'],
    pages: ['页面编号、页数或文字层不完整，请使用完整的原始月结单。', 'The page numbers, page count or text layer is incomplete. Use the complete original statement.'],
    account: ['无法确认各页属于同一银行账户和账期。', 'The pages could not be matched to one account and statement period.'],
    summary: ['无法完整核对月结单首页的账户汇总。', 'The account summary on the first page could not be verified in full.'],
    layout: ['交易表的栏目、续页或小计无法确认，请核对原始月结单。', 'A transaction section, continuation or subtotal could not be verified. Check the original statement.'],
    row: ['交易行的日期、摘要、金额或位置无法确认。', 'The transaction date, description, amount or location could not be verified.'],
    totals: ['交易明细与银行列出的分项合计不一致。', 'The transactions do not add up to the section totals printed by the bank.'],
    balance: ['期初余额加本期收支与银行列出的期末余额不一致。', 'Opening balance plus receipts less payments does not match the printed closing balance.']
  };
  const translations = Object.fromEntries(Object.values(messages));
  const monthNames = 'january february march april may june july august september october november december'.split(' ');
  const longDate = '(' + monthNames.join('|') + ')\\s+(\\d{1,2}),?\\s+(\\d{4})';
  const periodPattern = new RegExp('\\b' + longDate + '\\s+to\\s+' + longDate + '\\b', 'i');
  const amountPattern = '(-?\\$?-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{2})';
  const trailingAmount = new RegExp('\\s+' + amountPattern + '$');
  const balancePattern = new RegExp('^(Beginning|Ending) balance on ' + longDate + '\\s+' + amountPattern + '$', 'i');
  const accountPattern = /\bAccount\s*(?:number\s*:|#)\s*([\dX*]+(?:[ -][\dX*]+)*)/ig;
  const sectionKey = name => sections.get(name.toLowerCase());
  const cells = row => row.map(v => String(v ?? '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  function recognizes(rows) {
    const page = rows.map(cells).join('\n');
    return /\bbank(?:\s+of\s+america|ofamerica\.com)\b/i.test(page) && /^account summary$/im.test(page);
  }
  function detect(result) {
    const first = result?.format === 'pdf' && result.sheets?.find(s => s.page === 1);
    return !!first && Array.isArray(first.rows) && recognizes(first.rows);
  }
  function money(raw) {
    if (!raw || raw.includes('--') || raw.includes('-$-')) return NaN;
    const value = Number(raw.replace(/[$,.]/g, ''));
    return Number.isSafeInteger(value) ? value : NaN;
  }
  function date(year, month, day) {
    try { return D.parseDate([year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-')); }
    catch { return ''; }
  }
  const calendarDate = (month, day, year) => date(year, monthNames.indexOf(month.toLowerCase()) + 1, day);
  function postedDate(raw, start, end) {
    if (!start || !end) return '';
    const [month, day, year] = raw.split('/');
    for (const full of new Set([start.slice(0, 4), end.slice(0, 4)])) {
      if (year !== full && year !== full.slice(-2)) continue;
      const value = date(full, month, day);
      if (value >= start && value <= end) return value;
    }
    return '';
  }
  function parse(result, name) {
    if (!detect(result)) return null;
    const rows = [], errors = [], totals = {}, computed = {}, completed = new Set();
    function issue(type, page = 1, row = 0) {
      errors.push({code: 'BOA_' + type.toUpperCase(), message: messages[type][0], en: messages[type][1], page, row});
    }
    const pages = result.sheets.filter(s => Number.isInteger(s.page)).sort((a, b) => a.page - b.page);
    const count = result.pages, front = pages[0].rows.map(cells), cover = front.join('\n');
    if (!Number.isInteger(count) || count < 1 || pages.length !== count) issue('pages');
    if (!/\b(?:Adv(?:antage)?\.?\s+(?:Plus|SafeBalance|Relationship)\s+Banking|Checking)\b/i.test(cover) ||
        /\b(?:CAD|EUR|GBP|Canadian dollars?|foreign currency)\b/i.test(cover)) issue('product');
    const accountLines = [...cover.matchAll(accountPattern)].map(m => m[1].replace(/[ -]/g, ''));
    const token = accountLines[0] || '';
    if (accountLines.length !== 1 || !/^[\d*X]{4,16}\d{4}$/i.test(token)) issue('account');
    const accountMasked = token ? '****' + token.slice(-4) : '';
    const account = accountMasked ? 'Bank of America ' + accountMasked : '';
    // Mask the full printed account wherever it reappears inside transaction descriptions.
    const scrub = token && new RegExp(token.split('').map(c => c === '*' ? '\\*' : c).join('[ -]?'), 'gi');
    function mask(description) {
      const text = scrub ? description.replace(scrub, accountMasked) : description;
      return text.replace(/(\b(?:account|acct|card)\s*(?:number|no\.?|#)[:\s]*)(\d(?:[ -]?\d){7,18})\b/gi,
        (_, label, digits) => label + '****' + digits.replace(/\D/g, '').slice(-4));
    }
    const period = periodPattern.exec(cover);
    const start = period ? calendarDate(...period.slice(1, 4)) : '', end = period ? calendarDate(...period.slice(4, 7)) : '';
    if (!start || !end || start > end) issue('account');
    let opening = NaN, closing = NaN, inSummary = false, sawSummary = false, endedSummary = false;
    for (const [i, line] of front.entries()) {
      if (/^Account summary$/i.test(line)) {
        if (sawSummary) issue('summary', 1, i + 1);
        inSummary = sawSummary = true;
        continue;
      }
      if (!inSummary) continue;
      const balance = balancePattern.exec(line);
      if (balance) {
        const isOpening = /^beginning$/i.test(balance[1]), amount = money(balance[5]);
        if (calendarDate(...balance.slice(2, 5)) !== (isOpening ? start : end) || !Number.isSafeInteger(amount)) issue('summary', 1, i + 1);
        if (isOpening) {
          if (Number.isFinite(opening) || Object.keys(totals).length) issue('summary', 1, i + 1);
          opening = amount;
        } else { closing = amount; inSummary = false; endedSummary = true; }
        continue;
      }
      const match = trailingAmount.exec(line), section = match && sectionKey(line.slice(0, match.index));
      const amount = match && money(match[1]);
      if (!section || section in totals || !Number.isSafeInteger(amount) || !Number.isFinite(opening) ||
          (section === 'deposits' ? amount < 0 : amount > 0)) issue('summary', 1, i + 1);
      else totals[section] = amount;
    }
    if (!endedSummary || !Number.isFinite(opening) || !Number.isFinite(closing) || !('deposits' in totals) ||
        !('withdrawals' in totals || 'card' in totals || 'other' in totals)) issue('summary');

    let pending = null;
    for (const [idx, sheet] of pages.entries()) {
      const page = sheet.page, lines = sheet.rows.map(cells);
      const footer = lines.flatMap(t => [...t.matchAll(/\bPage (\d+) of (\d+)\b/ig)]);
      if (page !== idx + 1 || sheet.source !== 'text' || footer.length !== 1 || +footer[0][1] !== page || +footer[0][2] !== count) issue('pages', page);
      if (page === 1) continue;
      // The continuation header includes the account and period. Some notices
      // omit both, so require them on transaction pages and validate any present.
      const pageHeader = lines.slice(0, 3).join('\n');
      const accountMatch = [...pageHeader.matchAll(accountPattern)];
      const pagePeriod = periodPattern.exec(pageHeader);
      const belongs = accountMatch.length === 1 && accountMatch[0][1].replace(/[ -]/g, '') === token && pagePeriod &&
        calendarDate(...pagePeriod.slice(1, 4)) === start && calendarDate(...pagePeriod.slice(4, 7)) === end;
      if ((accountMatch.length || pagePeriod) && !belongs) issue('account', page);
      let current = null, inTable = false, last = null;
      for (const [i, line] of lines.entries()) {
        const lineNo = i + 1;
        const continued = /\s+[-–—]\s*continued$/i.test(line);
        const section = sectionKey(line.replace(/\s+[-–—]\s*continued$/i, ''));
        if (section) {
          if (!belongs || !(section in totals) || completed.has(section) || current ||
              (continued ? pending !== section : pending !== null)) issue('layout', page, lineNo);
          current = section; pending = null; inTable = false; last = null;
          continue;
        }
        if (!current) {
          if (/^\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(line)) issue('layout', page, lineNo);
          continue;
        }
        if (/^Date (?:Transaction description|Description) Amount$/i.test(line)) {
          if (inTable) issue('layout', page, lineNo);
          inTable = true; continue;
        }
        if (!inTable) { issue('layout', page, lineNo); continue; }
        if (/^continued on the next page$/i.test(line)) {
          pending = current; current = null; last = null; continue;
        }
        if (/^Total /i.test(line)) {
          const match = trailingAmount.exec(line);
          if (!match || sectionKey(line.slice(6, match.index)) !== current ||
              money(match[1]) !== totals[current] || (computed[current] || 0) !== totals[current]) issue('totals', page, lineNo);
          completed.add(current); current = null; last = null; continue;
        }
        const stamp = /^(\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))\s+/.exec(line);
        if (!stamp) {
          const physical = sheet.rows[i];
          if (!last || physical.length !== 3 || physical[0] || physical[2] || !physical[1]) { issue('row', page, lineNo); continue; }
          last.category = last.transactionType = mask(last.category + ' ' + line);
          last.sourceRows.push(lineNo);
          continue;
        }
        last = null;
        const match = trailingAmount.exec(line), value = match ? money(match[1]) : NaN;
        const description = match ? mask(line.slice(stamp[0].length, match.index).trim()) : '';
        const posted = postedDate(stamp[1], start, end);
        if (!posted || !description || !Number.isSafeInteger(value) || (current === 'deposits' ? value <= 0 : value >= 0)) {
          issue('row', page, lineNo); continue;
        }
        computed[current] = (computed[current] || 0) + value;
        if (!Number.isSafeInteger(computed[current])) issue('totals', page, lineNo);
        last = {id:'', date:posted, account, counterparty:'', category:description, transactionType:description,
          inflow:Math.max(0, value) / 100, outflow:Math.max(0, -value) / 100, balance:null, activity:'operating',
          sourceType:'bank', sourcePage:page, sourceRow:lineNo, sourceRows:[lineNo], direction:value > 0 ? '收入' : '支出',
          amount:Math.abs(value) / 100, signedAmount:value / 100, currency:'USD', bankFormat:format, section:current};
        rows.push(last);
      }
      if (current) issue('layout', page);
    }
    if (pending) issue('layout', count);
    for (const [key, value] of Object.entries(totals)) {
      if ((computed[key] || 0) !== value || (value !== 0 && !completed.has(key))) issue('totals');
    }
    const income = computed.deposits || 0;
    const outflow = -Object.entries(computed).reduce((sum, [key, amount]) => sum + (key === 'deposits' ? 0 : amount), 0);
    if (!Number.isSafeInteger(outflow) || !Number.isSafeInteger(opening + income) || opening + income - outflow !== closing) issue('balance');
    return {rows, errors, warnings:[], statement:{format, sourceName:name, bank:'Bank of America', currency:'USD', accountMasked, account,
      start, end, pages:count, recordCount:rows.length, income:income / 100, outflow:outflow / 100,
      openingBalance:opening / 100, closingBalance:closing / 100, openingBalanceInferred:false, sourceOrder:'section',
      sectionTotals:Object.fromEntries(Object.entries(totals).map(([key, v]) => [key, v / 100])),
      balanceChecked:!errors.length, balanceCheckCount:errors.length ? 0 : 1,
      balanceErrors:errors.filter(e => e.code === 'BOA_BALANCE' || e.code === 'BOA_TOTALS'), hasTransactionIds:false}};
  }
  return Object.freeze({recognizes, detect, parse, translations});
});
