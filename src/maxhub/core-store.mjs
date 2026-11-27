import { MODULES, grantLevel } from '../platform/policy.mjs';
import { completedTenureYears } from '../platform/employment.mjs';
import { awardMaxcoin, MAXCOIN_RULES, maxcoinLabel } from './points.mjs';

const SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS platform_maxhub_profiles (
    user_id CHAR(36) NOT NULL PRIMARY KEY,
    bio VARCHAR(600) NOT NULL, photo_mime VARCHAR(16) CHARACTER SET ascii NULL, photo_data MEDIUMBLOB NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_maxhub_profile_details (
    user_id CHAR(36) NOT NULL PRIMARY KEY,
    skills_json LONGTEXT NOT NULL, links_json LONGTEXT NOT NULL, education_json LONGTEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_maxhub_points (
    user_id CHAR(36) NOT NULL,
    action VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_hash BINARY(32) NOT NULL, points SMALLINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, action, event_hash),
    KEY idx_maxhub_user_points (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const sectors = MODULES.filter(({ legacy }) => !legacy).map(({ id, label }) => ({ id, label }));
const badges = [
  { minimum: 0, label: 'Boas-vindas', description: 'Você faz parte do MaxHub.', icon: 'person-badge' },
  { minimum: 1_000, label: 'Participação ativa', description: 'Você acumulou 1.000 Maxcoin.', icon: 'graph-up' },
  { minimum: 5_000, label: 'Presença que soma', description: 'Você acumulou 5.000 Maxcoin.', icon: 'gift' },
];

function userSector(grants) {
  if (typeof grants === 'string') {
    try { grants = JSON.parse(grants); }
    catch { return null; }
  }
  const assigned = sectors.filter(({ id }) => ['view', 'edit', 'manage'].includes(grantLevel(grants?.[id])));
  return assigned.length === 1 ? assigned[0].id : null;
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : `${value.replace(' ', 'T')}Z`;
}

function storedList(value) {
  if (typeof value !== 'string') return [];
  try {
    const items = JSON.parse(value);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export class MaxHubCoreStore {
  constructor(platformStore) {
    this.platformStore = platformStore;
    this.pool = platformStore.pool;
  }

  async initialize() {
    for (const schema of SCHEMAS) await this.pool.query(schema);
  }

  visit(userId, day) {
    return awardMaxcoin(this.pool, userId, 'visit', day);
  }

  async leaderboard(userId) {
    const [rows] = await this.pool.execute(`SELECT person.id, person.name, profile.photo_mime IS NOT NULL AS has_avatar,
      employment.admission_date,
      COALESCE(balance.points, 0) AS points
      FROM platform_users person
      LEFT JOIN platform_maxhub_profiles profile ON profile.user_id = person.id
      LEFT JOIN platform_user_employment employment ON employment.user_id = person.id
      LEFT JOIN (SELECT user_id, SUM(points) AS points FROM platform_maxhub_points GROUP BY user_id) balance
        ON balance.user_id = person.id
      WHERE person.active = 1
      ORDER BY points DESC, person.name, person.id`);
    let priorPoints;
    let rank = 0;
    const entries = rows.map((row, index) => {
      const points = Number(row.points);
      if (points !== priorPoints) rank = index + 1;
      priorPoints = points;
      return { id: row.id, name: row.name, hasAvatar: Number(row.has_avatar) === 1,
        tenureYears: completedTenureYears(row.admission_date), points, rank };
    });
    const my = entries.find(({ id }) => id === userId);
    return { entries, my: { points: my?.points ?? 0, rank: my?.rank ?? null } };
  }

  async points(userId) {
    const [rows] = await this.pool.execute(`SELECT entry.action, entry.points, entry.created_at,
      (SELECT SUM(points) FROM platform_maxhub_points WHERE user_id = ?) AS total
      FROM platform_maxhub_points entry WHERE entry.user_id = ?
      ORDER BY entry.created_at DESC, entry.action, entry.event_hash LIMIT 100`, [userId, userId]);
    return {
      total: Number(rows[0]?.total ?? 0),
      rules: MAXCOIN_RULES,
      entries: rows.map(row => ({
        action: row.action, label: maxcoinLabel(row.action), points: Number(row.points), createdAt: toIso(row.created_at),
      })),
    };
  }

  async profile(user) {
    const [[row]] = await this.pool.execute(`SELECT profile.bio, profile.photo_mime IS NOT NULL AS has_avatar,
      details.skills_json, details.links_json, details.education_json, employment.admission_date,
      (SELECT COALESCE(SUM(points), 0) FROM platform_maxhub_points WHERE user_id = ?) AS points
      FROM platform_users person LEFT JOIN platform_maxhub_profiles profile ON profile.user_id = person.id
      LEFT JOIN platform_maxhub_profile_details details ON details.user_id = person.id
      LEFT JOIN platform_user_employment employment ON employment.user_id = person.id
      WHERE person.id = ?`, [user._id, user._id]);
    const points = Number(row?.points ?? 0);
    return {
      id: user._id, name: user.name, bio: row?.bio ?? '', hasAvatar: Number(row?.has_avatar) === 1,
      admissionDate: row?.admission_date ?? null, tenureYears: completedTenureYears(row?.admission_date),
      skills: storedList(row?.skills_json), personalLinks: storedList(row?.links_json), education: storedList(row?.education_json),
      badges: badges.filter(({ minimum }) => points >= minimum).map(({ label, description, icon }) => ({ label, description, icon })),
      points, sector: userSector(user.moduleGrants),
    };
  }

  async updateProfile(user, { bio, photo, skills, personalLinks, education }) {
    await this.platformStore.transaction(async connection => {
      if (bio !== undefined || photo !== undefined) {
        await connection.execute(`INSERT INTO platform_maxhub_profiles (user_id, bio, photo_mime, photo_data)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE bio = IF(?, VALUES(bio), bio),
            photo_mime = IF(?, VALUES(photo_mime), photo_mime),
            photo_data = IF(?, VALUES(photo_data), photo_data)`, [
          user._id, bio ?? '', photo?.mime ?? null, photo?.data ?? null,
          bio !== undefined, photo !== undefined, photo !== undefined,
        ]);
      }
      const lists = [skills, personalLinks, education].map(items => items === undefined ? null : JSON.stringify(items));
      if (lists.some(items => items !== null)) {
        await connection.execute(`INSERT INTO platform_maxhub_profile_details (user_id, skills_json, links_json, education_json)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE skills_json = COALESCE(?, skills_json),
            links_json = COALESCE(?, links_json), education_json = COALESCE(?, education_json)`,
        [user._id, ...lists.map(items => items ?? '[]'), ...lists]);
      }
    });
    return this.profile(user);
  }

  async avatar(userId) {
    const [[row]] = await this.pool.execute(`SELECT profile.photo_mime AS mime, profile.photo_data AS data
      FROM platform_maxhub_profiles profile
      INNER JOIN platform_users person ON person.id = profile.user_id AND person.active = 1
      WHERE profile.user_id = ? AND profile.photo_mime IS NOT NULL`, [userId]);
    return row ?? null;
  }

  async teamProfile(id) {
    const [[row]] = await this.pool.execute(`SELECT u.name, u.module_grants, p.bio,
      p.photo_mime IS NOT NULL AS has_avatar, d.skills_json, e.admission_date
      FROM platform_users u LEFT JOIN platform_maxhub_profiles p ON p.user_id=u.id
      LEFT JOIN platform_maxhub_profile_details d ON d.user_id=u.id
      LEFT JOIN platform_user_employment e ON e.user_id=u.id WHERE u.id=? AND u.active=1`, [id]);
    if (!row) return null;
    return {name:row.name, bio:row.bio, hasAvatar:Boolean(Number(row.has_avatar)), skills:storedList(row.skills_json),
      sector:sectors.find(s=>s.id===userSector(row.module_grants))?.label, tenureYears:completedTenureYears(row.admission_date)};
  }

  async directory(query) {
    const pattern = `%${query.replace(/[=%_]/g, '=$&')}%`;
    const [rows] = await this.pool.execute(`SELECT person.id, person.name, person.module_grants, employment.admission_date,
      profile.photo_mime IS NOT NULL AS has_avatar
      FROM platform_users person LEFT JOIN platform_maxhub_profiles profile ON profile.user_id = person.id
      LEFT JOIN platform_user_employment employment ON employment.user_id = person.id
      WHERE person.active = 1 AND person.name COLLATE utf8mb4_unicode_ci LIKE ? ESCAPE '='
      ORDER BY person.name, person.id LIMIT 100`, [pattern]);
    return {
      people: rows.map(row => ({
        id: row.id, name: row.name, hasAvatar: Number(row.has_avatar) === 1, sector: userSector(row.module_grants),
        tenureYears: completedTenureYears(row.admission_date),
      })),
      sectors,
    };
  }
}
