const intlLocale = (locale) => (locale === 'en' ? 'en-GB' : 'fr-FR');

export const formatMoney = (cents, locale = 'fr') =>
  new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency: 'EUR' }).format(cents / 100);

export const formatDateTime = (iso, timeZone, locale = 'fr') =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

export const cityOf = (timeZone) => timeZone.split('/').pop().replace(/_/g, ' ');

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// CSV lisible par Excel : BOM UTF-8, séparateur « ; », protection contre l'injection de formules.
export function toCsv(rows, columns) {
  const cell = (value) => {
    let s = value == null ? '' : String(value);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.label)).join(';')];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
