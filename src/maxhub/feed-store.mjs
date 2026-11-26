import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { grantLevel, LEVELS, MODULES } from '../platform/policy.mjs';
import { awardMaxcoin, revokeMaxcoin } from './points.mjs';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS platform_maxhub_feed (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    author_id CHAR(36) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    body TEXT NOT NULL,
    audience_type VARCHAR(12) NOT NULL,
    audience_sector VARCHAR(30) NULL,
    image_mime VARCHAR(24) NULL,
    image_data MEDIUMBLOB NULL,
    created_at DATETIME(3) NOT NULL,
    KEY idx_maxhub_feed_created (created_at, id),
    KEY idx_maxhub_feed_kind (kind, created_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_maxhub_feed_targets (
    post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) NOT NULL,
    PRIMARY KEY (post_id, user_id),
    CONSTRAINT fk_maxhub_feed_target FOREIGN KEY (post_id) REFERENCES platform_maxhub_feed (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_maxhub_feed_mentions (
    post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) NOT NULL,
    ordinal TINYINT UNSIGNED NOT NULL,
    PRIMARY KEY (post_id, user_id),
    CONSTRAINT fk_maxhub_feed_mention FOREIGN KEY (post_id) REFERENCES platform_maxhub_feed (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_maxhub_feed_comments (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    author_id CHAR(36) NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL,
    KEY idx_maxhub_feed_comments (post_id, created_at, id),
    CONSTRAINT fk_maxhub_feed_comment FOREIGN KEY (post_id) REFERENCES platform_maxhub_feed (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_maxhub_feed_likes (
    post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) NOT NULL,
    PRIMARY KEY (post_id, user_id),
    CONSTRAINT fk_maxhub_feed_like FOREIGN KEY (post_id) REFERENCES platform_maxhub_feed (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const PAGE_SIZE = 20;
const COMMENT_LIMIT = 100;

function placeholders(count) { return Array(count).fill('?').join(', '); }

function accessScope(user) {
  // Administrative privileges alone never disclose private posts.
  const sectors = MODULES.map(module => module.id).filter(id => LEVELS.includes(grantLevel(user.moduleGrants?.[id])));
  const sectorClause = sectors.length ? `OR (post.audience_type = 'sector' AND post.audience_sector IN (${placeholders(sectors.length)}))` : '';
  return {
    where: `(post.author_id = ? OR post.audience_type = 'all' ${sectorClause}
      OR (post.audience_type = 'people' AND EXISTS (SELECT 1 FROM platform_maxhub_feed_targets target
           WHERE target.post_id = post.id AND target.user_id = ?)))`,
    values: [user._id, ...sectors, user._id],
  };
}

function dateLabel(value) {
  return value instanceof Date ? value.toISOString() : `${String(value).replace(' ', 'T')}Z`;
}

function postNotFound() {
  return new ApiError(404, 'MAXHUB_POST_NOT_FOUND', 'Publicação indisponível.');
}

const POST_SELECT = `SELECT post.id, post.author_id, post.kind, post.body, post.audience_type,
  post.audience_sector, post.created_at, post.image_mime IS NOT NULL AS has_image,
  author.name AS author_name, profile.photo_mime IS NOT NULL AS has_avatar,
  (SELECT COUNT(*) FROM platform_maxhub_feed_likes reaction WHERE reaction.post_id = post.id) AS like_count,
  EXISTS (SELECT 1 FROM platform_maxhub_feed_likes my_like WHERE my_like.post_id = post.id AND my_like.user_id = ?) AS liked,
  (SELECT COUNT(*) FROM platform_maxhub_feed_comments comment WHERE comment.post_id = post.id) AS comment_count
  FROM platform_maxhub_feed post INNER JOIN platform_users author ON author.id = post.author_id
  LEFT JOIN platform_maxhub_profiles profile ON profile.user_id = author.id`;

function postView(row, mentions, viewer) {
  return {
    id: row.id, kind: row.kind, text: row.body,
    author: { id: row.author_id, name: row.author_name, hasAvatar: Number(row.has_avatar) === 1 },
    audience: { type: row.audience_type, ...(row.audience_sector ? { sector: row.audience_sector } : {}) },
    mentions, createdAt: dateLabel(row.created_at), hasImage: Number(row.has_image) === 1,
    likeCount: Number(row.like_count), liked: Number(row.liked) === 1, commentCount: Number(row.comment_count),
    canDelete: row.author_id === viewer._id || viewer.role === 'admin',
  };
}

async function includedMentions(connection, ids) {
  if (!ids.length) return new Map();
  const [rows] = await connection.execute(`SELECT mention.post_id, person.id, person.name
    FROM platform_maxhub_feed_mentions mention INNER JOIN platform_users person ON person.id = mention.user_id
    WHERE mention.post_id IN (${placeholders(ids.length)}) ORDER BY mention.post_id, mention.ordinal`, ids);
  const mentions = new Map();
  for (const row of rows) {
    if (!mentions.has(row.post_id)) mentions.set(row.post_id, []);
    mentions.get(row.post_id).push({ id: row.id, name: row.name });
  }
  return mentions;
}

async function visiblePost(connection, viewer, id, lock = false) {
  const scope = accessScope(viewer);
  const [[post]] = await connection.execute(`SELECT post.id, post.author_id, post.kind FROM platform_maxhub_feed post
    WHERE post.id = ? AND ${scope.where}${lock ? ' FOR UPDATE' : ''}`, [id, ...scope.values]);
  if (!post) throw postNotFound();
  return post;
}

async function createdPost(connection, viewer, id) {
  const [[row]] = await connection.execute(`${POST_SELECT} WHERE post.id = ? AND post.author_id = ?`, [viewer._id, id, viewer._id]);
  if (!row) return null;
  const mentions = await includedMentions(connection, [id]);
  return postView(row, mentions.get(id) || [], viewer);
}

async function commentsFor(connection, id) {
  const [rows] = await connection.execute(`SELECT comment.id, comment.body, comment.author_id,
      comment.created_at, author.name AS author_name, profile.photo_mime IS NOT NULL AS has_avatar
    FROM platform_maxhub_feed_comments comment INNER JOIN platform_users author ON author.id = comment.author_id
      LEFT JOIN platform_maxhub_profiles profile ON profile.user_id = author.id
    WHERE comment.post_id = ? ORDER BY comment.created_at DESC, comment.id DESC LIMIT ${COMMENT_LIMIT}`, [id]);
  const [[{ total }]] = await connection.execute('SELECT COUNT(*) AS total FROM platform_maxhub_feed_comments WHERE post_id = ?', [id]);
  const comments = rows.reverse().map(row => ({
    id: row.id, text: row.body, createdAt: dateLabel(row.created_at),
    author: { id: row.author_id, name: row.author_name, hasAvatar: Number(row.has_avatar) === 1 },
  }));
  return { comments, commentCount: Number(total) };
}

export class MaxHubFeedStore {
  constructor(platformStore) { this.platformStore = platformStore; }

  async initialize() {
    for (const sql of TABLES) await this.platformStore.pool.query(sql);
  }

  async list(viewer, { kind, cursor } = {}) {
    const connection = this.platformStore.pool;
    const scope = accessScope(viewer);
    const where = [scope.where];
    const values = [viewer._id, ...scope.values];
    if (kind) { where.push('post.kind = ?'); values.push(kind); }
    if (cursor) {
      where.push('(post.created_at < ? OR (post.created_at = ? AND post.id < ?))');
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const [rows] = await connection.execute(`${POST_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY post.created_at DESC, post.id DESC LIMIT ${PAGE_SIZE + 1}`, values);
    const more = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE);
    const mentions = await includedMentions(connection, page.map(post => post.id));
    const posts = page.map(row => postView(row, mentions.get(row.id) || [], viewer));
    return { posts, nextCursor: more ? Buffer.from(`${posts.at(-1).createdAt}/${posts.at(-1).id}`).toString('base64url') : null };
  }

  async create(viewer, { kind, text, audience, mentions, image, clientId }) {
    if (clientId) {
      const alreadyPublished = await createdPost(this.platformStore.pool, viewer, clientId);
      if (alreadyPublished) return alreadyPublished;
    }
    const id = clientId ?? randomUUID();
    try {
      return await this.platformStore.transaction(async connection => {
        // Write first so simultaneous retries contend on the same key before reading a snapshot.
        await connection.execute(`INSERT INTO platform_maxhub_feed
          (id, author_id, kind, body, audience_type, audience_sector, image_mime, image_data, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, viewer._id, kind, text, audience.type,
          audience.sector ?? null, image?.mime ?? null, image?.data ?? null, new Date()]);
        const userIds = audience.type === 'people' ? audience.userIds : [];
        const selected = [...new Set([...mentions, ...userIds])];
        if (selected.length) {
          const [people] = await connection.execute(`SELECT id FROM platform_users WHERE active = 1
            AND id IN (${placeholders(selected.length)})`, selected);
          if (people.length !== selected.length) throw new ApiError(400, 'MAXHUB_INVALID_PEOPLE', 'Selecione pessoas com acesso ativo à Central.');
        }

        if (userIds.length) {
          await connection.execute(`INSERT INTO platform_maxhub_feed_targets (post_id, user_id)
            VALUES ${userIds.map(() => '(?, ?)').join(', ')}`, userIds.flatMap(userId => [id, userId]));
        }
        if (mentions.length) {
          await connection.execute(`INSERT INTO platform_maxhub_feed_mentions (post_id, user_id, ordinal)
            VALUES ${mentions.map(() => '(?, ?, ?)').join(', ')}`, mentions.flatMap((userId, index) => [id, userId, index]));
        }
        if (kind === 'celebration') await awardMaxcoin(connection, viewer._id, 'celebrate', id);
        return createdPost(connection, viewer, id);
      });
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY' || !clientId) throw error;
      const alreadyPublished = await createdPost(this.platformStore.pool, viewer, clientId);
      if (alreadyPublished) return alreadyPublished;
      throw new ApiError(409, 'MAXHUB_FEED_CONFLICT', 'Não foi possível publicar com este identificador. Tente novamente.');
    }
  }

  async getImage(viewer, id) {
    const scope = accessScope(viewer);
    const [[image]] = await this.platformStore.pool.execute(`SELECT post.image_mime AS mime, post.image_data AS data
      FROM platform_maxhub_feed post WHERE post.id = ? AND post.image_mime IS NOT NULL AND ${scope.where}`,
    [id, ...scope.values]);
    if (!image) throw postNotFound();
    return image;
  }

  async getComments(viewer, id) {
    const connection = this.platformStore.pool;
    await visiblePost(connection, viewer, id);
    return commentsFor(connection, id);
  }

  async addComment(viewer, id, text) {
    return this.platformStore.transaction(async connection => {
      await visiblePost(connection, viewer, id, true);
      await connection.execute(`INSERT INTO platform_maxhub_feed_comments
        (id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`, [randomUUID(), id, viewer._id, text, new Date()]);
      return commentsFor(connection, id);
    });
  }

  async setLike(viewer, id, liked) {
    return this.platformStore.transaction(async connection => {
      await visiblePost(connection, viewer, id, true);
      const values = [id, viewer._id];
      if (liked) {
        await connection.execute(`INSERT INTO platform_maxhub_feed_likes (post_id, user_id)
          VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`, values);
      } else await connection.execute('DELETE FROM platform_maxhub_feed_likes WHERE post_id = ? AND user_id = ?', values);
      const [[{ total }]] = await connection.execute('SELECT COUNT(*) AS total FROM platform_maxhub_feed_likes WHERE post_id = ?', [id]);
      return { liked, likeCount: Number(total) };
    });
  }

  async remove(viewer, id) {
    await this.platformStore.transaction(async connection => {
      const post = await visiblePost(connection, viewer, id, true);
      if (post.author_id !== viewer._id && viewer.role !== 'admin') {
        throw new ApiError(403, 'MAXHUB_POST_FORBIDDEN', 'Somente quem publicou pode remover esta publicação.');
      }
      await connection.execute('DELETE FROM platform_maxhub_feed WHERE id = ?', [id]);
      if (post.kind === 'celebration') await revokeMaxcoin(connection, post.author_id, 'celebrate', id);
    });
  }
}
