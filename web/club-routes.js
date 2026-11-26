export const CLUB_PATHS = Object.freeze({
  home: '/clube',
  benefits: '/clube/beneficios',
  advantages: '/clube/vantagens',
  partners: '/clube/parceiros',
});

const pageByPath = new Map(Object.entries(CLUB_PATHS).map(([page, path]) => [path, page]));
pageByPath.set('/clube/check-in', 'home');

export function clubPageFromPath(pathname) {
  return pageByPath.get(pathname.replace(/\/$/, ''));
}
