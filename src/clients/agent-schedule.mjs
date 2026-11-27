const clock = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** The job schedule gates future collections. Queued batches keep their original authorization. */
export function scheduleAgentJob(job, profile, now = new Date()) {
  if (!profile) return job;
  const schedule = job.source === 'NFCE' ? profile.consumerSchedule : job.source === 'NFE' ? profile.invoiceSchedule : profile.serviceInvoiceSchedule;
  if (!profile.active || !schedule || schedule.period === 'disabled') return { ...job, schedule: schedule ?? null, inCollectionWindow: false };
  const current = clock.format(now);
  const day = current >= '06:00' && current < '18:00';
  const inCollectionWindow = schedule.period === 'day'
    ? day && current >= schedule.time
    : !day && (schedule.time >= '18:00' ? current >= schedule.time || current < '06:00' : current >= schedule.time && current < '06:00');
  return { ...job, schedule, inCollectionWindow };
}
