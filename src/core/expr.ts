/**
 * 白名单公式引擎。
 *
 * 只允许数字、已登记变量、四则运算、整数幂、百分号与白名单函数；
 * 不执行 eval / Function，也不允许任何属性访问、赋值或字符串。
 * 解析后同时完成量纲推断与前向自动微分，供一阶不确定度传播使用。
 */

import {
  type Dimension,
  DIM_TEMPERATURE,
  DIM_ZERO,
  dimAdd,
  dimDivide,
  dimEqual,
  dimScale,
  dimSub,
  formatDimension,
} from './units';

export class ExprError extends Error {
  readonly pos: number;
  readonly code: string;
  constructor(message: string, pos: number, code = 'syntax') {
    super(message);
    this.name = 'ExprError';
    this.pos = pos;
    this.code = code;
  }
}

export type AstNode =
  | { type: 'num'; value: number; pos: number }
  | { type: 'var'; name: string; pos: number }
  | { type: 'unary'; op: '+' | '-'; arg: AstNode; pos: number }
  | {
      type: 'binary';
      op: '+' | '-' | '*' | '/' | '^';
      left: AstNode;
      right: AstNode;
      pos: number;
    }
  | { type: 'call'; name: string; args: AstNode[]; pos: number }
  | { type: 'percent'; arg: AstNode; pos: number };

export const FUNCTIONS = [
  'sqrt',
  'cbrt',
  'abs',
  'exp',
  'ln',
  'log',
  'log10',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'min',
  'max',
] as const;

export type FunctionName = (typeof FUNCTIONS)[number];

const FUNC_SET = new Set<string>(FUNCTIONS);
const CONSTANTS = new Set(['pi', 'e']);

export const RESERVED_WORDS = new Set<string>([...FUNCTIONS, ...CONSTANTS]);

const MAX_LENGTH = 2000;
const MAX_TOKENS = 600;
const MAX_DEPTH = 48;

interface Token {
  kind: 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'percent';
  text: string;
  value?: number;
  pos: number;
}

function tokenize(input: string): Token[] {
  if (input.length > MAX_LENGTH) {
    throw new ExprError(`公式过长（上限 ${MAX_LENGTH} 字符）`, MAX_LENGTH, 'limit');
  }
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const start = i;
      let text = '';
      let digits = 0;
      while (i < input.length && /[0-9]/.test(input[i])) {
        text += input[i];
        digits += 1;
        i += 1;
      }
      if (input[i] === '.') {
        text += '.';
        i += 1;
        while (i < input.length && /[0-9]/.test(input[i])) {
          text += input[i];
          digits += 1;
          i += 1;
        }
      }
      if (digits === 0) {
        throw new ExprError('数字格式不完整', start);
      }
      if (input[i] === 'e' || input[i] === 'E') {
        const save = i;
        let exp = input[i];
        i += 1;
        if (input[i] === '+' || input[i] === '-') {
          exp += input[i];
          i += 1;
        }
        let expDigits = 0;
        while (i < input.length && /[0-9]/.test(input[i])) {
          exp += input[i];
          expDigits += 1;
          i += 1;
        }
        if (expDigits === 0) {
          i = save;
        } else {
          text += exp;
        }
      }
      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new ExprError(`数字超出可表示范围：${text}`, start);
      }
      tokens.push({ kind: 'num', text, value, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      let text = '';
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) {
        text += input[i];
        i += 1;
      }
      tokens.push({ kind: 'ident', text, pos: start });
      continue;
    }
    if (ch === '°') {
      const start = i;
      let text = '°';
      i += 1;
      if (input[i] === 'C' || input[i] === 'F') {
        text += input[i];
        i += 1;
      }
      if (text === '°') {
        throw new ExprError('不支持的字符“°”（温度单位写作 °C 或 K）', start);
      }
      tokens.push({ kind: 'ident', text, pos: start });
      continue;
    }
    if (ch === '(') tokens.push({ kind: 'lparen', text: ch, pos: i });
    else if (ch === ')') tokens.push({ kind: 'rparen', text: ch, pos: i });
    else if (ch === ',') tokens.push({ kind: 'comma', text: ch, pos: i });
    else if (ch === '%') tokens.push({ kind: 'percent', text: ch, pos: i });
    else if ('+-*/^'.includes(ch)) tokens.push({ kind: 'op', text: ch, pos: i });
    else {
      throw new ExprError(`不支持的字符“${ch}”（仅允许字母、数字与 + - * / ^ ( ) , %）`, i);
    }
    i += 1;
    if (tokens.length > MAX_TOKENS) {
      throw new ExprError(`公式项数过多（上限 ${MAX_TOKENS}）`, i, 'limit');
    }
  }
  if (tokens.length === 0) throw new ExprError('公式为空', 0, 'empty');
  return tokens;
}

