const milestones = [
  [1, 'person-badge'],
  [5, 'buildings'],
  [8, 'diagram-3'],
  [10, 'graph-up'],
  [12, 'sun'],
  [15, 'shield-lock'],
  [18, 'moon-stars'],
  [20, 'gift'],
  [21, 'check2'],
  [22, 'people'],
  [23, 'broadcast-pin'],
  [24, 'briefcase'],
  [25, 'arrow-up-right'],
  [26, 'link-45deg'],
  [27, 'journal-text'],
  [28, 'circle-fill'],
  [29, 'grid'],
  [30, 'person-circle'],
];

function tenureLabel(years) {
  if (!Number.isInteger(years) || years < 1) return '';
  return years === 1 ? '1 ano de Maximum' : `${years} anos de Maximum`;
}

export function personOptionLabel({ name, tenureYears }) {
  const tenure = tenureLabel(tenureYears);
  return tenure ? `${name} · ${tenure}` : name;
}

export function tenureBadge(years) {
  const title = tenureLabel(years);
  if (!title) return null;
  const [milestone, icon] = milestones.findLast(([minimum]) => minimum <= years);
  const badge = document.createElement('span');
  badge.className = 'person-tenure-badge';
  badge.dataset.milestone = String(milestone);
  badge.title = title;
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', title);
  const mark = document.createElement('i');
  mark.className = `bi bi-${icon}`;
  mark.setAttribute('aria-hidden', 'true');
  const number = document.createElement('span');
  number.textContent = String(years);
  number.setAttribute('aria-hidden', 'true');
  badge.append(mark, number);
  return badge;
}

export function appendPersonName(label, name, years) {
  const badge = tenureBadge(years);
  if (!badge) {
    label.append(document.createTextNode(name ?? ''));
    return label;
  }
  const identity = document.createElement('span');
  identity.className = 'person-with-tenure';
  const text = document.createElement('span');
  text.className = 'person-name-text';
  text.textContent = name ?? '';
  identity.append(text, badge);
  label.append(identity);
  return label;
}
