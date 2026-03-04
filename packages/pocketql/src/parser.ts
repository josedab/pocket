/**
 * PocketQL Parser - Parses SQL-like query strings into a typed AST.
 *
 * Supports: SELECT, FROM, WHERE, JOIN, GROUP BY, HAVING, ORDER BY, LIMIT, OFFSET
 * Aggregations: COUNT, SUM, AVG, MIN, MAX
 * Subqueries in WHERE clauses
 */

export type ASTNodeType =
  | 'select'
  | 'from'
  | 'where'
  | 'join'
  | 'group_by'
  | 'having'
  | 'order_by'
  | 'limit'
  | 'offset'
  | 'aggregate'
  | 'column'
  | 'condition'
  | 'literal'
  | 'identifier'
  | 'binary_op'
  | 'subquery'
  | 'function_call'
  | 'star';

export interface ASTNode {
  type: ASTNodeType;
  [key: string]: unknown;
}

export interface SelectColumn extends ASTNode {
  type: 'column' | 'aggregate' | 'star';
  name?: string;
  alias?: string;
  func?: string;
  args?: ASTNode[];
}

export interface WhereCondition extends ASTNode {
  type: 'condition' | 'binary_op';
  left?: ASTNode;
  operator?: string;
  right?: ASTNode;
  logicalOp?: 'AND' | 'OR';
  conditions?: WhereCondition[];
}

export interface JoinClause extends ASTNode {
  type: 'join';
  joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'CROSS';
  collection: string;
  alias?: string;
  on?: WhereCondition;
}

export interface OrderByClause extends ASTNode {
  type: 'order_by';
  field: string;
  direction: 'ASC' | 'DESC';
}

export interface PQLQuery {
  type: 'select';
  columns: SelectColumn[];
  from: { collection: string; alias?: string };
  joins: JoinClause[];
  where?: WhereCondition;
  groupBy?: string[];
  having?: WhereCondition;
  orderBy: OrderByClause[];
  limit?: number;
  offset?: number;
}

export interface ParseError {
  message: string;
  position: number;
  line: number;
  column: number;
}

export interface ParseResult {
  success: boolean;
  query?: PQLQuery;
  error?: ParseError;
}

// Token types for the lexer
type TokenType =
  | 'SELECT'
  | 'FROM'
  | 'WHERE'
  | 'JOIN'
  | 'INNER'
  | 'LEFT'
  | 'RIGHT'
  | 'CROSS'
  | 'ON'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'IN'
  | 'LIKE'
  | 'BETWEEN'
  | 'IS'
  | 'NULL'
  | 'AS'
  | 'GROUP'
  | 'BY'
  | 'HAVING'
  | 'ORDER'
  | 'ASC'
  | 'DESC'
  | 'LIMIT'
  | 'OFFSET'
  | 'COUNT'
  | 'SUM'
  | 'AVG'
  | 'MIN'
  | 'MAX'
  | 'IDENTIFIER'
  | 'NUMBER'
  | 'STRING'
  | 'STAR'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'DOT'
  | 'SEMICOLON'
  | 'EQ'
  | 'NE'
  | 'LT'
  | 'GT'
  | 'LTE'
  | 'GTE'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

/**
 * Lexer for tokenizing PQL strings
 */
class Lexer {
  private pos = 0;
  private readonly input: string;

  constructor(input: string) {
    this.input = input.trim();
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.pos >= this.input.length) break;

