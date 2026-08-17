import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Spinner,
  Tab,
  Tabs,
} from '@nextui-org/react';
import { trpc } from '@web/utils/trpc';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BarChart3,
  BookMarked,
  Flame,
  Lightbulb,
  Map,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

/** 雷达图：纯 SVG 多边形（3-8 维自适应） */
const RadarChart = ({
  data,
}: {
  data: { dimension: string; score: number }[];
}) => {
  const size = 420;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 160;

  const points = useMemo(() => {
    const n = data.length;
    return data.map((d, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = (d.score / 10) * radius;
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  }, [data, cx, cy]);

  const polygonStr = points.map((p) => `${p.x},${p.y}`).join(' ');
  const n = data.length;

  // 网格线（0/2.5/5/7.5/10）
  const rings = [2.5, 5, 7.5, 10].map((v) => {
    const pts = data
      .map((_, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const r = (v / 10) * radius;
        return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
      })
      .join(' ');
    return { v, pts };
  });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto w-full max-w-[460px]"
    >
      {rings.map((ring) => (
        <polygon
          key={ring.v}
          points={ring.pts}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={1}
        />
      ))}
      {data.map((_, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeWidth={1}
          />
        );
      })}
      <polygon
        points={polygonStr}
        fill="var(--vrss-brand)"
        fillOpacity={0.2}
        stroke="var(--vrss-brand)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <g key={i}>
          <circle
            cx={p.x}
            cy={p.y}
            r={4}
            fill="var(--vrss-brand)"
          />
          <text
            x={
              cx + radius * Math.cos((Math.PI * 2 * i) / n - Math.PI / 2) * 1.2
            }
            y={
              cy + radius * Math.sin((Math.PI * 2 * i) / n - Math.PI / 2) * 1.2
            }
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={data.length >= 7 ? 12 : 13}
            fill="currentColor"
          >
            {data[i].dimension}
          </text>
        </g>
      ))}
    </svg>
  );
};

/** Markdown 渲染组件：表格实线边框、代码高亮、链接新窗口 */
const markdownComponents = {
  table: ({ node: _node, ...props }: any) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-default-200">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }: any) => (
    <th
      className="border border-default-300 bg-default-100 px-3 py-2 text-left font-semibold"
      {...props}
    />
  ),
  td: ({ node: _node, ...props }: any) => (
    <td className="border border-default-200 px-3 py-2 align-top" {...props} />
  ),
  tr: ({ node: _node, ...props }: any) => (
    <tr className="transition-colors hover:bg-default-50" {...props} />
  ),
  a: ({ node: _node, href, ...props }: any) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
      {...props}
    />
  ),
  img: ({ node: _node, ...props }: any) => (
    <img
      className="mx-auto my-4 block max-h-[420px] rounded-xl border border-default-200 shadow-sm"
      {...props}
    />
  ),
};

