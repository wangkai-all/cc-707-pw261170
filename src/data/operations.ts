/** 项目级编辑操作（纯函数，便于测试）。 */

import type { Project } from '../core/types';

const now = () => new Date().toISOString();

/**
 * “把某台仪表的校准来源改为独立标准件”：
 * 复制一份编号不同、证书能力相同的新来源，只挂到指定仪表上。
 * 被复制来源的中心值与被引用仪表读数都不变 → 结果均值不变；
 * 但该仪表与其它仪表之间的协方差消失 → 不确定度随之改变。
 */
export function splitSharedSource(
  project: Project,
  sourceId: string,
  instrumentsToDetach: string[],
): { project: Project; newSourceId: string; newCode: string; detached: string[] } | null {
  const source = project.sources.find((s) => s.id === sourceId);
  if (!source) return null;
  const users = project.instruments.filter((i) =>
    i.sourceLinks.some((l) => l.sourceId === sourceId),
  );
  const detach = instrumentsToDetach.filter(
    (id) => users.some((i) => i.id === id) && users.length > 1,
  );
  if (detach.length === 0) return null;

  let code = '';
  for (let n = 1; n < 999; n += 1) {
    const candidate = `${source.code}-D${String(n).padStart(2, '0')}`;
    if (!project.sources.some((s) => s.code === candidate)) {
      code = candidate;
      break;
    }
  }
  if (!code) return null;

  const newId = `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const clone = {
    ...source,
    id: newId,
    code,
    name: `${source.name}（独立副本）`,
    originSourceId: source.id,
    certificate: source.certificate ? `${source.certificate}-D` : '',
    note: `由 ${source.code} 拆分，仅挂接到 ${detach
      .map((id) => project.instruments.find((i) => i.id === id)?.code ?? id)
      .join('、')}。证书能力与数值不变，但不再与其余仪表共享同一随机变量。`,
  };
  const instruments = project.instruments.map((i) =>
    detach.includes(i.id)
      ? {
          ...i,
          sourceLinks: i.sourceLinks.map((l) =>
            l.sourceId === sourceId ? { ...l, sourceId: newId } : l,
          ),
        }
      : i,
  );
  return {
    project: {
      ...project,
      sources: [...project.sources, clone],
      instruments,
      updatedAt: now(),
    },
    newSourceId: newId,
    newCode: code,
    detached: detach,
  };
}

/** 把来源重新合并回原来源（撤销拆分）。 */
export function mergeSource(project: Project, derivedSourceId: string): Project | null {
  const derived = project.sources.find((s) => s.id === derivedSourceId);
  if (!derived || !derived.originSourceId) return null;
  const origin = project.sources.find((s) => s.id === derived.originSourceId);
  if (!origin) return null;
  return {
    ...project,
    sources: project.sources.filter((s) => s.id !== derivedSourceId),
    instruments: project.instruments.map((i) => ({
      ...i,
      sourceLinks: i.sourceLinks.map((l) =>
        l.sourceId === derivedSourceId ? { ...l, sourceId: origin.id } : l,
      ),
    })),
    updatedAt: now(),
  };
}

export function cloneProject(project: Project, name?: string): Project {
  return {
    ...JSON.parse(JSON.stringify(project)) as Project,
    id: `p-${Date.now().toString(36)}`,
    name: name ?? `${project.name}（副本）`,
    updatedAt: now(),
  };
}

export function touch(project: Project): Project {
  return { ...project, updatedAt: now() };
}