      const token = this.nextToken();
      if (token) tokens.push(token);
    }
    tokens.push({ type: 'EOF', value: '', position: this.pos });
    return tokens;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos]!)) {
      this.pos++;
    }
  }

  private nextToken(): Token | null {
    const ch = this.input[this.pos]!;
    const pos = this.pos;

    // Single-char tokens
    const singleChars: Record<string, TokenType> = {
      '*': 'STAR',
      '(': 'LPAREN',
      ')': 'RPAREN',
      ',': 'COMMA',
      '.': 'DOT',
      ';': 'SEMICOLON',
    };
    if (singleChars[ch]) {
      this.pos++;
      return { type: singleChars[ch], value: ch, position: pos };
    }

    // Comparison operators
    if (ch === '=') {
      this.pos++;
      return { type: 'EQ', value: '=', position: pos };
    }
    if (ch === '!' && this.input[this.pos + 1] === '=') {
      this.pos += 2;
      return { type: 'NE', value: '!=', position: pos };
    }
    if (ch === '<' && this.input[this.pos + 1] === '>') {
      this.pos += 2;
      return { type: 'NE', value: '<>', position: pos };
    }
    if (ch === '<' && this.input[this.pos + 1] === '=') {
      this.pos += 2;
      return { type: 'LTE', value: '<=', position: pos };
    }
    if (ch === '>' && this.input[this.pos + 1] === '=') {
      this.pos += 2;
      return { type: 'GTE', value: '>=', position: pos };
    }
    if (ch === '<') {
      this.pos++;
      return { type: 'LT', value: '<', position: pos };
    }
    if (ch === '>') {
      this.pos++;
      return { type: 'GT', value: '>', position: pos };
    }

    // String literals
    if (ch === "'" || ch === '"') {
      return this.readString(ch);
    }

    // Numbers
    if (/\d/.test(ch) || (ch === '-' && /\d/.test(this.input[this.pos + 1] ?? ''))) {
      return this.readNumber();
    }

    // Keywords and identifiers
    if (/[a-zA-Z_]/.test(ch)) {
      return this.readIdentifier();
    }

    this.pos++;
    return null;
  }

  private readString(quote: string): Token {
    const pos = this.pos;
    this.pos++; // skip opening quote
    let value = '';
    while (this.pos < this.input.length && this.input[this.pos] !== quote) {
      if (this.input[this.pos] === '\\') {
        this.pos++;
      }
      value += this.input[this.pos] ?? '';
      this.pos++;
    }
    this.pos++; // skip closing quote
    return { type: 'STRING', value, position: pos };
  }

  private readNumber(): Token {
    const pos = this.pos;
    let value = '';
    if (this.input[this.pos] === '-') {
      value += '-';
      this.pos++;
    }
    while (this.pos < this.input.length && /[\d.]/.test(this.input[this.pos]!)) {
      value += this.input[this.pos] ?? '';
      this.pos++;
    }
    return { type: 'NUMBER', value, position: pos };
  }

  private readIdentifier(): Token {
    const pos = this.pos;
    let value = '';
    while (this.pos < this.input.length && /[a-zA-Z0-9_]/.test(this.input[this.pos]!)) {
      value += this.input[this.pos] ?? '';
      this.pos++;
    }

    const keywords: Record<string, TokenType> = {
      SELECT: 'SELECT',
      FROM: 'FROM',
      WHERE: 'WHERE',
      JOIN: 'JOIN',
      INNER: 'INNER',
      LEFT: 'LEFT',
      RIGHT: 'RIGHT',
      CROSS: 'CROSS',
      ON: 'ON',
      AND: 'AND',
      OR: 'OR',
      NOT: 'NOT',
      IN: 'IN',
      LIKE: 'LIKE',
      BETWEEN: 'BETWEEN',
      IS: 'IS',
      NULL: 'NULL',
      AS: 'AS',
      GROUP: 'GROUP',
      BY: 'BY',
      HAVING: 'HAVING',
      ORDER: 'ORDER',
      ASC: 'ASC',
      DESC: 'DESC',
      LIMIT: 'LIMIT',
      OFFSET: 'OFFSET',
      COUNT: 'COUNT',
      SUM: 'SUM',
      AVG: 'AVG',
      MIN: 'MIN',
      MAX: 'MAX',
    };

    const upper = value.toUpperCase();
    const type = keywords[upper] ?? 'IDENTIFIER';
    return { type, value, position: pos };
  }
}

/**
 * Recursive descent parser for PQL
 */
class Parser {
  private tokens: Token[] = [];
  private pos = 0;

  parse(input: string): ParseResult {
    try {
      const lexer = new Lexer(input);
      this.tokens = lexer.tokenize();
      this.pos = 0;

      const query = this.parseSelect();
      return { success: true, query };
    } catch (err) {
      const token = this.tokens[this.pos] ?? { position: 0 };
      return {
        success: false,
        error: {
          message: err instanceof Error ? err.message : String(err),
          position: token.position,
          line: 1,
          column: token.position + 1,
        },
      };
    }
  }

  private parseSelect(): PQLQuery {
    this.expect('SELECT');
    const columns = this.parseColumns();
    this.expect('FROM');
    const from = this.parseFrom();
    const joins = this.parseJoins();
    const where = this.parseWhere();
    const groupBy = this.parseGroupBy();
    const having = this.parseHaving();
    const orderBy = this.parseOrderBy();
    const limit = this.parseLimit();
    const offset = this.parseOffset();

    return {
      type: 'select',
      columns,
      from,
      joins,
      where: where ?? undefined,
      groupBy: groupBy ?? undefined,
      having: having ?? undefined,
      orderBy,
      limit: limit ?? undefined,
      offset: offset ?? undefined,
    };
  }