class Parser {
  private tokens: Token[];
  private index = 0;
  private depth = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private next(): Token | undefined {
    const t = this.tokens[this.index];
    this.index += 1;
    return t;
  }

  private expect(kind: Token['kind'], message: string): Token {
    const t = this.peek();
    if (!t || t.kind !== kind) {
      throw new ExprError(message, t?.pos ?? this.tokens[this.tokens.length - 1].pos + 1);
    }
    return this.next() as Token;
  }

  parse(): AstNode {
    const node = this.parseExpr(0);
    const t = this.peek();
    if (t) throw new ExprError(`多余的符号“${t.text}”`, t.pos);
    return node;
  }

  private startsPrimary(t: Token | undefined): boolean {
    return Boolean(t && (t.kind === 'num' || t.kind === 'ident' || t.kind === 'lparen'));
  }

  private parseExpr(minPrec: number): AstNode {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) throw new ExprError('公式嵌套过深', this.peek()?.pos ?? 0, 'limit');
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (!t) break;
      let op: '+' | '-' | '*' | '/' | '^' | null = null;
      let prec = 0;
      let implicit = false;
      if (t.kind === 'op' && (t.text === '+' || t.text === '-')) {
        op = t.text;
        prec = 10;
      } else if (t.kind === 'op' && (t.text === '*' || t.text === '/')) {
        op = t.text;
        prec = 20;
      } else if (this.startsPrimary(t)) {
        op = '*';
        prec = 20;
        implicit = true;
      }
      if (!op || prec < minPrec) break;
      if (!implicit) this.next();
      const right = this.parseExpr(prec + 1);
      left = { type: 'binary', op, left, right, pos: t.pos };
    }
    this.depth -= 1;
    return left;
  }

  private parseUnary(): AstNode {
    const t = this.peek();
    if (t && t.kind === 'op' && (t.text === '+' || t.text === '-')) {
      this.next();
      const arg = this.parseExpr(25);
      return { type: 'unary', op: t.text, arg, pos: t.pos };
    }
    return this.parsePower();
  }

  private parsePower(): AstNode {
    let base = this.parsePostfix();
    const t = this.peek();
    if (t && t.kind === 'op' && t.text === '^') {
      this.next();
      const exponent = this.parseExpr(25);
      base = { type: 'binary', op: '^', left: base, right: exponent, pos: t.pos };
    }
    return base;
  }

  private parsePostfix(): AstNode {
    let node = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t && t.kind === 'percent') {
        this.next();
        node = { type: 'percent', arg: node, pos: t.pos };
      } else break;
    }
    return node;
  }

  private parsePrimary(): AstNode {
    const t = this.next();
    if (!t) throw new ExprError('公式意外结束', this.tokens[this.tokens.length - 1].pos + 1);
    if (t.kind === 'num') {
      // 交直流温度字面量：20 °C / 20°C 视为 20 K 的同量纲量（温差语义）
      const unitTok = this.peek();
      const after = this.tokens[this.index + 1];
      if (
        unitTok &&
        unitTok.kind === 'ident' &&
        (unitTok.text === '°C' || unitTok.text === '°F') &&
        !(after && after.kind === 'ident') &&
        !(after && after.kind === 'lparen')
      ) {
        this.next();
        const scale = unitTok.text === '°F' ? 5 / 9 : 1;
        return { type: 'num', value: (t.value ?? 0) * scale, pos: t.pos };
      }
      return { type: 'num', value: t.value ?? 0, pos: t.pos };
    }
    if (t.kind === 'lparen') {
      const node = this.parseExpr(0);
      this.expect('rparen', '缺少右括号“)”');
      return node;
    }
    if (t.kind === 'ident') {
      if (FUNC_SET.has(t.text)) {
        const open = this.peek();
        if (!open || open.kind !== 'lparen') {
          throw new ExprError(`函数 ${t.text} 后必须跟括号，例如 ${t.text}(x)`, open?.pos ?? t.pos);
        }
        this.next();
        const args: AstNode[] = [];
        if (this.peek()?.kind !== 'rparen') {
          for (;;) {
            args.push(this.parseExpr(0));
            const sep = this.peek();
            if (sep && sep.kind === 'comma') {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expect('rparen', `函数 ${t.text} 缺少右括号“)”`);
        const arity = functionArity(t.text);
        if (args.length < arity[0] || args.length > arity[1]) {
          throw new ExprError(
            `函数 ${t.text} 需要 ${arity[0] === arity[1] ? arity[0] : `${arity[0]}–${arity[1]}`} 个参数，实际 ${args.length} 个`,
            t.pos,
          );
        }
        return { type: 'call', name: t.text, args, pos: t.pos };
      }
      if (CONSTANTS.has(t.text)) {
        return { type: 'num', value: t.text === 'pi' ? Math.PI : Math.E, pos: t.pos };
      }
      if (this.peek()?.kind === 'lparen') {
        throw new ExprError(
          `未授权的函数“${t.text}”；仅允许 ${FUNCTIONS.join(', ')}`,
          t.pos,
          'unknown-function',
        );
      }
      return { type: 'var', name: t.text, pos: t.pos };
    }
    if (t.kind === 'rparen') throw new ExprError('多余的右括号“)”', t.pos);
    throw new ExprError(`此处不能出现“${t.text}”`, t.pos);
  }
}

function functionArity(name: string): [number, number] {
  if (name === 'min' || name === 'max') return [1, 8];
  return [1, 1];
}

export function parseFormula(formula: string): AstNode {
  return new Parser(tokenize(formula)).parse();
}

export function collectIdentifiers(node: AstNode, out = new Set<string>()): Set<string> {
  switch (node.type) {
    case 'var':
      out.add(node.name);
      break;
    case 'unary':
      collectIdentifiers(node.arg, out);
      break;
    case 'binary':
      collectIdentifiers(node.left, out);
      collectIdentifiers(node.right, out);
      break;
    case 'call':
      node.args.forEach((a) => collectIdentifiers(a, out));
      break;
    case 'percent':
      collectIdentifiers(node.arg, out);
      break;
    default:
      break;
  }
  return out;
}

export function astSize(node: AstNode): number {
  switch (node.type) {
    case 'unary':
    case 'percent':
      return 1 + astSize(node.arg);
    case 'binary':
      return 1 + astSize(node.left) + astSize(node.right);
    case 'call':
      return 1 + node.args.reduce((s, a) => s + astSize(a), 0);
    default:
      return 1;
  }
}

export interface EvalVar {
  value: number;
  dim: Dimension;
  grad: number[];
  label: string;
}

export interface Issue {
  code: string;
  message: string;
  pos?: number;
  severity: 'error' | 'warning';
  resultId?: string;
}

export interface DivisionPoint {
  value: number;
  pos: number;
  leftText: string;
  grad: number[];
  dim: Dimension;
}

export interface EvalContext {
  vars: Map<string, EvalVar>;
  nodeCount: number;
  issues: Issue[];
  divisions: DivisionPoint[];
  maxAbs: number;
  nearZeroRel: number;
}

export interface EvalResult {
  value: number;
  dim: Dimension;
  grad: number[];
}

const ZERO_GRAD = (n: number) => new Array<number>(n).fill(0);

function note(ctx: EvalContext, issue: Issue): void {
  ctx.issues.push(issue);
}

function numValue(node: AstNode): number | null {
  if (node.type === 'num') return node.value;
  if (node.type === 'unary' && node.op === '-') {
    const v = numValue(node.arg);
    return v === null ? null : -v;
  }
  if (node.type === 'unary' && node.op === '+') return numValue(node.arg);
  if (node.type === 'percent') {
    const v = numValue(node.arg);
    return v === null ? null : v / 100;
  }
  if (node.type === 'binary') {
    const l = numValue(node.left);
    const r = numValue(node.right);
    if (l === null || r === null) return null;
    switch (node.op) {
      case '+':
        return l + r;
      case '-':
        return l - r;
      case '*':
        return l * r;
      case '/':
        return r === 0 ? null : l / r;
      case '^':
        return Math.pow(l, r);
    }
  }
  return null;
}

function describe(node: AstNode): string {
  if (node.type === 'var') return node.name;
  if (node.type === 'num') return String(node.value);
  return '子表达式';
}

function guardFinite(value: number, pos: number, ctx: EvalContext): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1e300) {
    note(ctx, {
      code: 'overflow',
      message: '计算结果溢出（超出双精度范围），请检查数量级或改用更合适的单位',
      pos,
      severity: 'error',
    });
    return Number.NaN;
  }
  return value;
}

