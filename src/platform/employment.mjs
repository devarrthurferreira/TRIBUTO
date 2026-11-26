const localDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function saoPauloDate(now = new Date()) {
  return localDate.format(now);
}

export function completedTenureYears(admissionDate, now = new Date()) {
  if (admissionDate instanceof Date) admissionDate = admissionDate.toISOString().slice(0, 10);
  if (typeof admissionDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(admissionDate)) return 0;
  const today = saoPauloDate(now);
  const years = Number(today.slice(0, 4)) - Number(admissionDate.slice(0, 4));
  // The anniversary of February 29 is reached on March 1 in a common year.
  return Math.max(0, years - Number(today.slice(5) < admissionDate.slice(5)));
}