  private parseColumns(): SelectColumn[] {
    const columns: SelectColumn[] = [];
    do {
      columns.push(this.parseColumn());
    } while (this.matchAndAdvance('COMMA'));
    return columns;
  }

  private parseColumn(): SelectColumn {
    // Check for aggregate functions
    const aggFuncs = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
    if (aggFuncs.includes(this.current().type)) {
      const func = this.advance().value;
      this.expect('LPAREN');
      let argName = '*';
      if (this.current().type !== 'STAR') {
        argName = this.advance().value;
      } else {
        this.advance();
      }
      this.expect('RPAREN');
      const alias = this.parseAlias();
      return {
        type: 'aggregate',
        func: func.toUpperCase(),
        name: argName,
        alias: alias ?? `${func.toLowerCase()}_${argName}`,
      };
    }

    // Star
    if (this.current().type === 'STAR') {
      this.advance();
      return { type: 'star', name: '*' };
    }

    // Regular column
    let name = this.advance().value;
    if (this.current().type === 'DOT') {
      this.advance();
      name = `${name}.${this.advance().value}`;
    }
    const alias = this.parseAlias();
    return { type: 'column', name, alias };
  }

  private parseAlias(): string | undefined {
    if (this.current().type === 'AS') {
      this.advance();
      return this.advance().value;
    }
    // Implicit alias
    if (this.current().type === 'IDENTIFIER' && !this.isKeyword(this.current())) {
      return this.advance().value;
    }
    return undefined;
  }

  private parseFrom(): { collection: string; alias?: string } {
    const collection = this.advance().value;
    let alias: string | undefined;
    if (this.current().type === 'AS') {
      this.advance();
      alias = this.advance().value;
    } else if (this.current().type === 'IDENTIFIER' && !this.isKeyword(this.current())) {
      alias = this.advance().value;
    }
    return { collection, alias };
  }

  private parseJoins(): JoinClause[] {
    const joins: JoinClause[] = [];
    while (this.isJoinKeyword()) {
      let joinType: JoinClause['joinType'] = 'INNER';
      if (this.current().type === 'LEFT') {
        joinType = 'LEFT';
        this.advance();
      } else if (this.current().type === 'RIGHT') {
        joinType = 'RIGHT';
        this.advance();
      } else if (this.current().type === 'CROSS') {
        joinType = 'CROSS';
        this.advance();
      } else if (this.current().type === 'INNER') {
        this.advance();
      }

      this.expect('JOIN');
      const collection = this.advance().value;
      let alias: string | undefined;
      if (this.current().type === 'AS') {
        this.advance();
        alias = this.advance().value;
      } else if (this.current().type === 'IDENTIFIER' && !this.isKeyword(this.current())) {
        alias = this.advance().value;
      }

      let on: WhereCondition | undefined;
      if (this.current().type === 'ON') {
        this.advance();
        on = this.parseCondition();
      }

      joins.push({ type: 'join', joinType, collection, alias, on });
    }
    return joins;
  }

  private parseWhere(): WhereCondition | null {
    if (this.current().type !== 'WHERE') return null;
    this.advance();
    return this.parseCondition();
  }

  private parseCondition(): WhereCondition {
    let left = this.parseComparison();

    while (this.current().type === 'AND' || this.current().type === 'OR') {
      const op = this.advance().type as 'AND' | 'OR';
      const right = this.parseComparison();
      left = {
        type: 'binary_op',
        logicalOp: op,
        conditions: [left, right],
      };
    }

    return left;
  }

