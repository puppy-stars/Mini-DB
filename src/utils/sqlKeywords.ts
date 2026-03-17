export const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'EXISTS',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'DATABASE', 'INDEX', 'VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER',
  'ALTER', 'DROP', 'TRUNCATE', 'RENAME',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CONSTRAINT',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'FULL', 'CROSS', 'ON',
  'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC',
  'LIMIT', 'OFFSET', 'TOP',
  'UNION', 'ALL', 'INTERSECT', 'EXCEPT',
  'DISTINCT', 'AS', 'NULL', 'IS', 'LIKE', 'BETWEEN',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'IF', 'WHILE', 'FOR', 'EACH', 'DO', 'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION',
  'GRANT', 'REVOKE', 'PRIVILEGES', 'TO',
  'DEFAULT', 'AUTO_INCREMENT', 'IDENTITY', 'SERIAL',
  'VARCHAR', 'CHAR', 'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT',
  'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL',
  'DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR',
  'TEXT', 'BLOB', 'CLOB', 'BINARY', 'VARBINARY',
  'BOOLEAN', 'BOOL', 'BIT',
  'JSON', 'JSONB', 'XML',
  'UUID', 'ARRAY', 'ENUM', 'SET',
  'NULLS', 'FIRST', 'LAST',
  'WITH', 'RECURSIVE', 'CTE',
  'PARTITION', 'OVER', 'RANK', 'DENSE_RANK', 'ROW_NUMBER', 'LEAD', 'LAG',
  'COALESCE', 'NULLIF', 'IFNULL', 'NVL',
  'CAST', 'CONVERT',
  'CONCAT', 'SUBSTRING', 'LENGTH', 'CHAR_LENGTH', 'TRIM', 'LTRIM', 'RTRIM',
  'UPPER', 'LOWER', 'REPLACE', 'REVERSE',
  'NOW', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'ROUND', 'CEIL', 'FLOOR', 'ABS', 'MOD', 'POWER', 'SQRT',
  'USE', 'DESCRIBE', 'DESC', 'EXPLAIN', 'SHOW',
  'ENGINE', 'CHARSET', 'COLLATE', 'COMMENT',
  'CASCADE', 'RESTRICT', 'NO ACTION', 'SET NULL', 'SET DEFAULT',
  'TEMPORARY', 'TEMP', 'IF EXISTS', 'IF NOT EXISTS',
  'RETURNING', 'RETURN',
  'DECLARE', 'CURSOR', 'FETCH', 'OPEN', 'CLOSE'
];

export const SQL_FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'COALESCE', 'NULLIF', 'IFNULL', 'NVL',
  'CAST', 'CONVERT',
  'CONCAT', 'CONCAT_WS', 'SUBSTRING', 'SUBSTR', 'LENGTH', 'CHAR_LENGTH', 'CHARACTER_LENGTH',
  'TRIM', 'LTRIM', 'RTRIM', 'LEFT', 'RIGHT',
  'UPPER', 'LOWER', 'UCASE', 'LCASE', 'INITCAP',
  'REPLACE', 'REVERSE', 'REPEAT', 'LPAD', 'RPAD', 'INSTR', 'LOCATE', 'POSITION',
  'NOW', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'CURDATE', 'CURTIME',
  'DATE', 'TIME', 'DATETIME', 'TIMESTAMP',
  'DATE_FORMAT', 'DATE_ADD', 'DATE_SUB', 'DATEDIFF', 'TIMESTAMPDIFF',
  'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND',
  'EXTRACT', 'TO_DATE', 'TO_CHAR', 'STR_TO_DATE',
  'ROUND', 'CEIL', 'CEILING', 'FLOOR', 'ABS', 'MOD',
  'POWER', 'POW', 'SQRT', 'EXP', 'LOG', 'LOG10', 'LN',
  'RAND', 'RANDOM', 'SIGN', 'TRUNCATE', 'PI',
  'IF', 'IIF', 'CASE', 'GREATEST', 'LEAST',
  'MD5', 'SHA1', 'SHA2', 'ENCRYPT', 'DECRYPT',
  'UUID', 'UUID_SHORT', 'NEWID',
  'GROUP_CONCAT', 'STRING_AGG', 'LISTAGG',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE',
  'LEAD', 'LAG', 'FIRST_VALUE', 'LAST_VALUE',
  'JSON_EXTRACT', 'JSON_UNQUOTE', 'JSON_OBJECT', 'JSON_ARRAY',
  'DATABASE', 'USER', 'VERSION', 'CONNECTION_ID',
  'LAST_INSERT_ID', 'SCOPE_IDENTITY', 'CURRVAL', 'NEXTVAL'
];

