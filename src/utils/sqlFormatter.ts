import * as vscode from 'vscode';

export class SqlFormatter {
  private static readonly KEYWORDS = [
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
    'NULLS', 'FIRST', 'LAST',
    'WITH', 'RECURSIVE', 'CTE',
    'PARTITION', 'OVER',
    'RETURNING', 'RETURN',
    'CASCADE', 'RESTRICT',
    'TEMPORARY', 'TEMP', 'IF', 'EXISTS'
  ];

  private static readonly MAJOR_KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
    'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
    'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'JOIN',
    'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT',
    'LIMIT', 'OFFSET',
    'ON', 'AND', 'OR',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'BEGIN', 'COMMIT', 'ROLLBACK'
  ];

  private static readonly INDENT_KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY',
    'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN',
    'ON', 'AND', 'OR',
    'SET', 'VALUES',
    'WHEN', 'THEN', 'ELSE'
  ];

  private static readonly NEWLINE_KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY',
    'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'JOIN',
    'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT',
    'LIMIT', 'OFFSET',
    'ON', 'AND', 'OR',
    'SET', 'VALUES',
    'WHEN', 'THEN', 'ELSE', 'END'
  ];

  static format(sql: string, options?: FormatOptions): string {
    const opts: FormatOptions = {
      indent: options?.indent ?? '  ',
      uppercase: options?.uppercase ?? true,
      linesBetweenQueries: options?.linesBetweenQueries ?? 1,
      maxColumnLength: options?.maxColumnLength ?? 80,
      breakKeywords: options?.breakKeywords ?? true
    };

    sql = this.removeComments(sql);
    sql = this.normalizeWhitespace(sql);
    
    const queries = this.splitQueries(sql);
    
    const formattedQueries = queries.map(q => this.formatQuery(q, opts));
    
    const separator = '\n'.repeat((opts.linesBetweenQueries ?? 1) + 1);
    return formattedQueries.join(separator);
  }

  private static removeComments(sql: string): string {
    sql = sql.replace(/\/\*[\s\S]*?\*\//g, '');
    sql = sql.replace(/--.*$/gm, '');
    return sql;
  }

  private static normalizeWhitespace(sql: string): string {
    return sql
      .replace(/\s+/g, ' ')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .trim();
  }

  private static splitQueries(sql: string): string[] {
    const queries: string[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    
    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      const nextChar = sql[i + 1];
      
      if (!inString && (char === "'" || char === '"')) {
        inString = true;
        stringChar = char;
        current += char;
      } else if (inString && char === stringChar) {
        if (nextChar === stringChar) {
          current += char + nextChar;
          i++;
        } else {
          inString = false;
          current += char;
        }
      } else if (!inString && char === ';') {
        if (current.trim()) {
          queries.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      queries.push(current.trim());
    }
    
    return queries;
  }

  private static formatQuery(sql: string, opts: FormatOptions): string {
    if (opts.uppercase) {
      sql = this.uppercaseKeywords(sql);
    }
    
    const tokens = this.tokenize(sql);
    
    let result = '';
    let indentLevel = 0;
    let inSelect = false;
    let selectColumns: string[] = [];
    let currentLine = '';
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const upperToken = token.toUpperCase();
      const prevToken = i > 0 ? tokens[i - 1].toUpperCase() : '';
      const nextToken = i < tokens.length - 1 ? tokens[i + 1].toUpperCase() : '';
      
      if (upperToken === 'SELECT') {
        inSelect = true;
        selectColumns = [];
        result += token + '\n';
        indentLevel = 1;
        currentLine = (opts.indent ?? '  ').repeat(indentLevel);
        continue;
      }
      
      if (upperToken === 'FROM' && inSelect) {
        inSelect = false;
        if (currentLine.trim()) {
          result += currentLine.trim() + '\n';
        }
        indentLevel = 0;
        result += token + '\n';
        currentLine = '';
        continue;
      }
      
      if (this.NEWLINE_KEYWORDS.includes(upperToken) && 
          upperToken !== 'SELECT' && 
          upperToken !== 'FROM' &&
          upperToken !== 'AND' &&
          upperToken !== 'OR') {
        if (currentLine.trim()) {
          result += currentLine.trim() + '\n';
        }
        result += token + '\n';
        currentLine = '';
        continue;
      }
      
      if (upperToken === 'AND' || upperToken === 'OR') {
        if (currentLine.trim()) {
          result += currentLine.trim() + '\n';
        }
        currentLine = opts.indent + token + ' ';
        continue;
      }
      
      if (upperToken === 'ON') {
        if (currentLine.trim()) {
          result += currentLine.trim() + '\n';
        }
        currentLine = opts.indent + token + ' ';
        continue;
      }
      
      if (inSelect && token === ',') {
        currentLine += token + '\n';
        result += currentLine;
        currentLine = (opts.indent ?? '  ').repeat(indentLevel);
        continue;
      }
      
      currentLine += token + ' ';
    }
    
    if (currentLine.trim()) {
      result += currentLine.trim();
    }
    
    return result.trim();
  }

  private static tokenize(sql: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    
    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      
      if (!inString && (char === "'" || char === '"')) {
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
        inString = true;
        stringChar = char;
        current = char;
      } else if (inString && char === stringChar) {
        current += char;
        if (sql[i + 1] === stringChar) {
          current += sql[i + 1];
          i++;
        } else {
          inString = false;
          tokens.push(current);
          current = '';
        }
      } else if (!inString && (char === '(' || char === ')' || char === ',' || char === ';')) {
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
        tokens.push(char);
      } else if (!inString && /\s/.test(char)) {
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      tokens.push(current.trim());
    }
    
    return tokens;
  }

  private static uppercaseKeywords(sql: string): string {
    let result = '';
    let current = '';
    let inString = false;
    let stringChar = '';
    
    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      
      if (!inString && (char === "'" || char === '"')) {
        if (current.trim()) {
          const upper = current.toUpperCase();
          if (this.KEYWORDS.includes(upper) || this.MAJOR_KEYWORDS.includes(upper)) {
            result += upper;
          } else {
            result += current;
          }
          current = '';
        }
        inString = true;
        stringChar = char;
        result += char;
      } else if (inString && char === stringChar) {
        result += char;
        if (sql[i + 1] === stringChar) {
          result += sql[i + 1];
          i++;
        } else {
          inString = false;
        }
      } else if (!inString && (char === '(' || char === ')' || char === ',' || char === ';')) {
        if (current.trim()) {
          const upper = current.toUpperCase();
          if (this.KEYWORDS.includes(upper) || this.MAJOR_KEYWORDS.includes(upper)) {
            result += upper;
          } else {
            result += current;
          }
          current = '';
        }
        result += char;
      } else if (!inString && /\s/.test(char)) {
        if (current.trim()) {
          const upper = current.toUpperCase();
          if (this.KEYWORDS.includes(upper) || this.MAJOR_KEYWORDS.includes(upper)) {
            result += upper;
          } else {
            result += current;
          }
          current = '';
        }
        result += char;
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      const upper = current.toUpperCase();
      if (this.KEYWORDS.includes(upper) || this.MAJOR_KEYWORDS.includes(upper)) {
        result += upper;
      } else {
        result += current;
      }
    }
    
    return result;
  }

  static minify(sql: string): string {
    sql = this.removeComments(sql);
    sql = sql.replace(/\s+/g, ' ');
    return sql.trim();
  }
}

interface FormatOptions {
  indent?: string;
  uppercase?: boolean;
  linesBetweenQueries?: number;
  maxColumnLength?: number;
  breakKeywords?: boolean;
}

export class SqlFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    const text = document.getText();
    const indent = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
    
    const formatted = SqlFormatter.format(text, {
      indent,
      uppercase: true,
      linesBetweenQueries: 1
    });
    
    return [
      vscode.TextEdit.replace(
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(text.length)
        ),
        formatted
      )
    ];
  }
}

export class SqlRangeFormattingEditProvider implements vscode.DocumentRangeFormattingEditProvider {
  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    const text = document.getText(range);
    const indent = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
    
    const formatted = SqlFormatter.format(text, {
      indent,
      uppercase: true,
      linesBetweenQueries: 0
    });
    
    return [
      vscode.TextEdit.replace(range, formatted)
    ];
  }
}
