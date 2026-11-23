// A instalação cria somente as tabelas do transporte fiscal. As tabelas de
// usuários e permissões pertencem ao adapter da plataforma.
export const TRANSPORT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    company_cnpj CHAR(14) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source VARCHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    document_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    first_nsu BIGINT UNSIGNED NOT NULL,
    last_nsu BIGINT UNSIGNED NOT NULL,
    number VARCHAR(40) NULL,
    issued_at DATETIME(3) NULL,
    competence CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NULL,
    provider_cnpj VARCHAR(14) CHARACTER SET ascii COLLATE ascii_bin NULL,
    recipient_cnpj VARCHAR(14) CHARACTER SET ascii COLLATE ascii_bin NULL,
    amount_cents BIGINT UNSIGNED NULL,
    status VARCHAR(32) NULL,
    municipality_code CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NULL,
    event_type VARCHAR(40) NULL,
    metadata_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    received_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_document_company_source_key (company_cnpj, source, document_key),
    KEY idx_documents_company_source_issued (company_cnpj, source, issued_at),
    KEY idx_documents_company_competence (company_cnpj, source, competence),
    KEY idx_documents_company_updated (company_cnpj, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS document_events (
    id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    document_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    company_cnpj CHAR(14) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source VARCHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    nsu BIGINT UNSIGNED NOT NULL,
    number VARCHAR(40) NULL,
    issued_at DATETIME(3) NULL,
    competence CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NULL,
    amount_cents BIGINT UNSIGNED NULL,
    status VARCHAR(32) NULL,
    event_type VARCHAR(40) NULL,
    metadata_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    received_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_document_event_nsu (company_cnpj, source, nsu),
    KEY idx_document_events_document_nsu (document_id, nsu)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS checkpoints (
    company_cnpj CHAR(14) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source VARCHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    last_nsu BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (company_cnpj, source)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS batches (
    id VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    agent_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    company_cnpj CHAR(14) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source VARCHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    first_nsu BIGINT UNSIGNED NOT NULL,
    last_nsu BIGINT UNSIGNED NOT NULL,
    digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    document_count SMALLINT UNSIGNED NOT NULL,
    received_at DATETIME(3) NOT NULL,
    KEY idx_batches_company_source_received (company_cnpj, source, received_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS agents_health (
    agent_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    hostname VARCHAR(100) NOT NULL,
    version VARCHAR(30) NOT NULL,
    queued_batches INT UNSIGNED NOT NULL,
    server_time DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];