export const SQL_DATA_TYPES = [
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
  'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL', 'DOUBLE PRECISION',
  'BIT', 'BOOLEAN', 'BOOL',
  'CHAR', 'VARCHAR', 'CHARACTER', 'CHARACTER VARYING',
  'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB', 'BINARY', 'VARBINARY',
  'DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR',
  'JSON', 'JSONB', 'XML',
  'ENUM', 'SET', 'UUID', 'ARRAY'
];

export const SQL_OPERATORS = [
  '=', '<', '>', '<=', '>=', '<>', '!=',
  '+', '-', '*', '/', '%',
  'AND', 'OR', 'NOT', 'BETWEEN', 'LIKE', 'IN', 'IS', 'IS NOT',
  'EXISTS', 'ALL', 'ANY', 'SOME'
];

export const MYSQL_SPECIFIC = [
  'ENGINE', 'AUTO_INCREMENT', 'UNSIGNED', 'ZEROFILL',
  'CHARSET', 'CHARACTER SET', 'COLLATE',
  'ON UPDATE', 'ON DELETE',
  'SHOW DATABASES', 'SHOW TABLES', 'SHOW COLUMNS', 'SHOW INDEX',
  'SHOW CREATE TABLE', 'SHOW CREATE DATABASE',
  'DESCRIBE', 'DESC', 'EXPLAIN',
  'LIMIT', 'OFFSET',
  'REPLACE INTO', 'INSERT IGNORE', 'INSERT DELAYED',
  'LOW_PRIORITY', 'HIGH_PRIORITY', 'DELAYED',
  'STRAIGHT_JOIN', 'NATURAL JOIN',
  'SQL_CACHE', 'SQL_NO_CACHE', 'SQL_CALC_FOUND_ROWS',
  'LOCK TABLES', 'UNLOCK TABLES',
  'OPTIMIZE TABLE', 'ANALYZE TABLE', 'CHECK TABLE', 'REPAIR TABLE'
];

export const POSTGRESQL_SPECIFIC = [
  'SERIAL', 'BIGSERIAL', 'SMALLSERIAL',
  'RETURNING', 'RETURN',
  'ILIKE', 'SIMILAR TO',
  'ARRAY', 'ARRAY_AGG', 'UNNEST',
  'STRING_AGG',
  'GENERATE_SERIES',
  'CURRENT_SCHEMA', 'CURRENT_USER', 'SESSION_USER',
  'EXTRACT', 'DATE_TRUNC', 'AGE',
  'TO_DATE', 'TO_TIMESTAMP', 'TO_CHAR',
  'COPY', 'VACUUM', 'ANALYZE',
  'SEQUENCE', 'NEXTVAL', 'CURRVAL', 'SETVAL',
  'CREATE SCHEMA', 'DROP SCHEMA',
  'SHOW ALL', 'SHOW search_path',
  'LIMIT', 'OFFSET', 'FETCH FIRST', 'FETCH NEXT',
  'LATERAL', 'WITH ORDINALITY',
  'PARTITION BY', 'ORDER BY', 'RANGE', 'ROWS', 'GROUPS'
];

export function getAllKeywords(): string[] {
  return [...new Set([...SQL_KEYWORDS, ...SQL_FUNCTIONS, ...SQL_DATA_TYPES])];
}

export function getKeywordsLower(): string[] {
  return getAllKeywords().map(k => k.toLowerCase());
}

export function isKeyword(word: string): boolean {
  const upper = word.toUpperCase();
  return SQL_KEYWORDS.includes(upper) || 
         SQL_FUNCTIONS.includes(upper) || 
         SQL_DATA_TYPES.includes(upper);
}

export function isFunction(word: string): boolean {
  return SQL_FUNCTIONS.includes(word.toUpperCase());
}

export function getKeywordCompletionItems(): { label: string; kind: string; detail: string }[] {
  const items: { label: string; kind: string; detail: string }[] = [];
  
  SQL_KEYWORDS.forEach(keyword => {
    items.push({
      label: keyword,
      kind: 'Keyword',
      detail: 'SQL Keyword'
    });
  });
  
  SQL_FUNCTIONS.forEach(func => {
    items.push({
      label: func,
      kind: 'Function',
      detail: 'SQL Function'
    });
  });
  
  SQL_DATA_TYPES.forEach(type => {
    items.push({
      label: type,
      kind: 'TypeParameter',
      detail: 'SQL Data Type'
    });
  });
  
  return items;
}