/** 分析页面：雷达 / 热点洞察 / 学习计划 */
const Analysis = () => {
  const [tab, setTab] = useState('radar');
  const [planContent, setPlanContent] = useState('');
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [kbContent, setKbContent] = useState('');
  const [isGeneratingKb, setIsGeneratingKb] = useState(false);
  const [kbMeta, setKbMeta] = useState<{
    articleCount: number;
    imageCount: number;
  } | null>(null);

  const {
    data: radar,
    refetch: refetchRadar,
    isLoading,
  } = trpc.analysis.radar.useQuery(undefined, { refetchOnWindowFocus: true });
  const { data: plans, refetch: refetchPlans } = trpc.analysis.plans.useQuery();

  // 热点主题洞察：近期多源同题聚类 + 深度拆解
  const {
    data: hotTopics,
    refetch: refetchHotTopics,
    isLoading: isLoadingTopics,
  } = trpc.analysis.hotTopics.useQuery(
    { days: 14, limit: 5 },
    { enabled: tab === 'report' },
  );
  const { mutateAsync: analyzeTopic, isPending: isAnalyzingTopic } =
    trpc.analysis.analyzeTopic.useMutation();
  const [topicReport, setTopicReport] = useState<{
    tag: string;
    report: string;
    articles: {
      id: string;
      title: string;
      mpName: string;
      url: string | null;
    }[];
  } | null>(null);

  const { mutateAsync: generatePlan } =
    trpc.analysis.learningPlan.useMutation();
  const { mutateAsync: distill, isPending: isDistilling } =
    trpc.analysis.distill.useMutation();
  const { data: kbList, refetch: refetchKbList } =
    trpc.analysis.knowledgeList.useQuery(undefined, { retry: false });

  const handleAnalyzeTopic = async (tag: string) => {
    try {
      setTopicReport(null);
      const r = await analyzeTopic({ tag });
      setTopicReport(r);
      toast.success(`「${tag}」拆解完成`);
    } catch (e: any) {
      toast.error('拆解失败: ' + e.message);
    }
  };

  const handleDistill = async () => {
    if (
      !window.confirm(
        '知识沉淀将遍历全部有效文章并调用 DeepSeek（消耗较多配额），确认生成？',
      )
    )
      return;
    setIsGeneratingKb(true);
    try {
      const r = await distill();
      setKbContent(r.report);
      setKbMeta({ articleCount: r.articleCount, imageCount: r.imageCount });
      refetchKbList();
      toast.success(
        `知识沉淀完成：覆盖 ${r.articleCount} 篇文章 / ${r.imageCount} 张图`,
      );
    } catch (e: any) {
      toast.error('知识沉淀失败: ' + e.message);
    } finally {
      setIsGeneratingKb(false);
    }
  };

  const handleGeneratePlan = async () => {
    if (!window.confirm('生成学习计划将调用 DeepSeek（消耗少量配额），确认生成？'))
      return;
    setIsGeneratingPlan(true);
    try {
      const r = await generatePlan();
      setPlanContent(r.plan.content);
      refetchPlans();
      toast.success('学习计划已生成');
    } catch (e: any) {
      toast.error('生成失败: ' + e.message);
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center gap-3.5">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary shadow-sm">
          <BarChart3 size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">知识分析</h1>
          <p className="mt-1 text-sm text-default-500">
            关注雷达 · 热点洞察 · 学习计划 · 知识沉淀
          </p>
        </div>
      </div>

      <Tabs
        selectedKey={tab}
        onSelectionChange={(k) => setTab(k as string)}
        size="lg"
        classNames={{
          // 容器去边框（避免与 tab 激活态双重边框），四个 tab 等宽铺满（消除左重右轻）
          tabList:
            'w-full gap-1.5 rounded-2xl bg-content1 p-1.5 shadow-sm',
          tab: 'h-11 flex-1',
          tabContent:
            'text-default-500 group-data-[selected=true]:font-semibold group-data-[selected=true]:text-primary',
          cursor: 'rounded-xl bg-primary/10',
        }}
      >
        <Tab
          key="radar"
          title={
            <span className="flex items-center gap-1.5">
              <BarChart3 size={16} /> 关注雷达
            </span>
          }
        />
        <Tab
          key="report"
          title={
            <span className="flex items-center gap-1.5">
              <Flame size={16} /> 热点洞察
            </span>
          }
        />
        <Tab
          key="plan"
          title={
            <span className="flex items-center gap-1.5">
              <Map size={16} /> 学习计划
            </span>
          }
        />
        <Tab
          key="distill"
          title={
            <span className="flex items-center gap-1.5">
              <BookMarked size={16} /> 知识沉淀
            </span>
          }
        />
      </Tabs>

      {tab === 'radar' && (
        <Card className="rounded-2xl border border-default-200 shadow-sm">
          <CardHeader className="pb-0 pt-6 px-6">
            <div>
              <h2 className="text-lg font-bold">我的关注雷达</h2>
              <p className="mt-1 text-sm text-default-500">
                按领域聚合统计（收藏样本充足时加权），展示关注度 Top
                8，点击"更新"重新计算
              </p>
            </div>
            <Button
              size="md"
              variant="flat"
              className="ml-auto"
              startContent={<RefreshCw size={15} />}
              onPress={() => refetchRadar()}
            >
              更新
            </Button>
          </CardHeader>
          <CardBody className="px-6 py-8">
            {isLoading ? (
              <div className="flex h-64 items-center justify-center">
                <Spinner label="计算中..." />
              </div>
            ) : (radar || []).length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-3 text-default-400">
                <BarChart3 size={32} strokeWidth={1.5} />
                <p className="text-sm">
                  暂无雷达数据。先在「文章库」为文章添加/AI 打标签，再回来查看
                </p>
              </div>
            ) : (
              <div className="grid items-center gap-10 lg:grid-cols-2">
                <RadarChart data={radar || []} />
                <div className="space-y-3">
                  {(radar || []).map((r: any) => (
                    <div
                      key={r.dimension}
                      className="flex items-center justify-between rounded-xl border border-default-200 px-4 py-3 transition-colors hover:bg-default-50"
                    >
                      <div>
                        <span className="font-medium">{r.dimension}</span>
                        <span className="ml-2 text-xs text-default-500">
                          {r.articleCount} 篇文章 · {r.mpCount} 个公众号 · 收藏{' '}
                          {r.favoriteCount}
                        </span>
                      </div>
                      <Chip
                        color={
                          r.score >= 7
                            ? 'success'
                            : r.score >= 4
                              ? 'warning'
                              : 'danger'
                        }
                        size="sm"
                        variant="flat"
                      >
                        {r.score}/10
                      </Chip>
                    </div>
                  ))}
                  <p className="flex items-start gap-1.5 pt-2 text-xs leading-relaxed text-default-400">
                    <Lightbulb size={13} className="mt-0.5 shrink-0" />
                    <span>
                      统计口径：按领域聚合（AI 打标归因的 domain 优先）。
                      收藏 ≥10 篇时收藏加权 6 成，不足时降为 2
                      成——避免"收藏 1 篇即满分"导致失真。
                    </span>
                  </p>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'report' && (
        <div className="space-y-4">
          <Card className="rounded-2xl border border-default-200 shadow-sm">
            <CardHeader className="pb-2 pt-6 px-6">
              <div>
                <h2 className="text-lg font-bold">热点主题洞察</h2>
                <p className="mt-1 text-sm text-default-500">
                  扫描近 14 天文章，找出「多个公众号都在写」或「同源深耕」的主题
                  ——这些是近期最有阅读与学习价值的内容，帮你从海量文章里先筛出值得读的
                </p>
              </div>
              <Button
                size="md"
                variant="flat"
                className="ml-auto"
                startContent={<RefreshCw size={15} />}
                onPress={() => refetchHotTopics()}
              >
                刷新热点
              </Button>
            </CardHeader>
            <Divider />
            <CardBody className="px-6 py-4">
              {isLoadingTopics ? (
                <div className="flex h-32 items-center justify-center">
                  <Spinner label="扫描近期文章..." />
                </div>
              ) : (hotTopics?.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-default-400">
                  <Flame size={30} strokeWidth={1.5} />
                  <p className="text-sm">
                    近 14 天暂无跨公众号热点主题。先同步更多文章，或放宽时间窗口后再来
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {hotTopics!.map((t: any) => (
                    <div
                      key={t.tag}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-default-200 p-4 transition-colors hover:border-primary/30 hover:bg-default-50"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Flame
                          size={16}
                          className="shrink-0 text-primary"
                          fill="currentColor"
                        />
                        <span className="truncate font-semibold">
                          {t.tag}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {t.mpNames.map((n: string) => (
                          <Chip key={n} size="sm" variant="flat">
                            {n}
                          </Chip>
                        ))}
                      </div>
                      <span className="text-xs text-default-400">
                        {t.articleCount} 篇文章 · {t.mpCount} 个公众号
                      </span>
                      <Button
                        className="ml-auto"
                        size="sm"
                        color="primary"
                        variant="flat"
                        startContent={<Sparkles size={14} />}
                        isLoading={isAnalyzingTopic}
                        onPress={() => handleAnalyzeTopic(t.tag)}
                      >
                        深度拆解
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {topicReport && (
            <Card className="rounded-2xl border border-default-200 shadow-sm">
              <CardHeader className="flex-col items-start gap-2 pb-3 pt-6 px-6">
                <div>
                  <h2 className="text-lg font-bold">
                    深度拆解 · {topicReport.tag}
                  </h2>
                  <p className="mt-1 text-xs text-default-400">
                    涉及文章（点击可打开原文）
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {topicReport.articles.map((a) => (
                    <Chip
                      key={a.id}
                      size="sm"
                      variant="flat"
                      color="primary"
                      className="h-auto py-0.5"
                    >
                      <a
                        href={a.url || `https://mp.weixin.qq.com/s/${a.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-primary hover:underline"
                      >
                        {a.mpName} · {a.title.slice(0, 22)}
                      </a>
                    </Chip>
                  ))}
                </div>
              </CardHeader>
              <Divider />
              <CardBody className="px-8 py-6">
                <div className="prose prose-base max-w-none dark:prose-invert prose-headings:mt-7 prose-headings:mb-3 prose-headings:first:mt-0 prose-h2:border-b prose-h2:border-default-100 prose-h2:pb-2 prose-h2:text-lg prose-h3:text-base prose-h3:font-semibold prose-p:leading-relaxed prose-li:leading-relaxed prose-blockquote:not-italic prose-blockquote:border-l-primary prose-blockquote:bg-primary/5 prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:pr-2 prose-blockquote:text-default-600 prose-code:rounded prose-code:bg-default-100 prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:text-primary prose-table:border prose-table:border-default-200 prose-th:bg-default-100 prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-default-200 prose-td:px-3 prose-td:py-2">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {topicReport.report}
                  </ReactMarkdown>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {tab === 'plan' && (
        <div className="space-y-6">
          <Card className="rounded-2xl border border-default-200 shadow-sm">
            <CardHeader className="pb-2 pt-6 px-6">
              <div>
                <h2 className="text-lg font-bold">AI 学习计划</h2>
                <p className="mt-1 text-sm text-default-500">
                  基于近期热点主题（多公众号同写）生成 4 周阅读学习计划：
                  读哪些文章、按什么顺序、每篇重点与产出
                </p>
              </div>
              <Button
                size="md"
                color="primary"
                className="ml-auto"
                startContent={<Map size={15} />}
                isLoading={isGeneratingPlan}
                onPress={handleGeneratePlan}
              >
                生成 4 周学习计划
              </Button>
            </CardHeader>
            <Divider />
            <CardBody className="px-8 py-6">
              {planContent ? (
                <div className="prose prose-base max-w-none dark:prose-invert prose-headings:mt-8 prose-headings:first:mt-0 prose-p:leading-relaxed prose-li:leading-relaxed">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {planContent}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="py-16 text-center text-default-400">
                  点击"生成 4
                  周学习计划"，基于你的薄弱领域生成循序渐进的学习路径
                </p>
              )}
            </CardBody>
          </Card>
          {(plans || []).length > 0 && (
            <Card className="rounded-2xl border border-default-200 shadow-sm">
              <CardHeader className="pb-2 pt-5 px-6">
                <h3 className="text-lg font-bold">历史计划</h3>
              </CardHeader>
              <CardBody className="space-y-2 px-6 pb-6">
                {(plans || []).map((p: any) => (
                  <button
                    key={p.id}
                    className="w-full rounded-xl border border-default-200 px-4 py-3 text-left transition-colors hover:bg-default-50"
                    onClick={() => setPlanContent(p.content)}
                  >
                    <span className="font-medium">{p.title}</span>
                    <span className="ml-2 text-xs text-default-400">
                      {new Date(p.createdAt).toLocaleString()}
                    </span>
                  </button>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {tab === 'distill' && (
        <Card className="rounded-2xl border border-default-200 shadow-sm">
          <CardHeader className="pb-2 pt-6 px-6">
            <div>
              <h2 className="text-lg font-bold">知识沉淀</h2>
              <p className="mt-1 text-sm text-default-500">
                蒸馏全部文章的正文与配图，沉淀为可复用的方法论与学习资料（严格覆盖每一篇文章）
              </p>
            </div>
            <Button
              size="md"
              color="primary"
              className="ml-auto"
              startContent={<Sparkles size={15} />}
              isLoading={isGeneratingKb || isDistilling}
              onPress={handleDistill}
            >
              生成知识沉淀
            </Button>
          </CardHeader>
          <Divider />
          <CardBody className="px-8 py-6">
            {kbContent ? (
              <>
                {kbMeta && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    <Chip size="sm" color="primary" variant="flat">
                      覆盖 {kbMeta.articleCount} 篇文章
                    </Chip>
                    <Chip size="sm" color="secondary" variant="flat">
                      配图 {kbMeta.imageCount} 张
                    </Chip>
                    <Chip size="sm" variant="flat">
                      方法论 / 概念 / 工具 / 学习路径
                    </Chip>
                  </div>
                )}
                <div className="prose prose-base max-w-none dark:prose-invert prose-headings:mt-7 prose-headings:mb-3 prose-headings:first:mt-0 prose-h2:border-b prose-h2:border-default-100 prose-h2:pb-2 prose-h2:text-lg prose-h3:text-base prose-h3:font-semibold prose-p:leading-relaxed prose-li:leading-relaxed prose-blockquote:not-italic prose-blockquote:border-l-primary prose-blockquote:bg-primary/5 prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:pr-2 prose-blockquote:text-default-600 prose-code:rounded prose-code:bg-default-100 prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:text-primary prose-table:border prose-table:border-default-200 prose-th:bg-default-100 prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-default-200 prose-td:px-3 prose-td:py-2">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {kbContent}
                  </ReactMarkdown>
                </div>
              </>
            ) : (
              <p className="py-16 text-center text-default-400">
                点击"生成知识沉淀"，将遍历全部有效文章（正文 + 配图），
                蒸馏为方法论库 / 概念词典 / 工具清单 / 图片索引 / 学习路径
              </p>
            )}
            {(kbList || []).length > 0 && (
              <Card className="mt-6 border border-default-200 shadow-sm">
                <CardHeader className="pb-2 pt-5 px-6">
                  <h3 className="text-lg font-bold">历史沉淀</h3>
                </CardHeader>
                <CardBody className="space-y-2 px-6 pb-6">
                  {(kbList || []).map((kb: any) => (
                    <button
                      key={kb.id}
                      className="flex w-full items-center justify-between rounded-xl border border-default-200 px-4 py-3 text-left transition-colors hover:bg-default-50"
                      onClick={() => {
                        setKbContent(kb.content);
                        setKbMeta({
                          articleCount: kb.articleCount,
                          imageCount: kb.imageCount,
                        });
                      }}
                    >
                      <span className="font-medium">{kb.title}</span>
                      <span className="ml-2 text-xs text-default-400">
                        {kb.articleCount} 篇 ·{' '}
                        {new Date(kb.createdAt).toLocaleString()}
                      </span>
                    </button>
                  ))}
                </CardBody>
              </Card>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
};

export default Analysis;