export function evaluateAst(node: AstNode, ctx: EvalContext): EvalResult {
  const n = ctx.nodeCount;
  switch (node.type) {
    case 'num': {
      ctx.maxAbs = Math.max(ctx.maxAbs, Math.abs(node.value));
      return { value: node.value, dim: DIM_ZERO, grad: ZERO_GRAD(n) };
    }
    case 'var': {
      const v = ctx.vars.get(node.name);
      if (!v) {
        note(ctx, {
          code: 'unknown-symbol',
          message: `未登记的变量“${node.name}”。可用输入量或前置结果量。`,
          pos: node.pos,
          severity: 'error',
        });
        return { value: Number.NaN, dim: DIM_ZERO, grad: ZERO_GRAD(n) };
      }
      ctx.maxAbs = Math.max(ctx.maxAbs, Math.abs(v.value));
      return { value: v.value, dim: v.dim, grad: v.grad.slice() };
    }
    case 'unary': {
      const a = evaluateAst(node.arg, ctx);
      return {
        value: node.op === '-' ? -a.value : a.value,
        dim: a.dim,
        grad: a.grad.map((x) => (node.op === '-' ? -x : x)),
      };
    }
    case 'percent': {
      const a = evaluateAst(node.arg, ctx);
      if (!dimEqual(a.dim, DIM_ZERO)) {
        note(ctx, {
          code: 'dimension',
          message: `百分号只能用于无量纲量，此处量纲为 ${formatDimension(a.dim)}`,
          pos: node.pos,
          severity: 'error',
        });
      }
      return {
        value: a.value / 100,
        dim: DIM_ZERO,
        grad: a.grad.map((x) => x / 100),
      };
    }
    case 'binary': {
      const left = evaluateAst(node.left, ctx);
      const right = evaluateAst(node.right, ctx);
      switch (node.op) {
        case '+':
        case '-': {
          if (!dimEqual(left.dim, right.dim)) {
            const temp = DIM_TEMPERATURE;
            const oneSideTemp =
              (dimEqual(left.dim, temp) && dimEqual(right.dim, DIM_ZERO)) ||
              (dimEqual(right.dim, temp) && dimEqual(left.dim, DIM_ZERO));
            if (oneSideTemp) {
              note(ctx, {
                code: 'temperature-interval',
                message: `温度量与非温度量的${node.op === '+' ? '加' : '减'}法按“温度间隔”解释（20 ≈ 20 °C 的温差）；如需绝对温度，请显式写作 20 °C`,
                pos: node.pos,
                severity: 'warning',
              });
            } else {
              note(ctx, {
                code: 'dimension',
                message: `不能对量纲 ${formatDimension(left.dim)} 与 ${formatDimension(right.dim)} 做 ${
                  node.op === '+' ? '加' : '减'
                }法（${describe(node.left)} 与 ${describe(node.right)}）`,
                pos: node.pos,
                severity: 'error',
              });
            }
          }
          const sign = node.op === '+' ? 1 : -1;
          const value = guardFinite(left.value + sign * right.value, node.pos, ctx);
          return {
            value,
            dim: left.dim,
            grad: left.grad.map((x, i) => x + sign * right.grad[i]),
          };
        }
        case '*': {
          const value = guardFinite(left.value * right.value, node.pos, ctx);
          return {
            value,
            dim: dimAdd(left.dim, right.dim),
            grad: left.grad.map((x, i) => x * right.value + right.grad[i] * left.value),
          };
        }
        case '/': {
          if (right.value === 0) {
            note(ctx, {
              code: 'divide-zero',
              message: `除数为零：${describe(node.right)} = 0`,
              pos: node.pos,
              severity: 'error',
            });
          }
          ctx.divisions.push({
            value: right.value,
            pos: node.pos,
            leftText: `${describe(node.right)}`,
            grad: right.grad.slice(),
            dim: right.dim,
          });
          const value = guardFinite(
            right.value === 0 ? Number.NaN : left.value / right.value,
            node.pos,
            ctx,
          );
          return {
            value,
            dim: dimSub(left.dim, right.dim),
            grad: left.grad.map((x, i) =>
              right.value === 0
                ? Number.NaN
                : x / right.value - (left.value * right.grad[i]) / (right.value * right.value),
            ),
          };
        }
        case '^': {
          const expValue = numValue(node.right);
          if (expValue === null) {
            note(ctx, {
              code: 'nonconstant-exponent',
              message: '幂指数必须是常量（不得引用测量输入），以便进行量纲检查',
              pos: node.pos,
              severity: 'error',
            });
            return { value: Number.NaN, dim: DIM_ZERO, grad: ZERO_GRAD(n) };
          }
          if (!dimEqual(right.dim, DIM_ZERO)) {
            note(ctx, {
              code: 'dimension',
              message: '幂指数必须是无量纲量',
              pos: node.pos,
              severity: 'error',
            });
          }
          if (left.value < 0 && !Number.isInteger(expValue)) {
            note(ctx, {
              code: 'domain',
              message: '底数为负时，指数必须为整数',
              pos: node.pos,
              severity: 'error',
            });
            return { value: Number.NaN, dim: DIM_ZERO, grad: ZERO_GRAD(n) };
          }
          if (left.value === 0 && expValue < 0) {
            note(ctx, {
              code: 'domain',
              message: '零的负数次幂无定义',
              pos: node.pos,
              severity: 'error',
            });
            return { value: Number.NaN, dim: DIM_ZERO, grad: ZERO_GRAD(n) };
          }
          const candidateDim = dimScale(left.dim, expValue);
          const integral = candidateDim.every((x) => Math.abs(x - Math.round(x)) < 1e-9);
          if (!integral) {
            note(ctx, {
              code: 'dimension',
              message: `幂运算会产生非整数量纲指数（${candidateDim.map((x) => x.toFixed(2)).join(', ')}），请改用 sqrt / cbrt 或检查公式`,
              pos: node.pos,
              severity: 'error',
            });
          }
          const dim = candidateDim.map((x) => Math.round(x)) as unknown as Dimension;
          const value = guardFinite(Math.pow(left.value, expValue), node.pos, ctx);
          const dBase =
            expValue === 0 ? 0 : expValue * Math.pow(left.value, expValue - 1);
          if (!Number.isFinite(dBase)) {
            note(ctx, {
              code: 'singular',
              message: '幂运算在当前取值处的导数无定义（可能接近零或溢出）',
              pos: node.pos,
              severity: 'error',
            });
          }
          return {
            value,
            dim,
            grad: left.grad.map((x) => dBase * x),
          };
        }
        default:
          return { value: Number.NaN, dim: DIM_ZERO, grad: ZERO_GRAD(n) };
      }
    }
    case 'call': {
      const args = node.args.map((a) => evaluateAst(a, ctx));
      const name = node.name;
      const arg0 = args[0];
      switch (name) {
        case 'sqrt':
        case 'cbrt': {
          const root = name === 'sqrt' ? 2 : 3;
          if (arg0.value < 0) {
            note(ctx, {
              code: 'domain',
              message: `${name} 的参数必须为非负数，当前为 ${arg0.value}`,
              pos: node.pos,
              severity: 'error',
            });
          }
          const dim = dimDivide(arg0.dim, root);
          if (!dim) {
            note(ctx, {
              code: 'dimension',
              message: `${name} 要求各量纲指数能被 ${root} 整除，当前为 ${formatDimension(arg0.dim)}`,
              pos: node.pos,
              severity: 'error',
            });
          }
          const value = guardFinite(
            root === 2 ? Math.sqrt(arg0.value) : Math.cbrt(arg0.value),
            node.pos,
            ctx,
          );
          const d =
            root === 2
              ? 0.5 / Math.sqrt(Math.max(arg0.value, 1e-300))
              : (1 / 3) * Math.pow(Math.max(Math.abs(arg0.value), 1e-300), -2 / 3);
          if (arg0.value === 0) {
            note(ctx, {
              code: 'singular',
              message: `${name} 在 0 处导数无定义，一阶传播不可用`,
              pos: node.pos,
              severity: 'error',
            });
          }
          return {
            value,
            dim: dim ?? DIM_ZERO,
            grad: arg0.grad.map((x) => d * x),
          };
        }
        case 'abs': {
          const sign = arg0.value < 0 ? -1 : 1;
          return {
            value: Math.abs(arg0.value),
            dim: arg0.dim,
            grad: arg0.grad.map((x) => sign * x),
          };
        }
        case 'exp':
        case 'ln':
        case 'log':
        case 'log10':
        case 'sin':
        case 'cos':
        case 'tan':
        case 'asin':
        case 'acos':
        case 'atan': {
          if (!dimEqual(arg0.dim, DIM_ZERO)) {
            note(ctx, {
              code: 'dimension',
              message: `${name} 的参数必须无量纲，当前为 ${formatDimension(arg0.dim)}`,
              pos: node.pos,
              severity: 'error',
            });
          }
          let value = Number.NaN;
          let d = Number.NaN;
          switch (name) {
            case 'exp':
              value = Math.exp(arg0.value);
              d = value;
              break;
            case 'ln':
            case 'log':
              if (arg0.value <= 0) {
                note(ctx, {
                  code: 'domain',
                  message: `${name} 的参数必须大于 0，当前为 ${arg0.value}`,
                  pos: node.pos,
                  severity: 'error',
                });
              }
              value = Math.log(arg0.value);
              d = 1 / arg0.value;
              break;
            case 'log10':
              if (arg0.value <= 0) {
                note(ctx, {
                  code: 'domain',
                  message: `log10 的参数必须大于 0，当前为 ${arg0.value}`,
                  pos: node.pos,
                  severity: 'error',
                });
              }
              value = Math.log10(arg0.value);
              d = 1 / (arg0.value * Math.LN10);
              break;
            case 'sin':
              value = Math.sin(arg0.value);
              d = Math.cos(arg0.value);
              break;
            case 'cos':
              value = Math.cos(arg0.value);
              d = -Math.sin(arg0.value);
              break;
            case 'tan':
              value = Math.tan(arg0.value);
              d = 1 + value * value;
              break;
            case 'asin':
              if (arg0.value <= -1 || arg0.value >= 1) {
                note(ctx, {
                  code: 'domain',
                  message: 'asin 的参数必须在 (-1, 1) 内',
                  pos: node.pos,
                  severity: 'error',
                });
              }
              value = Math.asin(arg0.value);
              d = 1 / Math.sqrt(1 - arg0.value * arg0.value);
              break;
            case 'acos':
              if (arg0.value <= -1 || arg0.value >= 1) {
                note(ctx, {
                  code: 'domain',
                  message: 'acos 的参数必须在 (-1, 1) 内',
                  pos: node.pos,
                  severity: 'error',
                });
              }
              value = Math.acos(arg0.value);
              d = -1 / Math.sqrt(1 - arg0.value * arg0.value);
              break;
            case 'atan':
              value = Math.atan(arg0.value);
              d = 1 / (1 + arg0.value * arg0.value);
              break;
          }
          return {
            value: guardFinite(value, node.pos, ctx),
            dim: DIM_ZERO,
            grad: arg0.grad.map((x) => d * x),
          };
        }
        case 'min':
        case 'max': {
          if (args.length === 0) {
            note(ctx, {
              code: 'arity',
              message: `${name} 至少需要一个参数`,
              pos: node.pos,
              severity: 'error',
            });
            return { value: Number.NaN, dim: DIM_ZERO, grad: ZERO_GRAD(n) };
          }
          const dim = arg0.dim;
          for (const a of args) {
            if (!dimEqual(a.dim, dim)) {
              note(ctx, {
                code: 'dimension',
                message: `${name} 的各参数必须同量纲，出现 ${formatDimension(dim)} 与 ${formatDimension(a.dim)}`,
                pos: node.pos,
                severity: 'error',
              });
            }
          }
          let best = 0;
          for (let i = 1; i < args.length; i += 1) {
            if (name === 'min' ? args[i].value < args[best].value : args[i].value > args[best].value) {
              best = i;
            }
          }
          ctx.maxAbs = Math.max(ctx.maxAbs, Math.abs(args[best].value));
          return { value: args[best].value, dim, grad: args[best].grad.slice() };
        }
        default:
          return { value: Number.NaN, dim: DIM_ZERO, grad: ZERO_GRAD(n) };
      }
    }
  }
}

