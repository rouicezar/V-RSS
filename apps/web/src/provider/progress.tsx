import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { getAuthCode } from '../utils/auth';
import { serverOriginUrl } from '../utils/env';

/* ================= 事件协议（与后端 events.service 对齐） ================= */

export interface ArticleEvent {
  id: string;
  mpId: string;
  title: string;
  digest?: string | null;
  picUrl?: string | null;
  publishTime: number;
  url?: string | null;
  status: number;
  isFavorite?: boolean;
  contentStatus?: number | null;
  domain?: string | null;
}

export interface JobEventData {
  job: 'refreshAll' | 'history' | 'tagAll' | 'backfill';
  mpId?: string;
  total: number;
  result?: Record<string, unknown>;
}

export type ServerEvent =
  | { type: 'article:upserted'; data: ArticleEvent }
  | {
      type: 'article:tagged';
      data: { articleId: string; tags: string[]; domain: string };
    }
  | {
      type: 'article:contentUpdated';
      data: { articleId: string; filled: boolean };
    }
  | { type: 'job:started'; data: JobEventData }
  | {
      type: 'job:progress';
      data: JobEventData & { current: number; detail?: string };
    }
  | { type: 'job:finished'; data: JobEventData };

/* ================= 单例 EventSource（进程内共享一条连接） ================= */

let source: EventSource | null = null;
let sourceToken: string | null = null;
const listeners = new Set<(event: ServerEvent) => void>();

function dispatch(event: ServerEvent) {
  listeners.forEach((l) => l(event));
}

/**
 * 确保 SSE 连接与当前 authCode 一致（token 变化时重建）。
 * 由 TrpcProvider 每次请求时调用，无需额外状态驱动。
 */
export function syncEventSource() {
  const token = getAuthCode();
  if (
    source &&
    sourceToken === token &&
    source.readyState !== EventSource.CLOSED
  ) {
    return;
  }
  if (source) {
    source.close();
    source = null;
  }
  sourceToken = token;
  if (!token) return;

  source = new EventSource(
    `${serverOriginUrl}/events?token=${encodeURIComponent(token)}`,
  );
  source.onmessage = (msg) => {
    try {
      dispatch(JSON.parse(msg.data) as ServerEvent);
    } catch {
      /* 忽略无法解析的消息 */
    }
  };
  // onerror 不处理：EventSource 自动重连（readyState 变化即触发）
}

/* ================= 任务进度状态 ================= */

export interface JobProgress {
  key: string;
  job: string;
  mpId?: string;
  current: number;
  total: number;
  detail?: string;
  active: boolean;
}

export const jobKey = (d: { job: string; mpId?: string }) =>
  d.job === 'history' && d.mpId ? `history:${d.mpId}` : d.job;

const ProgressContext = createContext<Record<string, JobProgress>>({});

/** 读取全部任务进度（key: refreshAll / history:<mpId> / tagAll / backfill） */
export const useProgress = () => useContext(ProgressContext);

/* 本次采集会话的实时入库统计（用于"已实时入库 N 篇"感知） */
export interface SessionStats {
  upsertedCount: number;
  lastUpsertedAt: number;
}

const StatsContext = createContext<SessionStats>({
  upsertedCount: 0,
  lastUpsertedAt: 0,
});

/** 读取实时入库统计 */
export const useSessionStats = () => useContext(StatsContext);

/** 任务标签文案 */
export const jobLabel = (p: JobProgress): string => {
  switch (p.job) {
    case 'refreshAll':
      return `更新全部${p.detail ? ` · ${p.detail}` : ''}`;
    case 'history':
      return `拉取历史文章${p.total > 0 ? ` · 共 ${p.total} 篇` : ''}`;
    case 'tagAll':
      return `AI 打标${p.detail ? ` · ${p.detail.slice(0, 24)}` : ''}`;
    case 'backfill':
      return `补全正文${p.detail ? ` · ${p.detail.slice(0, 24)}` : ''}`;
    default:
      return p.job;
  }
};

/* ================= 缓存就地更新 ================= */

/** article:upserted → 把新文章插入匹配的 article.list 缓存（不触发网络请求） */
function upsertArticleIntoCache(queryClient: QueryClient, article: ArticleEvent) {
  const cached = queryClient.getQueriesData<{
    items?: unknown[];
    total?: number;
  }>({ queryKey: [['article', 'list']] });

  for (const [key, data] of cached) {
    if (!data || !Array.isArray(data.items)) continue;
    // trpc v10 queryKey: [['article','list', input]]
    const input = (key as unknown[])?.[0]?.[2] as
      | { mpId?: string; keyword?: string; isFavorite?: boolean; tagId?: string; startTime?: number; endTime?: number }
      | undefined;
    // 复杂筛选列表不做就地插入（由 job:finished 兜底失效刷新）
    if (input?.mpId && input.mpId !== article.mpId) continue;
    if (
      input?.keyword ||
      input?.isFavorite ||
      input?.tagId ||
      input?.startTime ||
      input?.endTime
    ) {
      continue;
    }
    if ((data.items as { id: string }[]).some((x) => x.id === article.id)) {
      continue;
    }
    // _freshAt：标记实时入库时间，前端据此渲染"新文章"高亮动画
    const newItem = { ...article, tags: [], _freshAt: Date.now() };
    const items = [newItem, ...data.items].sort(
      (a: any, b: any) => (b.publishTime ?? 0) - (a.publishTime ?? 0),
    );
    queryClient.setQueryData(key, {
      ...data,
      items,
      total: (data.total ?? 0) + 1,
    });
  }
}

