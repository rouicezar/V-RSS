import {
  Avatar,
  Button,
  Divider,
  Listbox,
  ListboxItem,
  ListboxSection,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Input,
  Switch,
  Tooltip,
  useDisclosure,
  Link,
} from '@nextui-org/react';
import { PlusIcon } from '@web/components/PlusIcon';
import {
  Activity,
  Clock,
  LayoutGrid,
  Rss,
  ExternalLink,
  FileDown,
  Info,
  RefreshCw,
  Search,
  Timer,
  User,
} from 'lucide-react';
import { trpc } from '@web/utils/trpc';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { serverOriginUrl } from '@web/utils/env';
import ArticleList from './list';

const Feeds = () => {
  const { id } = useParams();

  const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
  const { refetch: refetchFeedList, data: feedData } = trpc.feed.list.useQuery(
    {},
    {
      refetchOnWindowFocus: true,
    },
  );

  const navigate = useNavigate();

  const queryUtils = trpc.useUtils();

  const { mutateAsync: getMpInfo, isLoading: isGetMpInfoLoading } =
    trpc.platform.getMpInfo.useMutation({});
  const { mutateAsync: updateMpInfo } = trpc.feed.edit.useMutation({});

  const { mutateAsync: addFeed, isLoading: isAddFeedLoading } =
    trpc.feed.add.useMutation({});
  const { mutateAsync: refreshMpArticles, isLoading: isGetArticlesLoading } =
    trpc.feed.refreshArticles.useMutation();
  const { mutateAsync: syncMpAvatars, isLoading: isSyncingAvatars } =
    trpc.feed.syncMpAvatars.useMutation();
  const {
    mutateAsync: getHistoryArticles,
    isLoading: isGetHistoryArticlesLoading,
  } = trpc.feed.getHistoryArticles.useMutation();

  const { data: inProgressHistoryMp, refetch: refetchInProgressHistoryMp } =
    trpc.feed.getInProgressHistoryMp.useQuery(undefined, {
      refetchOnWindowFocus: true,
      refetchInterval: 10 * 1e3,
      refetchOnMount: true,
      refetchOnReconnect: true,
    });

  // 采集状态 dashboard（30s 轮询）
  const { data: syncStatus, refetch: refetchSyncStatus } =
    trpc.platform.syncStatus.useQuery(undefined, {
      refetchInterval: 15 * 1e3,
    });
  const isRateLimited = syncStatus?.rateLimited ?? false;
  const throttledSec = syncStatus?.throttledSec ?? 0;
  const guardLevel = syncStatus?.level ?? 'ok';

  const { data: isRefreshAllMpArticlesRunning } =
    trpc.feed.isRefreshAllMpArticlesRunning.useQuery();

  const { mutateAsync: deleteFeed, isLoading: isDeleteFeedLoading } =
    trpc.feed.delete.useMutation({});

  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  // 冷却倒计时（秒）：节流/限流期间采集按钮禁用
  const [cooldown, setCooldown] = useState(0);
  const [rateLimitedHit, setRateLimitedHit] = useState(false);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown > 0]);
  // 后端熔断恢复后清除本地触发标记
  useEffect(() => {
    if (syncStatus && !syncStatus.rateLimited && rateLimitedHit) {
      setRateLimitedHit(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus?.rateLimited]);

  const [currentMpId, setCurrentMpId] = useState(id || '');

  const { mutateAsync: searchBiz, isLoading: isSearching } =
    trpc.platform.searchBiz.useMutation({});

  // 距离上次更新全部（分钟）
  const lastSyncMinAgo = syncStatus?.lastSyncAllAt
    ? Math.max(0, Math.floor((Date.now() - syncStatus.lastSyncAllAt) / 6e4))
    : null;
  // 建议下次同步等待（分钟）
  const suggestedWaitMin = syncStatus?.suggestedNextSyncAt
    ? Math.max(
        0,
        Math.ceil((syncStatus!.suggestedNextSyncAt! - Date.now()) / 6e4),
      )
    : 0;
  const retryMin =
    syncStatus && syncStatus.retryAfterSec > 0
      ? Math.ceil(syncStatus.retryAfterSec / 60)
      : 0;
  // 防呆：限流/冷却时按钮禁用 + 显示状态文案
  const guardDisabled = (extra = false) =>
    isRateLimited || rateLimitedHit || cooldown > 0 || guardLevel === 'danger' || extra;
  const guardLabel = (label: string) =>
    isRateLimited ? '限流中' : cooldown > 0 ? `冷却 ${cooldown}s` : label;

  const handleSearch = async () => {
    if (!searchKeyword.trim()) {
      toast.error('请输入公众号名称或关键词');
      return;
    }
    try {
      const list = await searchBiz({ keyword: searchKeyword.trim() });
      setSearchResults(list || []);
      setSearched(true);
      if (!list?.length) {
        toast.warning('未搜索到公众号，或接口限流中，请稍后再试');
      }
    } catch (e: any) {
      toast.error('搜索失败: ' + e.message);
    }
  };

  const handleAdd = async (item: any) => {
    try {
      await addFeed({
        id: item.fakeid,
        mpName: item.nickname || '未知公众号',
        mpCover: item.headimgurl || '',
        mpIntro: item.signature || '',
        fakerId: item.fakeid,
        updateTime: Math.floor(Date.now() / 1e3),
        status: 1,
      });
      await refreshMpArticles({ mpId: item.fakeid });
      toast.success('添加成功', {
        description: `公众号 ${item.nickname}`,
      });
      await queryUtils.article.list.reset();
      refetchFeedList();
      onClose();
      setSearchResults([]);
      setSearchKeyword('');
      setSearched(false);
    } catch (e: any) {
      toast.error('添加失败: ' + e.message);
    }
  };

  const isActive = (key: string) => {
    return currentMpId === key;
  };

  const currentMpInfo = useMemo(() => {
    return feedData?.items.find((item) => item.id === currentMpId);
  }, [currentMpId, feedData?.items]);

  const handleExportOpml = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!feedData?.items?.length) {
      console.warn('没有订阅源');
      return;
    }

    let opmlContent = `<?xml version="1.0" encoding="UTF-8"?>
    <opml version="2.0">
      <head>
        <title>V-RSS 所有订阅源</title>
      </head>
      <body>
    `;

    feedData?.items.forEach((sub) => {
      opmlContent += `    <outline text="${sub.mpName}" type="rss" xmlUrl="${window.location.origin}/feeds/${sub.id}.atom" htmlUrl="${window.location.origin}/feeds/${sub.id}.atom"/>\n`;
    });

    opmlContent += `    </body>
    </opml>`;

    const blob = new Blob([opmlContent], { type: 'text/xml;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'V-RSS-All.opml';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      {/* 页面标题 */}
      <div className="flex items-center gap-3.5">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary shadow-sm">
          <Rss size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">公众号源</h1>
          <p className="mt-1 text-sm text-default-500">
            订阅管理 · 采集同步 · 状态监控
          </p>
        </div>
      </div>

      {/* 采集状态 dashboard */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-default-200 bg-content1 p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Clock size={18} />
          </div>
          <div>
            <p className="text-xs text-default-500">距上次更新全部</p>
            <p className="text-base font-bold">
              {lastSyncMinAgo === null
                ? '尚未执行'
                : lastSyncMinAgo < 1
                  ? '刚刚'
                  : `${lastSyncMinAgo} 分钟前`}
            </p>
            {(syncStatus?.todayTrips ?? 0) > 0 && (
              <p className="text-xs text-danger">
                今日已触发限流 {syncStatus?.todayTrips} 次
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-default-100 text-default-500">
            <Activity size={18} />
          </div>
          <div>
            <p className="text-xs text-default-500">公众号接口</p>
            {syncStatus?.levelText && (
              <p className="text-xs text-default-400">
                {syncStatus.levelText}
              </p>
            )}
            {guardLevel === 'danger' ? (
              <p className="text-sm font-bold text-danger">
                {syncStatus?.todayTrips >= 2
                  ? `今日触发限流 ${syncStatus?.todayTrips} 次`
                  : `限流中 · 约 ${retryMin} 分钟后可试`}
              </p>
            ) : guardLevel === 'warn' ? (
              <p className="text-sm font-bold text-warning">谨慎操作</p>
            ) : (
              <p className="text-sm font-bold text-success">正常</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-default-100 text-default-500">
            <Timer size={18} />
          </div>
          <div>
            <p className="text-xs text-default-500">建议下次同步</p>
            <p className="text-sm font-bold">
              {guardLevel === 'danger'
                ? '明天再试'
                : guardLevel === 'warn' || suggestedWaitMin > 0
                  ? `${Math.max(retryMin, suggestedWaitMin, 1)} 分钟后`
                  : '可操作（注意节流）'}
            </p>
            {!isRateLimited && syncStatus && syncStatus.minIntervalSec > 0 && (
              <p className="text-xs text-warning">
                距上次请求 {syncStatus.minIntervalSec}s
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-default-100 text-default-500">
            <Info size={18} />
          </div>
          <div>
            <p className="text-xs text-default-500">更新全部 = 最新发布</p>
            <p className="text-sm text-default-600">
              每次拉取各订阅最新 5 篇；完整历史用「获取历史文章」
            </p>
            <p className="mt-0.5 text-xs text-default-400">
              今日后台请求 {syncStatus?.dailyCount ?? 0}/
              {syncStatus?.dailyLimit ?? 100}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Tooltip
            content="同步所有订阅的最新发布（受限流保护，限流时立即返回）"
          >
            <Button
              color="primary"
              size="md"
              variant="flat"
              startContent={<RefreshCw size={15} />}
              isDisabled={guardDisabled(
                isRefreshAllMpArticlesRunning || isGetArticlesLoading,
              )}
              isLoading={
                isRefreshAllMpArticlesRunning || isGetArticlesLoading
              }
              onPress={async () => {
                const r = await refreshMpArticles({});
                await refetchFeedList();
                await queryUtils.article.list.reset();
                refetchSyncStatus();
                if ((r as any)?.rateLimited) {
                  setRateLimitedHit(true);
                  setCooldown(3600);
                  toast.error(
                    '公众号接口限流中，按钮已禁用，请稍后再试',
                  );
                } else {
                  toast.success('已触发更新全部');
                }
              }}
            >
              {guardLabel('更新全部')}
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-col items-start gap-4 lg:flex-row">
        <div className="w-full p-4 sticky top-20 self-start rounded-2xl border border-default-200 bg-content1 shadow-sm lg:w-64 xl:w-72">
          <div className="pb-4 flex justify-between align-middle items-center">
            <Button
              color="primary"
              size="sm"
              onPress={onOpen}
              endContent={<PlusIcon />}
              className="font-medium"
            >
              添加订阅
            </Button>
            <div className="font-normal text-xs text-default-500">
              共 {feedData?.items.length || 0} 个订阅
            </div>
          </div>

          {feedData?.items ? (
            <Listbox
              aria-label="订阅源"
              emptyContent="暂无订阅"
              onAction={(key) => {
                setCurrentMpId(key as string);
                // 纯 SPA 导航：不用 href，避免浏览器跳转到 RSS 路由
                navigate(key ? `/feeds/${key}` : '/feeds');
              }}
            >
              <ListboxSection showDivider>
                <ListboxItem
                  key={''}
                  className={`outline-none ${isActive('') ? 'bg-primary-50 text-primary' : ''}`}
                  startContent={
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center text-default-400">
                      <LayoutGrid size={16} strokeWidth={2} />
                    </div>
                  }
                >
                  全部
                </ListboxItem>
              </ListboxSection>

              <ListboxSection className="max-h-[calc(100vh-300px)] overflow-y-auto">
                {feedData?.items.map((item) => {
                  return (
                    <ListboxItem
                      className={`outline-none ${
                        isActive(item.id) ? 'bg-primary-50 text-primary' : ''
                      }`}
                      key={item.id}
                      startContent={
                        <Avatar
                          size="sm"
                          className="h-7 w-7 shrink-0 text-xs"
                          src={
                            item.mpCover
                              ? `${serverOriginUrl}/img/avatar/${item.id}`
                              : undefined
                          }
                          name={(item.mpName || '?').slice(0, 1)}
                          imgProps={{
                            style: { objectFit: 'cover', width: '100%', height: '100%' },
                          }}
                        ></Avatar>
                      }
                      description={item.mpIntro ? item.mpIntro.slice(0, 22) : undefined}
                    >
                      {item.mpName}
                    </ListboxItem>
                  );
                }) || []}
              </ListboxSection>
            </Listbox>
          ) : (
            ''
          )}
        </div>
        <div className="flex-1 flex flex-col min-w-0 rounded-2xl border border-default-200 bg-content1 shadow-sm overflow-hidden">
          <div className="border-b border-default-100 bg-default-50/40 px-5 py-3 text-xs text-default-500">
            文章列表 · 点击标题在微信中打开 · 建议使用「立即更新」同步最新发布
          </div>
          <div className="p-4 pb-0 flex flex-wrap items-center gap-y-2 justify-between">
            <h3 className="text-lg font-bold flex-1 overflow-hidden text-ellipsis break-keep text-nowrap pr-1">
              {currentMpInfo?.mpName || '全部'}
            </h3>
            {currentMpInfo ? (
              <div className="flex h-5 flex-wrap items-center gap-x-4 gap-y-2 text-small">
                <div className="font-light">
                  最后更新时间:
                  {dayjs(currentMpInfo.syncTime * 1e3).format(
                    'YYYY-MM-DD HH:mm:ss',
                  )}
                </div>
                <Divider orientation="vertical" />
                <Tooltip
                  content="频繁调用可能会导致一段时间内不可用"
                  color="danger"
                >
                  <Link
                    size="sm"
                    href="#"
                    isDisabled={guardDisabled(isGetArticlesLoading)}
                    onClick={async (ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      const r = await refreshMpArticles({
                        mpId: currentMpInfo.id,
                      });
                      await refetchFeedList();
                      await queryUtils.article.list.reset();
                      if ((r as any)?.rateLimited) {
                        setRateLimitedHit(true);
                        setCooldown(3600);
                        toast.error(
                          '公众号接口限流中，按钮已禁用，请稍后再试',
                        );
                      }
                    }}
                  >
                    {isGetArticlesLoading
                      ? '更新中...'
                      : guardLabel('立即更新')}
                  </Link>
                </Tooltip>
                <Divider orientation="vertical" />
                {(
                  <>
                    <Tooltip
                      content={
                        inProgressHistoryMp?.id === currentMpInfo.id
                          ? `正在获取第${inProgressHistoryMp.page}页...`
                          : `历史文章需要分批次拉取，请耐心等候，频繁调用可能会导致一段时间内不可用`
                      }
                      color={
                        inProgressHistoryMp?.id === currentMpInfo.id
                          ? 'primary'
                          : 'danger'
                      }
                    >
                      <Link
                        size="sm"
                        href="#"
                        isDisabled={guardDisabled(
                          (inProgressHistoryMp?.id
                            ? inProgressHistoryMp?.id !== currentMpInfo.id
                            : false) ||
                            isGetHistoryArticlesLoading ||
                            isGetArticlesLoading,
                        )}
                        onClick={async (ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();

                          if (inProgressHistoryMp?.id === currentMpInfo.id) {
                            await getHistoryArticles({
                              mpId: '',
                            });
                          } else {
                            await getHistoryArticles({
                              mpId: currentMpInfo.id,
                            });
                          }

                          await refetchInProgressHistoryMp();
                        }}
                      >
                        {inProgressHistoryMp?.id === currentMpInfo.id
                          ? `停止获取历史文章`
                          : guardLabel(
                              currentMpInfo.hasHistory === 0
                                ? '重扫历史'
                                : '获取历史文章',
                            )}
                      </Link>
                    </Tooltip>
                    <Divider orientation="vertical" />
                  </>
                )}

                <Tooltip content="启用服务端定时更新">
                  <div>
                    <Switch
                      size="sm"
                      onValueChange={async (value) => {
                        await updateMpInfo({
                          id: currentMpInfo.id,
                          data: {
                            status: value ? 1 : 0,
                          },
                        });

                        await refetchFeedList();
                      }}
                      isSelected={currentMpInfo?.status === 1}
                    ></Switch>
                  </div>
                </Tooltip>
                <Divider orientation="vertical" />
                <Tooltip content="仅删除订阅源，已获取的文章不会被删除">
                  <Link
                    href="#"
                    color="danger"
                    size="sm"
                    isDisabled={isDeleteFeedLoading}
                    onClick={async (ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();

                      if (window.confirm('确定删除吗？')) {
                        await deleteFeed(currentMpInfo.id);
                        navigate('/feeds');
                        await refetchFeedList();
                      }
                    }}
                  >
                    删除
                  </Link>
                </Tooltip>

                <Divider orientation="vertical" />
                <Tooltip
                  content={
                    <div>
                      可添加.atom/.rss/.json格式输出, limit=20&page=1控制分页
                    </div>
                  }
                >
                  <Link
                    size="sm"
                    showAnchorIcon
                    target="_blank"
                    href={`${serverOriginUrl}/feeds/${currentMpInfo.id}.atom`}
                    color="foreground"
                  >
                    RSS
                  </Link>
                </Tooltip>
              </div>
            ) : (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Tooltip
                  content="从文章页反查公众号名称和头像（优先公网抓取，必要时搜索兜底）"
                >
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={<RefreshCw size={14} />}
                    isLoading={isSyncingAvatars}
                    isDisabled={guardDisabled()}
                    onPress={async () => {
                      const r = await syncMpAvatars();
                      await refetchFeedList();
                      refetchSyncStatus();
                      if (r.rateLimited) {
                        toast.error(
                          '公众号接口限流中，头像同步已暂停，请稍后再试',
                        );
                      } else {
                        toast.success(
                          `头像同步完成：${r.updated}/${r.total} 成功`,
                        );
                      }
                    }}
                  >
                    {guardLabel('同步头像')}
                  </Button>
                </Tooltip>
                <Tooltip
                  content="频繁调用可能会导致一段时间内不可用"
                  color="danger"
                >
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={<RefreshCw size={14} />}
                    isDisabled={
                      isRefreshAllMpArticlesRunning || isGetArticlesLoading
                    }
                    isLoading={
                      isRefreshAllMpArticlesRunning || isGetArticlesLoading
                    }
                    onPress={async () => {
                      const r = await refreshMpArticles({});
                      await refetchFeedList();
                      await queryUtils.article.list.reset();
                      refetchSyncStatus();
                      if ((r as any)?.rateLimited) {
                        toast.error(
                          '公众号接口限流中，已自动暂停 10 分钟，请稍后再试',
                        );
                      }
                    }}
                  >
                    更新全部
                  </Button>
                </Tooltip>
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<FileDown size={14} />}
                  onPress={(ev: any) => handleExportOpml(ev)}
                >
                  导出OPML
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  as={Link}
                  target="_blank"
                  href={`${serverOriginUrl}/feeds/all.atom`}
                  endContent={<ExternalLink size={14} />}
                >
                  RSS
                </Button>
              </div>
            )}
          </div>
          <div className="p-2 overflow-y-auto">
            <ArticleList></ArticleList>
          </div>
        </div>
      </div>
      <Modal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        size="lg"
        backdrop="blur"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex-col items-start gap-1 border-b border-default-100 pb-3">
                <span className="text-lg">添加公众号源</span>
                <span className="text-xs font-normal text-default-400">
                  搜索公众号名称并选择，自动采集历史文章
                </span>
              </ModalHeader>
              <ModalBody className="min-h-[320px] py-5">
                <div className="flex items-end gap-2">
                  <Input
                    classNames={{ label: 'text-sm' }}
                    value={searchKeyword}
                    onValueChange={(v) => {
                      setSearchKeyword(v);
                      setSearched(false);
                    }}
                    autoFocus
                    size="lg"
                    label="公众号名称 / 关键词"
                    placeholder="如：科技、AI、某某科技"
                    variant="bordered"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                  <Button
                    color="primary"
                    size="lg"
                    className="h-[52px] shrink-0"
                    startContent={
                      isSearching ? null : <Search size={18} />
                    }
                    isLoading={isSearching}
                    isDisabled={guardDisabled(isSearching)}
                    onPress={handleSearch}
                  >
                    {guardLabel('搜索')}
                  </Button>
                </div>

                {searched && searchResults.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-default-400">
                    <Search size={28} strokeWidth={1.5} />
                    <p className="text-sm">未找到相关公众号，换个关键词试试</p>
                  </div>
                ) : (
                  <div className="mt-4 max-h-[320px] space-y-2.5 overflow-y-auto pr-1">
                    {searchResults.map((item: any) => (
                      <div
                        key={item.fakeid}
                        className="flex items-center gap-3.5 rounded-xl border border-default-200 bg-default-50/40 p-3.5 transition-colors hover:border-primary/40 hover:bg-default-50"
                      >
                        {item.headimgurl ? (
                          <Avatar
                            src={`${serverOriginUrl}/img/weixin?u=${encodeURIComponent(item.headimgurl)}`}
                            size="lg"
                            className="shrink-0"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-default-200 text-default-500">
                            <User size={18} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{item.nickname}</p>
                          {item.signature && (
                            <p className="mt-0.5 truncate text-xs text-default-400">
                              {item.signature}
                            </p>
                          )}
                        </div>
                        <Button
                          size="md"
                          color="primary"
                          variant="flat"
                          isLoading={isAddFeedLoading}
                          onPress={() => handleAdd(item)}
                        >
                          添加
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </ModalBody>
              <ModalFooter className="border-t border-default-100 pt-3">
                <Button color="default" variant="flat" onPress={onClose}>
                  取消
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
};

export default Feeds;
