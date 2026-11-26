/* Svens Holzkunst - OCR Auswertung v2. Bestehende Firebase-Buchungen bleiben unveraendert. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const money = str => {
    const s = str.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) && n > 0 && n < 1000000 ? n : null;
  };
  const isAmount = /\b\d{1,6}(?:\.\d{3})*,\d{2}\b|\b\d{1,6}\.\d{2}\b/g;
  const norm = s => s.normalize('NFKC').replace(/[|]/g, 'I').replace(/\s+/g, ' ').trim();
  const cleanName = s => norm(s).replace(/^[\W\d_]+/, '').replace(/\s*(?:\b(?:Tel|Telefon|Fax|IBAN|USt|Steuer|Poststr|Straße|Strasse|PLZ)\b).*$/i, '').trim();
  function parse(text) {
    const lines = text.split(/\r?\n/).map(norm).filter(Boolean);
    let merchant = null, merchantConfidence = 'nicht erkannt';
    // Bevorzuge explizit gekennzeichnete Firmenzeilen; vermeide Kopfzeilen und Werbetexte.
    const companyLines = lines.filter(l => /\b(?:Firma|Fa\.)\s+[\p{L}]/iu.test(l) && !/\b(?:Firma\s+tap|Firma\s+F[FO]N)\b/i.test(l));
    for (const l of companyLines) {
      const m = l.match(/\b(?:Firma|Fa\.)\s+([\p{L}][\p{L}\s.'-]{3,65})(?=\s*(?:Poststra|Straße|Strasse|,|\d{5}|[}\]|]|$))/iu);
      if (m) { merchant = cleanName(m[1]); merchantConfidence = 'prüfen'; break; }
    }
    if (!merchant) {
      const domainLine = lines.find(l => /(?:www\.|@)[\w.-]+\.[a-z]{2,}/i.test(l));
      if (domainLine) {
        const m = domainLine.match(/(?:www\.|@)([\w-]+)(?:\.[\w-]+)*\.[a-z]{2,}/i);
        if (m) { merchant = m[1].replace(/[-_]/g, ' '); merchantConfidence = 'prüfen'; }
      }
    }
    let date = null;
    const labeled = lines.find(l => /\b(?:Rechnungsdatum|Datum)\b/i.test(l) && /\d{1,2}[.\/-]\d{1,2}[.\/-]20\d{2}/.test(l));
    const dateMatch = (labeled || text).match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})\b/);
    if (dateMatch) {
      const [,d,m,y] = dateMatch, iso = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
      const check = new Date(`${iso}T12:00:00`);
      if (check.getFullYear() === Number(y) && check.getMonth()+1 === Number(m) && check.getDate() === Number(d)) date = iso;
    }
    const invoiceLine = lines.find(l => /Rechnungs?\s*(?:nr\.?|nummer)\s*[:.]?/i.test(l));
    let invoice = null;
    if (invoiceLine) {
      const match = invoiceLine.match(/(?:Rechnungs?\s*(?:nr\.?|nummer))\s*[:.]?\s*([A-Z0-9][A-Z0-9/_.-]{3,})/i);
      if (match) invoice = match[1];
    }
    // Nur eindeutig bezeichnete Endbetraege automatisch vorschlagen.
    // Zwischensummen sind nicht mit dem zu zahlenden Gesamtbetrag gleichzusetzen.
    const endLabels = /\b(?:rechnungsbetrag|endbetrag|gesamtbetrag|zu\s+zahlen|zahlbetrag|summe\s+brutto|bruttosumme|total\s+due)\b/i;
    const genericLabels = /\b(?:gesamt|summe|total)\b/i;
    const intermediateLabels = /\b(?:zwischensumme|netto|mehrwertsteuer|mwst|ust|steuerbetrag|einzelpreis)\b/i;
    const amounts = (line) => [...line.matchAll(isAmount)].map(m => money(m[0])).filter(n => n !== null);
    const exact = [], generic = [], subtotal = [];
    for (let i=0; i<lines.length; i++) {
      const line = lines[i];
      const vals = amounts(line);
      if (intermediateLabels.test(line)) {
        if (/zwischensumme/i.test(line)) subtotal.push(...vals, ...(vals.length ? [] : amounts(lines[i+1] || '')));
        continue;
      }
      if (endLabels.test(line)) exact.push(...vals, ...(vals.length ? [] : amounts(lines[i+1] || '')));
      else if (genericLabels.test(line) && !/\b(?:Gesamt\s*[€C]|Menge|Einzel)\b/i.test(line)) generic.push(...vals);
    }
    const unique = values => [...new Set(values.map(v => v.toFixed(2)))].map(Number);
    let amount = null, amountStatus = 'nicht erkannt';
    const finals = unique(exact);
    if (finals.length === 1) { amount = finals[0]; amountStatus = 'Endbetrag erkannt, prüfen'; }
    else if (finals.length > 1) amountStatus = 'mehrere Endbeträge, manuell prüfen';
    else {
      const totals = unique(generic);
      if (totals.length === 1) { amount = totals[0]; amountStatus = 'Gesamtsumme erkannt, prüfen'; }
      else if (totals.length > 1) amountStatus = 'mehrere Summen, manuell prüfen';
      else if (subtotal.length) amountStatus = `nur Zwischensumme ${unique(subtotal).map(v=>v.toFixed(2).replace('.',',')+' €').join(' / ')} erkannt; Endbetrag manuell prüfen`;
    }
    return {merchant,merchantConfidence,date,invoice,amount,amountStatus};
  }
  function setup() {
    const apply = $('apply'), text = $('ocrText'), desc = $('description'), amount = $('amount');
    if (!apply || !text || !desc || !amount) return;
    const panel = document.createElement('div');
    panel.style.cssText='background:#fff5df;padding:12px;border-radius:8px;margin:10px 0;white-space:pre-wrap;font-size:14px';
    panel.setAttribute('aria-live','polite');
    panel.textContent='Noch keine Rechnung ausgewertet.';
    apply.parentNode.insertBefore(panel,apply.nextSibling);
    const invoiceLabel = document.createElement('label');
    invoiceLabel.textContent='Rechnungsnummer (optional, nur zur Kontrolle)';
    const invoiceInput = document.createElement('input');
    invoiceInput.type='text'; invoiceInput.id='invoiceReview';invoiceInput.placeholder='z. B. RE-11/26--3829';
    invoiceInput.style.cssText='display:block;width:100%;box-sizing:border-box;padding:10px;margin:6px 0 12px';
    invoiceLabel.appendChild(invoiceInput);
    panel.parentNode.insertBefore(invoiceLabel,panel.nextSibling);
    apply.addEventListener('click', e => {
      // Den bisherigen einfachen Parser bewusst ueberschreiben.
      e.stopImmediatePropagation();e.preventDefault();
      const p=parse(text.value);
      if (!text.value.trim()) { panel.textContent='Bitte zuerst einen Beleg erkennen lassen.';return; }
      if (p.date && $('date')) $('date').value=p.date;
      if (p.merchant) desc.value='Einkauf: '+p.merchant;
      if (p.amount !== null) amount.value=p.amount.toFixed(2).replace('.',',');
      else amount.value=''; // keine alte oder zweifelhafte Summe beibehalten
      if ($('type')) $('type').value='Ausgabe';
      invoiceInput.value=p.invoice||'';
      panel.textContent = `Händler: ${p.merchant||'nicht erkannt'} (${p.merchantConfidence})\n`+
        `Datum: ${p.date||'nicht erkannt'}\nRechnungsnummer: ${p.invoice||'nicht erkannt'}\n`+
        `Betrag: ${p.amount===null?'NICHT übernommen':p.amount.toFixed(2).replace('.',',')+' €'} (${p.amountStatus})\n`+
        'Bitte alle Angaben am Original kontrollieren. Rechnungsnummer wird in dieser Version noch nicht in Firebase gespeichert.';
    },true);
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',setup); else setup();
  // Nur für lokale Funktionstests verfügbar; kein Netzwerkzugriff.
  if (typeof window!=='undefined') window.SvensReceiptParserV2 = parse;
})();