export interface FormulaEvaluation {
  ok: boolean;
  value: number;
  dim: Dimension;
  grad: number[];
  issues: Issue[];
  divisions: DivisionPoint[];
  maxAbs: number;
}

export function evaluateFormula(
  ast: AstNode,
  vars: Map<string, EvalVar>,
  nodeCount: number,
  nearZeroRel: number,
): FormulaEvaluation {
  const ctx: EvalContext = {
    vars,
    nodeCount,
    issues: [],
    divisions: [],
    maxAbs: 0,
    nearZeroRel,
  };
  const result = evaluateAst(ast, ctx);
  const nonfinite = !Number.isFinite(result.value);
  if (nonfinite && !ctx.issues.some((i) => i.code === 'overflow')) {
    note(ctx, {
      code: 'nonfinite',
      message: '公式结果不是有限数值',
      severity: 'error',
    });
  }
  // 分母接近零的判断需要协方差信息，移至引擎中结合不确定度完成；
  // 这里只报告数值上已接近双精度下限的情况。
  for (const d of ctx.divisions) {
    if (!Number.isFinite(d.value) || d.value === 0) continue;
    if (Math.abs(d.value) < 1e-280) {
      note(ctx, {
        code: 'near-zero-denominator',
        message: `分母“${d.leftText}”的数值 ${formatSci(d.value)} 接近双精度下限，除法不可靠`,
        pos: d.pos,
        severity: 'error',
      });
    }
  }
  void nearZeroRel;
  return {
    ok: !ctx.issues.some((i) => i.severity === 'error') && !nonfinite,
    value: result.value,
    dim: result.dim,
    grad: result.grad,
    issues: ctx.issues,
    divisions: ctx.divisions,
    maxAbs: ctx.maxAbs,
  };
}