/** article:contentUpdated → 就地更新缓存中该文章的正文状态 */
function updateArticleContentInCache(
  queryClient: QueryClient,
  articleId: string,
  filled: boolean,
) {
  const cached = queryClient.getQueriesData<{ items?: unknown[] }>({
    queryKey: [['article', 'list']],
  });
  for (const [key, data] of cached) {
    if (!data || !Array.isArray(data.items)) continue;
    const items = data.items.map((x: any) =>
      x.id === articleId
        ? { ...x, contentStatus: filled ? 1 : x.contentStatus }
        : x,
    );
    queryClient.setQueryData(key, { ...data, items });
  }
}

/** article:tagged → 就地更新缓存中该文章的标签 */
function updateArticleTagsInCache(
  queryClient: QueryClient,
  articleId: string,
  tags: string[],
  domain: string,
) {
  const cached = queryClient.getQueriesData<{ items?: unknown[] }>({
    queryKey: [['article', 'list']],
  });
  for (const [key, data] of cached) {
    if (!data || !Array.isArray(data.items)) continue;
    const items = data.items.map((x: any) =>
      x.id === articleId
        ? {
            ...x,
            tags: tags.map((name) => ({ id: name, name })),
            domain: domain || x.domain,
          }
        : x,
    );
    queryClient.setQueryData(key, { ...data, items });
  }
}

/* ================= 事件桥组件 ================= */

/**
 * 挂载即订阅 SSE 事件流：
 * - article:upserted → 就地插入文章列表缓存（毫秒级可见）
 * - article:tagged → 就地更新文章标签缓存
 * - job:* → 更新全局进度状态；job:finished 兜底失效刷新保证最终一致
 */
export const ProgressEventsBridge: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<Record<string, JobProgress>>({});
  const [stats, setStats] = useState<SessionStats>({
    upsertedCount: 0,
    lastUpsertedAt: 0,
  });

  const handler = useCallback(
    (event: ServerEvent) => {
      switch (event.type) {
        case 'article:upserted':
          upsertArticleIntoCache(queryClient, event.data);
          setStats((s) => ({
            upsertedCount: s.upsertedCount + 1,
            lastUpsertedAt: Date.now(),
          }));
          break;
        case 'article:tagged':
          updateArticleTagsInCache(
            queryClient,
            event.data.articleId,
            event.data.tags,
            event.data.domain,
          );
          queryClient.invalidateQueries({ queryKey: [['tag', 'list']] });
          break;
        case 'article:contentUpdated':
          updateArticleContentInCache(
            queryClient,
            event.data.articleId,
            event.data.filled,
          );
          break;
        case 'job:started':
          setProgress((p) => {
            const key = jobKey(event.data);
            return {
              ...p,
              [key]: {
                ...event.data,
                key,
                current: 0,
                active: true,
              },
            };
          });
          // 采集任务开始：清零实时入库计数
          if (event.data.job === 'refreshAll' || event.data.job === 'history') {
            setStats({ upsertedCount: 0, lastUpsertedAt: 0 });
          }
          break;
        case 'job:progress':
          setProgress((p) => {
            const key = jobKey(event.data);
            return {
              ...p,
              [key]: {
                ...p[key],
                ...event.data,
                key,
                active: true,
              },
            };
          });
          break;
        case 'job:finished': {
          const key = jobKey(event.data);
          setProgress((p) => ({
            ...p,
            [key]: { ...p[key], active: false },
          }));
          // 兜底：任务结束强制刷新，保证最终一致（含复杂筛选列表）
          queryClient.invalidateQueries({ queryKey: [['article', 'list']] });
          queryClient.invalidateQueries({ queryKey: [['feed', 'list']] });
          queryClient.invalidateQueries({ queryKey: [['tag', 'list']] });
          break;
        }
      }
    },
    [queryClient],
  );

  useEffect(() => {
    listeners.add(handler);
    syncEventSource();
    return () => {
      listeners.delete(handler);
    };
  }, [handler]);

  return (
    <StatsContext.Provider value={stats}>
      <ProgressContext.Provider value={progress}>
        {children}
      </ProgressContext.Provider>
    </StatsContext.Provider>
  );
};