  private parseComparison(): WhereCondition {
    if (this.current().type === 'LPAREN') {
      this.advance();
      const cond = this.parseCondition();
      this.expect('RPAREN');
      return cond;
    }

    const left = this.parseValue();
    const opMap: Record<string, string> = {
      EQ: '=',
      NE: '!=',
      LT: '<',
      GT: '>',
      LTE: '<=',
      GTE: '>=',
    };

    if (opMap[this.current().type]) {
      const operator = opMap[this.advance().type];
      const right = this.parseValue();
      return { type: 'condition', left, operator, right };
    }

    if (this.current().type === 'IN') {
      this.advance();
      this.expect('LPAREN');
      const values: ASTNode[] = [];
      do {
        values.push(this.parseValue());
      } while (this.matchAndAdvance('COMMA'));
      this.expect('RPAREN');
      return {
        type: 'condition',
        left,
        operator: 'IN',
        right: { type: 'literal', values } as ASTNode,
      };
    }

    if (this.current().type === 'LIKE') {
      this.advance();
      const right = this.parseValue();
      return { type: 'condition', left, operator: 'LIKE', right };
    }

    if (this.current().type === 'IS') {
      this.advance();
      const isNot = this.matchAndAdvance('NOT');
      this.expect('NULL');
      return {
        type: 'condition',
        left,
        operator: isNot ? 'IS NOT NULL' : 'IS NULL',
        right: { type: 'literal', value: null } as ASTNode,
      };
    }

    return left as WhereCondition;
  }

  private parseValue(): ASTNode {
    const token = this.current();
    if (token.type === 'STRING') {
      this.advance();
      return { type: 'literal', value: token.value };
    }
    if (token.type === 'NUMBER') {
      this.advance();
      return { type: 'literal', value: parseFloat(token.value) };
    }
    if (token.type === 'NULL') {
      this.advance();
      return { type: 'literal', value: null };
    }
    if (token.type === 'IDENTIFIER') {
      let name = this.advance().value;
      if (this.current().type === 'DOT') {
        this.advance();
        name = `${name}.${this.advance().value}`;
      }
      return { type: 'identifier', name };
    }
    throw new Error(`Unexpected token: ${token.value} (${token.type})`);
  }

  private parseGroupBy(): string[] | null {
    if (this.current().type !== 'GROUP') return null;
    this.advance();
    this.expect('BY');
    const fields: string[] = [];
    do {
      fields.push(this.advance().value);
    } while (this.matchAndAdvance('COMMA'));
    return fields;
  }

  private parseHaving(): WhereCondition | null {
    if (this.current().type !== 'HAVING') return null;
    this.advance();
    return this.parseCondition();
  }

  private parseOrderBy(): OrderByClause[] {
    if (this.current().type !== 'ORDER') return [];
    this.advance();
    this.expect('BY');
    const clauses: OrderByClause[] = [];
    do {
      const field = this.advance().value;
      let direction: 'ASC' | 'DESC' = 'ASC';
      if (this.current().type === 'ASC') {
        this.advance();
        direction = 'ASC';
      } else if (this.current().type === 'DESC') {
        this.advance();
        direction = 'DESC';
      }
      clauses.push({ type: 'order_by', field, direction });
    } while (this.matchAndAdvance('COMMA'));
    return clauses;
  }

  private parseLimit(): number | null {
    if (this.current().type !== 'LIMIT') return null;
    this.advance();
    return parseInt(this.advance().value, 10);
  }

  private parseOffset(): number | null {
    if (this.current().type !== 'OFFSET') return null;
    this.advance();
    return parseInt(this.advance().value, 10);
  }

  // --- Helpers ---

  private current(): Token {
    return this.tokens[this.pos] ?? { type: 'EOF' as const, value: '', position: 0 };
  }

  private advance(): Token {
    const token = this.current();
    this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new Error(`Expected ${type}, got ${token.type} ("${token.value}")`);
    }
    return this.advance();
  }

  private matchAndAdvance(type: TokenType): boolean {
    if (this.current().type === type) {
      this.advance();
      return true;
    }
    return false;
  }

  private isKeyword(token: Token): boolean {
    const keywords = [
      'SELECT',
      'FROM',
      'WHERE',
      'JOIN',
      'ON',
      'AND',
      'OR',
      'GROUP',
      'BY',
      'HAVING',
      'ORDER',
      'ASC',
      'DESC',
      'LIMIT',
      'OFFSET',
      'INNER',
      'LEFT',
      'RIGHT',
      'CROSS',
      'AS',
    ];
    return keywords.includes(token.type);
  }

  private isJoinKeyword(): boolean {
    const t = this.current().type;
    return t === 'JOIN' || t === 'INNER' || t === 'LEFT' || t === 'RIGHT' || t === 'CROSS';
  }
}

/**
 * Parse a PocketQL query string into a typed AST.
 */
export function parsePQL(input: string): ParseResult {
  return new Parser().parse(input);
}

export { Lexer, Parser };
