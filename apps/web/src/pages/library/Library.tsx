import {
  Button,
  Chip,
  Input,
  Modal,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Spinner,
  Switch,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Tooltip,
  useDisclosure,
} from '@nextui-org/react';
import { trpc } from '@web/utils/trpc';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { BookOpen, Link2, Search, Sparkles, Star } from 'lucide-react';

/** 文章库页面：搜索/筛选/收藏/标签/正文阅读 */
const Library = () => {
  const [keyword, setKeyword] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [mpId, setMpId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<any>(null);
  const [newTagName, setNewTagName] = useState('');
  const [page, setPage] = useState(1);
  const [relatedArticleId, setRelatedArticleId] = useState<string>('');
  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  // 文章关联推荐
  const { data: related } = trpc.article.related.useQuery(
    { articleId: relatedArticleId, limit: 5 },
    { enabled: relatedArticleId.length > 0 },
  );

  // 文章列表（支持筛选 + 传统分页，每页 10 篇）
  const PAGE_SIZE = 10;
  const { data, isLoading, refetch } = trpc.article.list.useQuery({
    limit: PAGE_SIZE,
    page,
    keyword: keyword || undefined,
    isFavorite: isFavorite || undefined,
    mpId: mpId || undefined,
    tagId: tagIds.length === 1 ? tagIds[0] : undefined,
  });

  const items = useMemo(() => data?.items || [], [data]);
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 公众号 / 标签数据
  const { data: feeds } = trpc.feed.list.useQuery({ limit: 1000 });
  const { data: tags, refetch: refetchTags } = trpc.tag.list.useQuery();

  // 操作
  const { mutateAsync: favorite } = trpc.article.favorite.useMutation();
  const { mutateAsync: setTags, isPending: isSetTagsPending } =
    trpc.article.setTags.useMutation();
  const { mutateAsync: fetchContent } = trpc.article.fetchContent.useMutation();
  const { mutateAsync: cleanupOrphans, isPending: isCleaningOrphans } =
    trpc.feed.cleanupOrphans.useMutation();
  const { mutateAsync: backfillContent, isPending: isBackfilling } =
    trpc.article.backfillContent.useMutation();
  const { mutateAsync: extractArticle, isPending: isExtracting } =
    trpc.tag.extractArticle.useMutation();
  const { mutateAsync: extractAll, isPending: isExtractingAll } =
    trpc.tag.extractAll.useMutation();

  const openArticle = (article: any) => {
    setSelectedArticle(article);
    setRelatedArticleId(article.id || '');
    onOpen();
    // 无正文时自动补抓（仅未尝试过 / 未确认失效的）
    if (!article.content && article.contentStatus !== 2) {
      fetchContent({ id: article.id })
        .then((r) => {
          setSelectedArticle((prev: any) =>
            prev ? { ...prev, content: r.content } : prev,
          );
        })
        .catch(() => {
          setSelectedArticle((prev: any) =>
            prev ? { ...prev, contentStatus: 2 } : prev,
          );
        });
    }
  };

  const toggleFavorite = async (article: any) => {
    await favorite({ id: article.id, isFavorite: !article.isFavorite });
    toast.success(article.isFavorite ? '已取消收藏' : '已收藏');
    refetch();
  };

  const handleAddTag = async () => {
    if (!selectedArticle || !newTagName.trim()) return;
    const names = [
      ...(selectedArticle.tags?.map((t: any) => t.name) || []),
      newTagName.trim(),
    ];
    await setTags({ articleId: selectedArticle.id, tagNames: names });
    setNewTagName('');
    refetch();
    refetchTags();
    setSelectedArticle((prev: any) => ({
      ...prev,
      tags: names.map((name: string) => ({ name })),
    }));
    toast.success('标签已添加');
  };

  const handleRemoveTag = async (name: string) => {
    if (!selectedArticle) return;
    const names = (selectedArticle.tags || [])
      .map((t: any) => t.name)
      .filter((n: string) => n !== name);
    await setTags({ articleId: selectedArticle.id, tagNames: names });
    refetch();
    refetchTags();
    setSelectedArticle((prev: any) => ({
      ...prev,
      tags: names.map((n: string) => ({ name: n })),
    }));
  };

  const handleBackfill = async () => {
    const r = await backfillContent({ limit: 20, delayMs: 1500 });
    toast.success(`已补全 ${r.filled}/${r.total} 篇文章正文`);
    refetch();
  };

  const handleExtractAll = async () => {
    const r = await extractAll({ limit: 50, delayMs: 3000 });
    toast.success(`AI 打标完成：${r.done}/${r.total} 篇`);
    refetch();
    refetchTags();
  };

  const handleExtractArticle = async (articleId: string) => {
    const r = await extractArticle({ id: articleId });
    if (r.tags.length) {
      setSelectedArticle((prev: any) => ({
        ...prev,
        tags: r.tags.map((name: string) => ({ name })),
        domain: r.domain,
      }));
      toast.success(`AI 打标：${r.tags.join(' / ')}`);
    } else {
      toast.error('AI 打标失败');
    }
    refetch();
    refetchTags();
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary shadow-sm">
            <BookOpen size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">文章库</h1>
            <p className="mt-1 text-sm text-default-500">
              已入库 {items.length} 篇文章 · 搜索 / 筛选 / 收藏 / AI 打标
            </p>
          </div>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-default-200 bg-content1 p-4 shadow-sm">
        <Input
          className="min-w-[200px] flex-1"
          placeholder="搜索标题 / 正文关键词"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
          startContent={<Search size={15} className="text-default-400" />}
          size="md"
        />
        <Switch
          size="sm"
          isSelected={isFavorite}
          onValueChange={(v) => {
            setIsFavorite(v);
            setPage(1);
          }}
          color="warning"
        >
          <Star
            size={13}
            className="mr-0.5 inline text-amber-400"
            fill="currentColor"
          />
          只看收藏
        </Switch>
        <Select
          size="md"
          className="w-44 lg:w-52"
          placeholder="全部公众号"
          selectedKeys={mpId ? new Set([mpId]) : new Set()}
          onSelectionChange={(keys) => {
            const k = Array.from(keys as Set<string>);
            setMpId(k[0] || '');
            setPage(1);
          }}
        >
          {(feeds?.items || []).map((f) => (
            <SelectItem key={f.id}>{f.mpName}</SelectItem>
          ))}
        </Select>
        <Select
          size="md"
          className="w-44 lg:w-56"
          placeholder="按标签筛选"
          selectionMode="multiple"
          selectedKeys={new Set(tagIds)}
          onSelectionChange={(keys) => {
            setTagIds(Array.from(keys as Set<string>));
            setPage(1);
          }}
        >
          {(tags || []).map((t) => (
            <SelectItem key={t.id}>
              {t.name} ({t.articleCount})
            </SelectItem>
          ))}
        </Select>
        <Tooltip content="把没有正文的文章补全（每篇间隔1.5秒，20篇一批）">
          <Button
            size="md"
            variant="flat"
            isLoading={isBackfilling}
            onPress={handleBackfill}
          >
            补全正文
          </Button>
        </Tooltip>
        <Tooltip content="给没有标签的文章用 DeepSeek 自动打标签">
          <Button
            size="md"
            color="primary"
            variant="flat"
            startContent={<Sparkles size={15} />}
            isLoading={isExtractingAll}
            onPress={handleExtractAll}
          >
            AI 批量打标
          </Button>
        </Tooltip>
        <Tooltip content="删除与当前订阅无关联的遗留文章（历史引擎数据）">
          <Button
            size="md"
            variant="flat"
            color="danger"
            isLoading={isCleaningOrphans}
            onPress={async () => {
              if (!window.confirm('将删除所有不属于当前订阅的遗留文章，确认？'))
                return;
              const r = await cleanupOrphans();
              toast.success(`已清理 ${r.deleted} 篇遗留文章`);
              refetch();
            }}
          >
            清理遗留文章
          </Button>
        </Tooltip>
      </div>

      {/* 文章列表 */}
      <Table
        classNames={{
          base: 'rounded-2xl border border-default-200 bg-content1 shadow-sm',
          table: 'min-h-[420px]',
          th: 'text-xs uppercase tracking-wide text-default-500 py-3.5',
          td: 'py-3 text-sm',
          tr: 'transition-colors hover:bg-default-50/60',
        }}
        aria-label="文章库"
        bottomContent={
          total > PAGE_SIZE ? (
            <div className="flex flex-col items-center gap-2 py-3">
              <Pagination
                total={totalPages}
                page={Math.min(page, totalPages)}
                onChange={(p) => setPage(p)}
                showControls
                size="sm"
                color="primary"
                classNames={{ item: 'min-w-7 h-7 text-xs' }}
              />
              <span className="text-xs text-default-400">
                共 {total} 篇 · 第 {page}/{totalPages} 页
              </span>
            </div>
          ) : null
        }
      >
        <TableHeader>
          <TableColumn width={380} key="title">
            标题
          </TableColumn>
          <TableColumn width={130} key="mpName">
            公众号
          </TableColumn>
          <TableColumn width={340} key="tags">
            标签
          </TableColumn>
          <TableColumn width={110} key="publishTime">
            发布时间
          </TableColumn>
          <TableColumn width={108} key="actions">
            操作
          </TableColumn>
        </TableHeader>
        <TableBody
          isLoading={isLoading}
          emptyContent={
            items.length === 0
              ? '暂无文章。先在「公众号源」添加订阅并同步文章'
              : '没有匹配的文章'
          }
          items={items || []}
          loadingContent={<Spinner />}
        >
          {(item) => (
            <TableRow key={item.id}>
              <TableCell>
                <button
                  className="block w-[360px] cursor-pointer truncate text-left font-medium hover:text-primary"
                  title={item.title}
                  onClick={() => openArticle(item)}
                >
                  {item.title}
                </button>
                {item.isFavorite && (
                  <Star
                    size={12}
                    className="ml-1 inline text-amber-400"
                    fill="currentColor"
                  />
                )}
                {item.content ? null : item.contentStatus === 2 ? (
                  <span className="ml-1 text-xs text-danger">(链接失效)</span>
                ) : (
                  <span className="ml-1 text-xs text-default-400">
                    (无正文)
                  </span>
                )}
              </TableCell>
              <TableCell>
                <span
                  className="block max-w-[120px] truncate text-sm"
                  title={
                    feeds?.items?.find((f) => f.id === item.mpId)?.mpName ||
                    item.mpId
                  }
                >
                  {feeds?.items?.find((f) => f.id === item.mpId)?.mpName ||
                    (item.mpId.startsWith('MP_WXS_')
                      ? '历史归档'
                      : item.mpId.slice(0, 12) + '…')}
                </span>
              </TableCell>
              <TableCell>
                {(() => {
                  const tags = item.tags || [];
                  const visible = tags.slice(0, 3);
                  const hidden = tags.slice(3);
                  return (
                    <div className="flex w-[320px] flex-nowrap items-center gap-1 overflow-hidden">
                      {visible.map((t: any) => (
                        <Chip
                          key={t.id}
                          size="sm"
                          variant="flat"
                          className="h-5 shrink-0 text-xs"
                        >
                          {t.name}
                        </Chip>
                      ))}
                      {hidden.length > 0 && (
                        <Popover
                          placement="bottom-start"
                          backdrop="transparent"
                        >
                          <PopoverTrigger>
                            <Chip
                              size="sm"
                              color="primary"
                              variant="flat"
                              className="h-5 shrink-0 cursor-pointer text-xs"
                            >
                              +{hidden.length}
                            </Chip>
                          </PopoverTrigger>
                          <PopoverContent className="max-w-[320px] p-3">
                            <div className="flex flex-wrap gap-1">
                              {hidden.map((t: any) => (
                                <Chip
                                  key={t.id}
                                  size="sm"
                                  variant="flat"
                                  className="h-6 text-xs"
                                >
                                  {t.name}
                                </Chip>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  );
                })()}
              </TableCell>
              <TableCell>
                {dayjs(item.publishTime * 1e3).format('YYYY-MM-DD')}
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="flat"
                    className="w-[104px] justify-center whitespace-nowrap"
                    color={item.isFavorite ? 'warning' : 'default'}
                    startContent={
                      <Star
                        size={14}
                        fill={item.isFavorite ? 'currentColor' : 'none'}
                      />
                    }
                    onPress={() => toggleFavorite(item)}
                  >
                    {item.isFavorite ? '取消收藏' : '收藏'}
                  </Button>
                  <Button
                    size="sm"
                    variant="flat"
                    className="w-[64px] justify-center whitespace-nowrap"
                    onPress={() => openArticle(item)}
                  >
                    阅读
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* 阅读弹窗 */}
      <Modal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        size="5xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex-col items-start">
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-xl font-bold">
                    {selectedArticle?.title}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="md"
                      className="w-[124px] justify-center whitespace-nowrap"
                      color={
                        selectedArticle?.isFavorite ? 'warning' : 'default'
                      }
                      startContent={
                        <Star
                          size={14}
                          fill={
                            selectedArticle?.isFavorite
                              ? 'currentColor'
                              : 'none'
                          }
                        />
                      }
                      onPress={async () => {
                        if (!selectedArticle) return;
                        await toggleFavorite(selectedArticle);
                        setSelectedArticle((prev: any) => ({
                          ...prev,
                          isFavorite: !prev.isFavorite,
                        }));
                      }}
                    >
                      {selectedArticle?.isFavorite ? '取消收藏' : '收藏'}
                    </Button>
                    <Button size="md" variant="light" onPress={onClose}>
                      关闭
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1 text-xs text-default-500">
                  {feeds?.items?.find((f) => f.id === selectedArticle?.mpId)
                    ?.mpName || '-'}
                  <span>·</span>
                  {dayjs(selectedArticle?.publishTime * 1e3).format(
                    'YYYY-MM-DD HH:mm',
                  )}
                </div>
                {/* 标签编辑区 */}
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {(selectedArticle?.tags || []).map((t: any) => (
                    <Chip
                      key={t.id || t.name}
                      size="sm"
                      variant="flat"
                      onClose={() => handleRemoveTag(t.name)}
                    >
                      {t.name}
                    </Chip>
                  ))}
                  {selectedArticle?.domain && (
                    <Chip size="sm" color="secondary" variant="dot">
                      领域: {selectedArticle.domain}
                    </Chip>
                  )}
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    startContent={<Sparkles size={14} />}
                    isLoading={isExtracting}
                    onPress={() =>
                      selectedArticle &&
                      handleExtractArticle(selectedArticle.id)
                    }
                  >
                    AI 打标
                  </Button>
                  <div className="flex items-center gap-1">
                    <Input
                      size="md"
                      className="w-40"
                      placeholder="+ 添加标签"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddTag();
                      }}
                    />
                    <Button
                      size="md"
                      variant="flat"
                      isLoading={isSetTagsPending}
                      onPress={handleAddTag}
                    >
                      添加
                    </Button>
                  </div>
                </div>
              </ModalHeader>
              <ModalBody>
                {selectedArticle?.content ? (
                  <iframe
                    className="h-[70vh] w-full rounded-lg border border-default-200"
                    srcDoc={(() => {
                      const isDark =
                        document.documentElement.classList.contains('dark');
                      // 暗色模式下注入反转样式，保证文章可读
                      const darkCss = isDark
                        ? `<style>
                          html,body{background:#1a1a1a!important;color:#ddd!important}
                          .rich_media_content{color:#ddd!important}
                          .rich_media_content *{color:#ddd!important}
                          a{color:#7cb8ff!important}
                          img{opacity:0.9}
                          blockquote{background:#2a2a2a!important;color:#bbb!important}
                          code,pre{background:#333!important;color:#eee!important}
                        </style>`
                        : '';
                      return (
                        '<!DOCTYPE html><html>' +
                        '<head><meta charset="utf-8">' +
                        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
                        darkCss +
                        '</head><body style="margin:0;padding:16px">' +
                        selectedArticle.content +
                        '</body></html>'
                      );
                    })()}
                    title="文章正文"
                  />
                ) : selectedArticle?.contentStatus === 2 ? (
                  <div className="flex h-48 flex-col items-center justify-center gap-3 text-default-400">
                    <Link2 size={30} strokeWidth={1.5} />
                    <p className="text-sm">
                      该文章链接已失效（作者删除或微信清理）
                    </p>
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={async () => {
                        if (!selectedArticle) return;
                        const r = await fetchContent({
                          id: selectedArticle.id,
                        });
                        setSelectedArticle((prev: any) =>
                          prev
                            ? { ...prev, content: r.content, contentStatus: 1 }
                            : prev,
                        );
                      }}
                    >
                      重新抓取
                    </Button>
                  </div>
                ) : (
                  <div className="flex h-40 items-center justify-center text-default-400">
                    <Spinner label="正在获取正文..." />
                  </div>
                )}
              </ModalBody>
              {/* 相关推荐 */}
              {related && related.length > 0 && (
                <div className="border-t border-default-200 px-6 py-4">
                  <p className="mb-3 text-sm font-semibold text-default-600">
                    相关推荐
                  </p>
                  <div className="flex flex-col gap-2">
                    {related.map((r: any) => {
                      const mpName =
                        feeds?.items?.find((f: any) => f.id === r.mpId)
                          ?.mpName || '';
                      return (
                        <div
                          key={r.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-default-100"
                          onClick={() => {
                            setSelectedArticle({
                              ...r,
                              content: null,
                              contentStatus: 0,
                              publishTime: r.publishTime ?? 0,
                            });
                            setRelatedArticleId(r.id);
                            if (!r.content && r.contentStatus !== 2) {
                              fetchContent({ id: r.id })
                                .then((res) => {
                                  setSelectedArticle((prev: any) =>
                                    prev
                                      ? { ...prev, content: res.content }
                                      : prev,
                                  );
                                })
                                .catch(() => {
                                  setSelectedArticle((prev: any) =>
                                    prev ? { ...prev, contentStatus: 2 } : prev,
                                  );
                                });
                            }
                          }}
                        >
                          <span className="flex-1 truncate">{r.title}</span>
                          {mpName && (
                            <Chip
                              size="sm"
                              variant="flat"
                              className="h-5 shrink-0"
                            >
                              {mpName}
                            </Chip>
                          )}
                          <Chip
                            size="sm"
                            color="primary"
                            variant="flat"
                            className="h-5 shrink-0"
                          >
                            {r.score} 标签
                          </Chip>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <ModalFooter>
                <Button
                  variant="flat"
                  size="md"
                  onPress={() => {
                    window.open(
                      `https://mp.weixin.qq.com/s/${selectedArticle?.id}`,
                      '_blank',
                    );
                  }}
                >
                  查看原文
                </Button>
                <Button
                  variant="flat"
                  size="md"
                  onPress={() => {
                    const article = selectedArticle;
                    if (!article) return;
                    // 将 HTML 正文转为纯文本 Markdown
                    const contentHtml = article.content || '';
                    const temp = document.createElement('div');
                    temp.innerHTML = contentHtml;
                    const text = (temp.textContent || temp.innerText || '')
                      .replace(/\n{3,}/g, '\n\n')
                      .trim();
                    const pubDate = dayjs(article.publishTime * 1e3).format(
                      'YYYY-MM-DD',
                    );
                    const md = [
                      `# ${article.title}`,
                      '',
                      `> 发布时间: ${pubDate}`,
                      `> 公众号: ${feeds?.items?.find((f: any) => f.id === article.mpId)?.mpName || '-'}`,
                      article.domain ? `> 领域: ${article.domain}` : '',
                      (article.tags || []).length > 0
                        ? `> 标签: ${(article.tags || []).map((t: any) => t.name).join(', ')}`
                        : '',
                      '',
                      '---',
                      '',
                      text,
                      '',
                      `---`,
                      `原文链接: https://mp.weixin.qq.com/s/${article.id}`,
                    ]
                      .filter((l) => l !== '')
                      .join('\n');
                    const blob = new Blob([md], {
                      type: 'text/markdown;charset=utf-8',
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${article.title || article.id}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success('已导出 Markdown');
                  }}
                >
                  导出
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
};

export default Library;
