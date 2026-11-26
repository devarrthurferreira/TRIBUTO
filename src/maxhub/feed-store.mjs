import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';
import { completedTenureYears } from '../platform/employment.mjs';
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
  `CREATE TABLE IF NOT EXISTS platform_maxhub_feed_reposts (
    post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (post_id, user_id),
    KEY idx_maxhub_feed_repost_created (post_id, created_at, user_id),
    CONSTRAINT fk_maxhub_feed_repost FOREIGN KEY (post_id) REFERENCES platform_maxhub_feed (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_maxhub_feed_saves (
    post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) NOT NULL,
    PRIMARY KEY (post_id, user_id),
    KEY idx_maxhub_feed_saver (user_id, post_id),
    CONSTRAINT fk_maxhub_feed_save FOREIGN KEY (post_id) REFERENCES platform_maxhub_feed (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_maxhub_feed_comment_replies (
    comment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    parent_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    KEY idx_maxhub_comment_parent (parent_id),
    CONSTRAINT fk_maxhub_reply_comment FOREIGN KEY (comment_id) REFERENCES platform_maxhub_feed_comments (id) ON DELETE CASCADE,
    CONSTRAINT fk_maxhub_reply_parent FOREIGN KEY (parent_id) REFERENCES platform_maxhub_feed_comments (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_maxhub_feed_comment_likes (
    comment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) NOT NULL,
    PRIMARY KEY (comment_id, user_id),
    CONSTRAINT fk_maxhub_comment_like FOREIGN KEY (comment_id) REFERENCES platform_maxhub_feed_comments (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS platform_maxhub_feed_comment_saves (
    comment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) NOT NULL,
    PRIMARY KEY (comment_id, user_id),
    KEY idx_maxhub_comment_saver (user_id, comment_id),
    CONSTRAINT fk_maxhub_comment_save FOREIGN KEY (comment_id) REFERENCES platform_maxhub_feed_comments (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const PAGE_SIZE = 20;

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

function commentNotFound() {
  return new ApiError(404, 'MAXHUB_COMMENT_NOT_FOUND', 'Comentário indisponível.');
}

const ACTIVITY_DATE = 'COALESCE(latest_repost.created_at, post.created_at)';
const POST_SELECT = `SELECT post.id, post.author_id, post.kind, post.body, post.audience_type,
  post.audience_sector, post.created_at, post.image_mime IS NOT NULL AS has_image,
  author.name AS author_name, employment.admission_date AS author_admission_date,
  profile.photo_mime IS NOT NULL AS has_avatar,
  (SELECT COUNT(*) FROM platform_maxhub_feed_likes reaction WHERE reaction.post_id = post.id) AS like_count,
  EXISTS (SELECT 1 FROM platform_maxhub_feed_likes my_like WHERE my_like.post_id = post.id AND my_like.user_id = ?) AS liked,
  (SELECT COUNT(*) FROM platform_maxhub_feed_comments comment WHERE comment.post_id = post.id) AS comment_count,
  EXISTS (SELECT 1 FROM platform_maxhub_feed_saves my_save WHERE my_save.post_id = post.id AND my_save.user_id = ?) AS saved,
  EXISTS (SELECT 1 FROM platform_maxhub_feed_reposts my_repost WHERE my_repost.post_id = post.id AND my_repost.user_id = ?) AS reposted,
  (SELECT COUNT(*) FROM platform_maxhub_feed_reposts repost WHERE repost.post_id = post.id) AS repost_count,
  latest_repost.created_at AS reposted_at, reposter.id AS reposter_id, reposter.name AS reposter_name,
  reposter_employment.admission_date AS reposter_admission_date,
  reposter_profile.photo_mime IS NOT NULL AS reposter_has_avatar, ${ACTIVITY_DATE} AS activity_at
  FROM platform_maxhub_feed post INNER JOIN platform_users author ON author.id = post.author_id
  LEFT JOIN platform_user_employment employment ON employment.user_id = author.id
  LEFT JOIN platform_maxhub_profiles profile ON profile.user_id = author.id
  LEFT JOIN platform_maxhub_feed_reposts latest_repost ON latest_repost.post_id = post.id
    AND latest_repost.user_id = (SELECT recent.user_id FROM platform_maxhub_feed_reposts recent
      WHERE recent.post_id = post.id ORDER BY recent.created_at DESC, recent.user_id DESC LIMIT 1)
  LEFT JOIN platform_users reposter ON reposter.id = latest_repost.user_id
  LEFT JOIN platform_user_employment reposter_employment ON reposter_employment.user_id = reposter.id
  LEFT JOIN platform_maxhub_profiles reposter_profile ON reposter_profile.user_id = reposter.id`;

function postView(row, mentions, firstComment, viewer) {
  return {
    id: row.id, kind: row.kind, text: row.body,
    author: { id: row.author_id, name: row.author_name, hasAvatar: Number(row.has_avatar) === 1,
      tenureYears: completedTenureYears(row.author_admission_date) },
    audience: { type: row.audience_type, ...(row.audience_sector ? { sector: row.audience_sector } : {}) },
    mentions, createdAt: dateLabel(row.created_at), hasImage: Number(row.has_image) === 1,
    likeCount: Number(row.like_count), liked: Number(row.liked) === 1, commentCount: Number(row.comment_count), firstComment,
    saved: Number(row.saved) === 1, reposted: Number(row.reposted) === 1, repostCount: Number(row.repost_count),
    repostedBy: row.reposter_id ? { id: row.reposter_id, name: row.reposter_name, hasAvatar: Number(row.reposter_has_avatar) === 1,
      tenureYears: completedTenureYears(row.reposter_admission_date) } : null,
    repostedAt: row.reposted_at ? dateLabel(row.reposted_at) : null,
    canDelete: row.author_id === viewer._id || viewer.role === 'admin',
  };
}

async function includedMentions(connection, viewer, ids) {
  if (!ids.length) return new Map();
  const scope = accessScope(viewer);
  const [rows] = await connection.execute(`SELECT mention.post_id, person.id, person.name, employment.admission_date
    FROM platform_maxhub_feed_mentions mention INNER JOIN platform_maxhub_feed post ON post.id = mention.post_id
    INNER JOIN platform_users person ON person.id = mention.user_id
    LEFT JOIN platform_user_employment employment ON employment.user_id = person.id
    WHERE post.id IN (${placeholders(ids.length)}) AND ${scope.where} ORDER BY mention.post_id, mention.ordinal`,
  [...ids, ...scope.values]);
  const mentions = new Map();
  for (const row of rows) {
    if (!mentions.has(row.post_id)) mentions.set(row.post_id, []);
    mentions.get(row.post_id).push({ id: row.id, name: row.name, tenureYears: completedTenureYears(row.admission_date) });
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
  const [[row]] = await connection.execute(`${POST_SELECT} WHERE post.id = ? AND post.author_id = ?`,
    [viewer._id, viewer._id, viewer._id, id, viewer._id]);
  if (!row) return null;
  const mentions = await includedMentions(connection, viewer, [id]);
  const first = await firstComments(connection, viewer, [id]);
  return postView(row, mentions.get(id) || [], first.get(id) ?? null, viewer);
}

const COMMENT_SELECT = `SELECT comment.id, comment.post_id, comment.body, comment.author_id, comment.created_at,
  author.name AS author_name, employment.admission_date AS author_admission_date,
  profile.photo_mime IS NOT NULL AS has_avatar, parent_link.parent_id,
  (SELECT COUNT(*) FROM platform_maxhub_feed_comment_replies reply WHERE reply.parent_id = comment.id) AS reply_count,
  (SELECT COUNT(*) FROM platform_maxhub_feed_comment_likes reaction WHERE reaction.comment_id = comment.id) AS like_count,
  EXISTS (SELECT 1 FROM platform_maxhub_feed_comment_likes my_like WHERE my_like.comment_id = comment.id AND my_like.user_id = ?) AS liked,
  EXISTS (SELECT 1 FROM platform_maxhub_feed_comment_saves my_save WHERE my_save.comment_id = comment.id AND my_save.user_id = ?) AS saved`;
const COMMENT_JOINS = `LEFT JOIN platform_users author ON author.id = comment.author_id
  LEFT JOIN platform_user_employment employment ON employment.user_id = author.id
  LEFT JOIN platform_maxhub_profiles profile ON profile.user_id = author.id
  LEFT JOIN platform_maxhub_feed_comment_replies parent_link ON parent_link.comment_id = comment.id`;

function commentView(row) {
  return {
    id: row.id, parentId: row.parent_id ?? null, text: row.body, createdAt: dateLabel(row.created_at),
    author: { id: row.author_id, name: row.author_name, hasAvatar: Number(row.has_avatar) === 1,
      tenureYears: completedTenureYears(row.author_admission_date) },
    likeCount: Number(row.like_count), liked: Number(row.liked) === 1,
    saved: Number(row.saved) === 1, replyCount: Number(row.reply_count),
  };
}

async function firstComments(connection, viewer, ids) {
  if (!ids.length) return new Map();
  const scope = accessScope(viewer);
  const [rows] = await connection.execute(`${COMMENT_SELECT}
    FROM platform_maxhub_feed post INNER JOIN platform_maxhub_feed_comments comment ON comment.id = (
      SELECT candidate.id FROM platform_maxhub_feed_comments candidate
      LEFT JOIN platform_maxhub_feed_comment_replies candidate_parent ON candidate_parent.comment_id = candidate.id
      WHERE candidate.post_id = post.id AND candidate_parent.comment_id IS NULL
      ORDER BY candidate.created_at, candidate.id LIMIT 1
    ) ${COMMENT_JOINS} WHERE post.id IN (${placeholders(ids.length)}) AND ${scope.where}`,
  [viewer._id, viewer._id, ...ids, ...scope.values]);
  return new Map(rows.map(row => [row.post_id, commentView(row)]));
}

async function commentsFor(connection, viewer, id, savedOnly = false) {
  const scope = accessScope(viewer);
  const savedJoin = savedOnly ? `INNER JOIN platform_maxhub_feed_comment_saves bookmark
    ON bookmark.comment_id = comment.id AND bookmark.user_id = ?` : '';
  const [rows] = await connection.execute(`${COMMENT_SELECT}
    FROM platform_maxhub_feed_comments comment INNER JOIN platform_maxhub_feed post ON post.id = comment.post_id
    ${savedJoin} ${COMMENT_JOINS} WHERE post.id = ? AND ${scope.where} ORDER BY comment.created_at, comment.id`,
  [viewer._id, viewer._id, ...(savedOnly ? [viewer._id] : []), id, ...scope.values]);
  const comments = rows.map(commentView);
  if (!savedOnly) return { comments, commentCount: comments.length,
    firstComment: comments.find(comment => comment.parentId === null) ?? null };
  const first = await firstComments(connection, viewer, [id]);
  const [[{ total }]] = await connection.execute(`SELECT COUNT(*) AS total FROM platform_maxhub_feed_comments comment
    INNER JOIN platform_maxhub_feed post ON post.id = comment.post_id WHERE post.id = ? AND ${scope.where}`,
  [id, ...scope.values]);
  return { comments, commentCount: Number(total), firstComment: first.get(id) ?? null };
}

async function visibleComment(connection, id, commentId) {
  const [[comment]] = await connection.execute(`SELECT comment.id, reply.parent_id FROM platform_maxhub_feed_comments comment
    LEFT JOIN platform_maxhub_feed_comment_replies reply ON reply.comment_id = comment.id
    WHERE comment.post_id = ? AND comment.id = ? FOR UPDATE`, [id, commentId]);
  if (!comment) throw commentNotFound();
  return comment;
}

async function setBookmark(connection, table, column, itemId, userId, saved) {
  if (saved) {
    await connection.execute(`INSERT INTO ${table} (${column}, user_id)
      VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`, [itemId, userId]);
  } else await connection.execute(`DELETE FROM ${table} WHERE ${column} = ? AND user_id = ?`, [itemId, userId]);
  return { saved };
}

export class MaxHubFeedStore {
  constructor(platformStore) { this.platformStore = platformStore; }

  async initialize() {
    for (const sql of TABLES) await this.platformStore.pool.query(sql);
  }

  async list(viewer, { kind, cursor, saved, savedComments } = {}) {
    const connection = this.platformStore.pool;
    const scope = accessScope(viewer);
    const where = [scope.where];
    const values = [viewer._id, viewer._id, viewer._id, ...scope.values];
    if (kind) { where.push('post.kind = ?'); values.push(kind); }
    if (saved) {
      where.push('EXISTS (SELECT 1 FROM platform_maxhub_feed_saves bookmark WHERE bookmark.post_id = post.id AND bookmark.user_id = ?)');
      values.push(viewer._id);
    }
    if (savedComments) {
      where.push(`EXISTS (SELECT 1 FROM platform_maxhub_feed_comment_saves bookmark
        INNER JOIN platform_maxhub_feed_comments comment ON comment.id = bookmark.comment_id
        WHERE bookmark.user_id = ? AND comment.post_id = post.id)`);
      values.push(viewer._id);
    }
    if (cursor) {
      where.push(`(${ACTIVITY_DATE} < ? OR (${ACTIVITY_DATE} = ? AND post.id < ?))`);
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const [rows] = await connection.execute(`${POST_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY activity_at DESC, post.id DESC LIMIT ${PAGE_SIZE + 1}`, values);
    const more = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE);
    const ids = page.map(post => post.id);
    const [mentions, first] = await Promise.all([includedMentions(connection, viewer, ids), firstComments(connection, viewer, ids)]);
    const posts = page.map(row => postView(row, mentions.get(row.id) || [], first.get(row.id) ?? null, viewer));
    const last = page.at(-1);
    return { posts, nextCursor: more ? Buffer.from(`${dateLabel(last.activity_at)}/${last.id}`).toString('base64url') : null };
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

  async getComments(viewer, id, { saved } = {}) {
    const connection = this.platformStore.pool;
    await visiblePost(connection, viewer, id);
    return commentsFor(connection, viewer, id, saved);
  }

  async addComment(viewer, id, text, parentId) {
    return this.platformStore.transaction(async connection => {
      await visiblePost(connection, viewer, id, true);
      if (parentId) {
        const parent = await visibleComment(connection, id, parentId);
        if (parent.parent_id) throw new ApiError(400, 'MAXHUB_COMMENT_REPLY_DEPTH', 'Responda ao comentário que iniciou a conversa.');
      }
      const commentId = randomUUID();
      await connection.execute(`INSERT INTO platform_maxhub_feed_comments
        (id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`, [commentId, id, viewer._id, text, new Date()]);
      if (parentId) await connection.execute('INSERT INTO platform_maxhub_feed_comment_replies (comment_id, parent_id) VALUES (?, ?)',
        [commentId, parentId]);
      return commentsFor(connection, viewer, id);
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

  async setRepost(viewer, id, reposted) {
    return this.platformStore.transaction(async connection => {
      await visiblePost(connection, viewer, id, true);
      if (reposted) {
        await connection.execute(`INSERT INTO platform_maxhub_feed_reposts (post_id, user_id, created_at)
          VALUES (?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`, [id, viewer._id]);
      } else await connection.execute('DELETE FROM platform_maxhub_feed_reposts WHERE post_id = ? AND user_id = ?', [id, viewer._id]);
      const [[{ total }]] = await connection.execute('SELECT COUNT(*) AS total FROM platform_maxhub_feed_reposts WHERE post_id = ?', [id]);
      return { reposted, repostCount: Number(total) };
    });
  }

  async setSaved(viewer, id, saved) {
    return this.platformStore.transaction(async connection => {
      await visiblePost(connection, viewer, id, true);
      return setBookmark(connection, 'platform_maxhub_feed_saves', 'post_id', id, viewer._id, saved);
    });
  }

  async setCommentLike(viewer, id, commentId, liked) {
    return this.platformStore.transaction(async connection => {
      await visiblePost(connection, viewer, id, true);
      await visibleComment(connection, id, commentId);
      const values = [commentId, viewer._id];
      if (liked) {
        await connection.execute(`INSERT INTO platform_maxhub_feed_comment_likes (comment_id, user_id)
          VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`, values);
      } else await connection.execute('DELETE FROM platform_maxhub_feed_comment_likes WHERE comment_id = ? AND user_id = ?', values);
      const [[{ total }]] = await connection.execute('SELECT COUNT(*) AS total FROM platform_maxhub_feed_comment_likes WHERE comment_id = ?', [commentId]);
      return { liked, likeCount: Number(total) };
    });
  }

  async setCommentSaved(viewer, id, commentId, saved) {
    return this.platformStore.transaction(async connection => {
      await visiblePost(connection, viewer, id, true);
      await visibleComment(connection, id, commentId);
      return setBookmark(connection, 'platform_maxhub_feed_comment_saves', 'comment_id', commentId, viewer._id, saved);
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