export function formatSci(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e-3 && abs < 1e5) {
    return Number(value.toPrecision(digits)).toString();
  }
  return value.toExponential(digits - 1).replace('e+', 'e');
}

export function caretSnippet(formula: string, pos: number): string {
  const safe = Math.max(0, Math.min(formula.length, pos));
  return `${formula}\n${' '.repeat(safe)}^`;
}

/** 编译成纯数值求值器，供蒙特卡洛循环使用；定义域失效时返回 null。 */
export function compileNumeric(ast: AstNode): (vars: Record<string, number>) => number | null {
  const fn = compileNode(ast);
  return (vars) => {
    try {
      const v = fn(vars);
      return Number.isFinite(v) && Math.abs(v) <= 1e300 ? v : null;
    } catch {
      return null;
    }
  };
}

class NumericDomainError extends Error {}

function compileNode(node: AstNode): (vars: Record<string, number>) => number {
  switch (node.type) {
    case 'num': {
      const v = node.value;
      return () => v;
    }
    case 'var': {
      const name = node.name;
      return (vars) => {
        const v = vars[name];
        if (v === undefined) throw new NumericDomainError(name);
        return v;
      };
    }
    case 'unary': {
      const arg = compileNode(node.arg);
      return node.op === '-' ? (vars) => -arg(vars) : arg;
    }
    case 'percent': {
      const arg = compileNode(node.arg);
      return (vars) => arg(vars) / 100;
    }
    case 'binary': {
      const left = compileNode(node.left);
      const right = compileNode(node.right);
      switch (node.op) {
        case '+':
          return (vars) => left(vars) + right(vars);
        case '-':
          return (vars) => left(vars) - right(vars);
        case '*':
          return (vars) => left(vars) * right(vars);
        case '/':
          return (vars) => {
            const d = right(vars);
            if (d === 0) throw new NumericDomainError('div0');
            return left(vars) / d;
          };
        case '^':
          return (vars) => {
            const b = left(vars);
            const e = right(vars);
            if (b < 0 && !Number.isInteger(e)) throw new NumericDomainError('negpow');
            if (b === 0 && e < 0) throw new NumericDomainError('zeropow');
            return Math.pow(b, e);
          };
      }
      break;
    }
    case 'call': {
      const args = node.args.map(compileNode);
      const name = node.name;
      switch (name) {
        case 'sqrt':
          return (vars) => {
            const a = args[0](vars);
            if (a < 0) throw new NumericDomainError('sqrt');
            return Math.sqrt(a);
          };
        case 'cbrt':
          return (vars) => Math.cbrt(args[0](vars));
        case 'abs':
          return (vars) => Math.abs(args[0](vars));
        case 'exp':
          return (vars) => Math.exp(args[0](vars));
        case 'ln':
        case 'log':
          return (vars) => {
            const a = args[0](vars);
            if (a <= 0) throw new NumericDomainError('log');
            return Math.log(a);
          };
        case 'log10':
          return (vars) => {
            const a = args[0](vars);
            if (a <= 0) throw new NumericDomainError('log');
            return Math.log10(a);
          };
        case 'sin':
          return (vars) => Math.sin(args[0](vars));
        case 'cos':
          return (vars) => Math.cos(args[0](vars));
        case 'tan':
          return (vars) => Math.tan(args[0](vars));
        case 'asin':
          return (vars) => {
            const a = args[0](vars);
            if (a <= -1 || a >= 1) throw new NumericDomainError('asin');
            return Math.asin(a);
          };
        case 'acos':
          return (vars) => {
            const a = args[0](vars);
            if (a <= -1 || a >= 1) throw new NumericDomainError('acos');
            return Math.acos(a);
          };
        case 'atan':
          return (vars) => Math.atan(args[0](vars));
        case 'min':
          return (vars) => Math.min(...args.map((a) => a(vars)));
        case 'max':
          return (vars) => Math.max(...args.map((a) => a(vars)));
      }
      break;
    }
  }
  throw new Error('无法编译的表达式节点');
}
