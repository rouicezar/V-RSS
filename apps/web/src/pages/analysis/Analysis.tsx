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
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BarChart3,
  BookMarked,
  FileText,
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

/** 分析页面：雷达 / 报告 / 学习计划 */
const Analysis = () => {
  const [tab, setTab] = useState('radar');
  const [report, setReport] = useState('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
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
  // 最新报告（刷新/切页后自动恢复，不丢失）
  const { data: latestReport } = trpc.analysis.latestReport.useQuery(
    undefined,
    { enabled: !report, retry: false },
  );

  useEffect(() => {
    if (latestReport?.content && !report) {
      setReport(latestReport.content);
    }
  }, [latestReport, report]);

  const { mutateAsync: generateReport } = trpc.analysis.report.useMutation();
  const { mutateAsync: generatePlan } =
    trpc.analysis.learningPlan.useMutation();
  const { mutateAsync: distill, isPending: isDistilling } =
    trpc.analysis.distill.useMutation();
  const { data: kbList, refetch: refetchKbList } =
    trpc.analysis.knowledgeList.useQuery(undefined, { retry: false });

  const handleGenerateReport = async () => {
    if (!window.confirm('生成分析报告将调用 DeepSeek（消耗少量配额），确认生成？'))
      return;
    setIsGeneratingReport(true);
    try {
      const r = await generateReport();
      setReport(r.report);
      toast.success('分析报告已生成');
    } catch (e: any) {
      toast.error('生成失败: ' + e.message);
    } finally {
      setIsGeneratingReport(false);
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
            关注雷达 · AI 报告 · 学习计划 · 知识沉淀
          </p>
        </div>
      </div>

      <Tabs
        selectedKey={tab}
        onSelectionChange={(k) => setTab(k as string)}
        size="lg"
        classNames={{
          tabList:
            'rounded-xl border border-default-200 bg-content1 shadow-sm px-2 py-1',
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
              <FileText size={16} /> 分析报告
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
                基于 AI 标签归因统计（收藏权重 + 文章量），展示强度 Top
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
                      分数算法：收藏数权重（占 6 成）+ 文章量归一化（占 4
                      成）。多收藏值得精读的文章，雷达会更准。
                    </span>
                  </p>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'report' && (
        <Card className="rounded-2xl border border-default-200 shadow-sm">
          <CardHeader className="pb-2 pt-6 px-6">
            <div>
              <h2 className="text-lg font-bold">AI 分析报告</h2>
              <p className="mt-1 text-sm text-default-500">
                基于关注领域、标签分布和收藏生成的深度洞察（已自动保存）
              </p>
            </div>
            <Button
              size="md"
              color="primary"
              className="ml-auto"
              startContent={<Sparkles size={15} />}
              isLoading={isGeneratingReport}
              onPress={handleGenerateReport}
            >
              生成分析报告
            </Button>
          </CardHeader>
          <Divider />
          <CardBody className="px-8 py-6">
            {report ? (
              <div className="prose prose-base max-w-none dark:prose-invert prose-headings:mt-7 prose-headings:mb-3 prose-headings:first:mt-0 prose-h2:border-b prose-h2:border-default-100 prose-h2:pb-2 prose-h2:text-lg prose-h3:text-base prose-h3:font-semibold prose-p:leading-relaxed prose-li:leading-relaxed prose-blockquote:not-italic prose-blockquote:border-l-primary prose-blockquote:bg-primary/5 prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:pr-2 prose-blockquote:text-default-600 prose-code:rounded prose-code:bg-default-100 prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:text-primary prose-table:border prose-table:border-default-200 prose-th:bg-default-100 prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-default-200 prose-td:px-3 prose-td:py-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {report}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="py-16 text-center text-default-400">
                点击"生成分析报告"，DeepSeek 将基于你的关注领域、标签分布和收藏
                生成深度洞察
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'plan' && (
        <div className="space-y-6">
          <Card className="rounded-2xl border border-default-200 shadow-sm">
            <CardHeader className="pb-2 pt-6 px-6">
              <div>
                <h2 className="text-lg font-bold">AI 学习计划</h2>
                <p className="mt-1 text-sm text-default-500">
                  基于薄弱领域生成循序渐进的学习路径
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
