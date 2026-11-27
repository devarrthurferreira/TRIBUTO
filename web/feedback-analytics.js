const countFormat = new Intl.NumberFormat('pt-BR');
const scoreFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const monthFormat = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgNode(tag, attributes, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function score(value) {
  return Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
}

function card(title, icon) {
  const panel = element('article', 'fb-metrics-card');
  const header = element('header');
  const symbol = element('i', 'bi bi-' + icon);
  symbol.setAttribute('aria-hidden', 'true');
  header.append(element('h3', '', title), symbol);
  panel.append(header);
  return panel;
}

function legend(entries) {
  const list = element('ul', 'fb-chart-legend');
  for (const [series, label] of entries) {
    const item = element('li');
    item.append(element('span', 'fb-key fb-key-' + series), document.createTextNode(label));
    list.append(item);
  }
  return list;
}

function valuesTable(headers, rows) {
  const details = element('details', 'fb-chart-values');
  const table = element('table');
  const head = table.createTHead().insertRow();
  for (const label of headers) {
    const cell = element('th', '', label);
    cell.scope = 'col';
    head.append(cell);
  }
  const body = table.createTBody();
  for (const [label, ...values] of rows) {
    const row = body.insertRow();
    const key = element('th', '', label);
    key.scope = 'row';
    row.append(key);
    for (const value of values) row.append(element('td', '', value));
  }
  details.append(element('summary', '', 'Ver valores do gráfico'), table);
  return details;
}

function drawRadar(criteria) {
  const panel = card('Resumo por item', 'diagram-3');
  const note = element('p', 'fb-chart-note', 'A média da Maximum aparece por item a partir de três avaliadores.');
  const hasRatings = criteria.some(row => row.received !== null || row.company !== null);
  if (!hasRatings) {
    panel.append(element('p', 'fb-chart-empty', 'Nenhuma média disponível neste período.'), note);
    return panel;
  }
  const graph = svgNode('svg', { class: 'fb-radar', viewBox: '0 0 470 285', 'aria-hidden': 'true' });
  const cx = 235, cy = 143, radius = 102;
  function point(index, value) {
    const angle = index * 2 * Math.PI / criteria.length - Math.PI / 2;
    return [cx + radius * value / 5 * Math.cos(angle), cy + radius * value / 5 * Math.sin(angle)];
  }

  for (let value = 1; value <= 5; value++) {
    const points = criteria.map((_, i) => point(i, value).join(',')).join(' ');
    graph.append(svgNode('polygon', { points, class: 'fb-chart-grid' }));
  }
  criteria.forEach(({ label }, i) => {
    const [x, y] = point(i, 5);
    const align = Math.abs(x - cx) < 1 ? 'middle' : x > cx ? 'start' : 'end';
    graph.append(svgNode('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'fb-chart-grid' }));
    const [lx, ly] = point(i, 5.45);
    graph.append(svgNode('text', { x: lx, y: ly, 'text-anchor': align, 'dominant-baseline': 'middle' }, label));
  });
  for (const series of ['company', 'received']) {
    const points = criteria.map((entry, i) => entry[series] == null ? null : point(i, entry[series]));
    if (points.every(Boolean)) {
      graph.append(svgNode('polygon', { points: points.map(p => p.join(',')).join(' '), class: 'fb-series fb-series-' + series }));
    } else {
      points.forEach((p, i) => {
        const next = points[(i + 1) % points.length];
        if (p && next) graph.append(svgNode('line', { x1: p[0], y1: p[1], x2: next[0], y2: next[1], class: 'fb-series fb-series-' + series }));
      });
    }
    points.forEach((p, i) => {
      if (!p) return;
      const dot = svgNode('circle', { cx: p[0], cy: p[1], r: series === 'company' ? 4.5 : 3, class: 'fb-point-' + series });
      dot.append(svgNode('title', {}, criteria[i].label + ' · ' + scoreFormat.format(criteria[i][series])));
      graph.append(dot);
    });
  }
  for (let value = 1; value <= 5; value++) {
    graph.append(svgNode('text', { x: cx + 5, y: cy - radius * value / 5 + 9, class: 'fb-scale-label' }, value));
  }
  const format = value => value == null ? 'Sem nota' : scoreFormat.format(value);
  panel.append(legend([['received', 'Feedbacks recebidos'], ['company', 'Média da companhia']]), graph,
    valuesTable(['Item', 'Sua média', 'Companhia'], criteria.map(row => [row.label, format(row.received), format(row.company)])));
  if (criteria.some(row => row.company === null)) panel.append(note);
  return panel;
}

function monthLabel(month) {
  const [year, number] = month.split('-').map(Number);
  return monthFormat.format(new Date(Date.UTC(year, number - 1, 1))).replace(' de ', '/').replace('.', '');
}

function drawMonths(months) {
  const panel = card('Resumo mensal de feedbacks enviados e recebidos', 'graph-up');
  if (!months.length) {
    panel.append(element('p', 'fb-chart-empty', 'Nenhum mês disponível neste período.'));
    return panel;
  }
  const start = monthLabel(months[0].month);
  const end = monthLabel(months[months.length - 1].month);
  panel.append(element('p', 'fb-chart-note', start === end ? start : start + ' a ' + end));
  const high = Math.max(1, ...months.map(row => Math.max(row.sent ?? 0, row.received ?? 0)));
  const stepBase = Math.pow(10, Math.floor(Math.log10(Math.max(1, high / 4))));
  const step = [1, 2, 5, 10].map(n => n * stepBase).find(n => n >= high / 4);
  const ceiling = Math.ceil(high / step) * step;
  const width = Math.max(450, months.length * 59 + 64);
  const left = 40, bottom = 211, plotHeight = 178, band = (width - left - 12) / months.length;
  const graph = svgNode('svg', { class: 'fb-bars', width, viewBox: '0 0 ' + width + ' 245', 'aria-hidden': 'true' });
  for (let count = 0; count <= ceiling; count += step) {
    const y = bottom - plotHeight * count / ceiling;
    graph.append(svgNode('line', { x1: left, x2: width - 12, y1: y, y2: y, class: 'fb-chart-grid' }),
      svgNode('text', { x: left - 6, y: y + 4, 'text-anchor': 'end' }, countFormat.format(count)));
  }
  const barWidth = Math.min(26, band * .32);
  months.forEach((row, i) => {
    const x = left + (i + .5) * band;
    for (const [index, series] of ['sent', 'received'].entries()) {
      const value = row[series];
      if (value == null) continue;
      const height = plotHeight * value / ceiling;
      const bar = svgNode('rect', { x: index ? x + 1 : x - barWidth - 1, y: bottom - height,
        width: barWidth, height, rx: 2, class: 'fb-bar-' + series });
      bar.append(svgNode('title', {}, monthLabel(row.month) + ' · ' + (index ? 'Recebidos' : 'Enviados') + ' · ' + value));
      graph.append(bar);
    }
    graph.append(svgNode('text', { x, y: bottom + 19, 'text-anchor': 'middle' }, monthLabel(row.month)));
  });
  const viewport = element('div', 'fb-time-plot' + (months.length > 6 ? ' fb-time-scroll' : ''));
  if (months.length > 6) {
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', 'Gráfico mensal com rolagem horizontal');
  }
  viewport.append(graph);
  const format = n => n == null ? 'Sem dado' : countFormat.format(n);
  panel.append(legend([['sent', 'Enviados'], ['received', 'Recebidos']]), viewport,
    valuesTable(['Mês', 'Enviados', 'Recebidos'], months.map(row => [monthLabel(row.month), format(row.sent), format(row.received)])));
  return panel;
}

export function renderFeedbackAnalytics(data, criteriaLabels) {
  const section = element('section', 'fb-metrics');
  section.setAttribute('aria-label', 'Indicadores de feedback');
  for (const [key, label, icon] of [['received', 'Feedbacks recebidos', 'download'], ['sent', 'Feedbacks enviados', 'send']]) {
    const metric = card(label, icon);
    metric.append(element('strong', 'fb-metrics-count', Number.isFinite(data[key]) ? countFormat.format(data[key]) : '—'));
    section.append(metric);
  }
  const criteria = Object.entries(criteriaLabels).map(([key, [label]]) => ({
    label, received: score(data.criteria?.[key]?.received), company: score(data.criteria?.[key]?.company),
  }));
  section.append(drawRadar(criteria), drawMonths(data.months || []));
  return section;
}
