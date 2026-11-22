/** 小型对称矩阵工具：Jacobi 特征分解、半正定诊断、确定性采样。 */

export interface EigenResult {
  /** 降序特征值 */
  values: number[];
  /** 与特征值对应的单位特征向量（列为向量） */
  vectors: number[][];
}

export function zeros(n: number, m = n): number[][] {
  return Array.from({ length: n }, () => new Array<number>(m).fill(0));
}

export function identity(n: number): number[][] {
  const out = zeros(n);
  for (let i = 0; i < n; i += 1) out[i][i] = 1;
  return out;
}

export function cloneMatrix(a: number[][]): number[][] {
  return a.map((row) => row.slice());
}

export function isSymmetric(a: number[][], tol = 1e-12): boolean {
  const n = a.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (!Number.isFinite(a[i][j]) || !Number.isFinite(a[j][i])) return false;
      const scale = Math.max(1, Math.abs(a[i][j]), Math.abs(a[j][i]));
      if (Math.abs(a[i][j] - a[j][i]) > tol * scale) return false;
    }
  }
  return true;
}

/**
 * 循环 Jacobi 特征分解。仅用于小矩阵（本应用 n <= 30）。
 * 返回降序特征值；向量按列存放。
 */
export function jacobiEigen(input: number[][], maxSweeps = 80): EigenResult {
  const n = input.length;
  if (n === 0) return { values: [], vectors: [] };
  const A = cloneMatrix(input);
  const V = identity(n);
  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) off += A[p][q] * A[p][q];
    }
    if (off < 1e-30) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = A[p][q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = A[p][p];
        const aqq = A[q][q];
        const theta = (aqq - app) / (2 * apq);
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const pairs = Array.from({ length: n }, (_, i) => ({
    value: A[i][i],
    vector: V.map((row) => row[i]),
  }));
  pairs.sort((a, b) => b.value - a.value);
  return { values: pairs.map((p) => p.value), vectors: pairs.map((p) => p.vector) };
}

export interface PsdDiagnostics {
  eigenvalues: number[];
  minEigenvalue: number;
  /** 允许的数值误差阈值（相对矩阵尺度） */
  tolerance: number;
  psd: boolean;
  singular: boolean;
  scale: number;
}

export function psdDiagnostics(a: number[][], tolFactor = 1e-8): PsdDiagnostics {
  const n = a.length;
  if (n === 0) {
    return {
      eigenvalues: [],
      minEigenvalue: 0,
      tolerance: 0,
      psd: true,
      singular: true,
      scale: 0,
    };
  }
  let scale = 0;
  for (let i = 0; i < n; i += 1) scale = Math.max(scale, Math.abs(a[i][i]));
  const tolerance = scale > 0 ? scale * tolFactor : tolFactor;
  const { values } = jacobiEigen(a);
  const minEigenvalue = values.length ? Math.min(...values) : 0;
  return {
    eigenvalues: values,
    minEigenvalue,
    tolerance,
    psd: minEigenvalue >= -tolerance,
    singular: minEigenvalue <= tolerance,
    scale,
  };
}

/** 使用特征分解构造采样因子 L（协方差 = L Lᵀ）。负的数值噪声截为 0。 */
export function samplingFactor(values: number[], vectors: number[][], n: number) {
  const L = zeros(n);
  let clamped = 0;
  for (let k = 0; k < values.length; k += 1) {
    const lambda = values[k];
    if (lambda < 0) clamped += 1;
    const s = Math.sqrt(Math.max(0, lambda));
    for (let i = 0; i < n; i += 1) L[i][k] = vectors[k][i] * s;
  }
  return { L, clamped };
}

/** 确定性伪随机数（mulberry32）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller，缓存备用值。 */
export function normalSampler(seed: number): () => number {
  const rand = mulberry32(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

export function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function sampleStats(values: number[]) {
  const n = values.length;
  if (n === 0) {
    return { n: 0, mean: NaN, sd: NaN, q025: NaN, q975: NaN, min: NaN, max: NaN, skewness: NaN };
  }
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let m2 = 0;
  let m3 = 0;
  for (const v of values) {
    const d = v - mean;
    m2 += d * d;
    m3 += d * d * d;
  }
  const sd = n > 1 ? Math.sqrt(m2 / (n - 1)) : 0;
  const skewness = n > 2 && sd > 0 ? (m3 / n) / sd ** 3 : 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    n,
    mean,
    sd,
    q025: quantileSorted(sorted, 0.025),
    q975: quantileSorted(sorted, 0.975),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    skewness,
  };
}
