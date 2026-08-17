import { FC, useMemo, useState } from 'react';
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  getKeyValue,
  Spinner,
  Link,
  Pagination,
} from '@nextui-org/react';
import { trpc } from '@web/utils/trpc';
import dayjs from 'dayjs';
import { useParams } from 'react-router-dom';
import { ImageOff } from 'lucide-react';
import { serverOriginUrl } from '@web/utils/env';

const PAGE_SIZE = 10;

/** 微信封面走本地代理（/img/weixin），避免防盗链与混合内容 */
const coverSrc = (picUrl?: string | null) =>
  picUrl ? `${serverOriginUrl}/img/weixin?u=${encodeURIComponent(picUrl)}` : '';

const ArticleList: FC = () => {
  const { id } = useParams();

  const mpId = id || '';

  // 传统分页：每页 10 篇
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching } = trpc.article.list.useQuery({
    limit: PAGE_SIZE,
    page,
    mpId: mpId || undefined,
  });

  const items = useMemo(() => data?.items || [], [data]);
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 实时入库的新文章（SSE 就地插入）高亮动画：_freshAt 标记 + 8s 窗口
  const isFresh = (item: any) =>
    item?._freshAt && Date.now() - item._freshAt < 8_000;

  return (
    <div className="overflow-x-auto">
      <Table
        classNames={{
          table: 'min-h-[420px] min-w-[560px]',
          th: 'text-xs uppercase tracking-wide text-default-500 py-3.5',
          td: 'py-3 text-sm',
          tr: 'transition-colors hover:bg-default-50/60',
        }}
        aria-label="文章列表"
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
          <TableColumn width={64} key="cover">
            <span className="sr-only">封面</span>
          </TableColumn>
          <TableColumn key="title">标题</TableColumn>
          <TableColumn width={160} key="publishTime">
            发布时间
          </TableColumn>
        </TableHeader>
        <TableBody
          isLoading={isLoading || isFetching}
          emptyContent={
            <div className="flex flex-col items-center gap-2 py-10 text-default-400">
              <ImageOff size={28} strokeWidth={1.5} />
              <span className="text-sm">暂无文章，点击上方「立即更新」同步最新发布</span>
            </div>
          }
          items={items || []}
          loadingContent={<Spinner label="加载中..." />}
        >
          {(item) => (
            <TableRow
              key={item.id}
              className={isFresh(item) ? 'vrss-row-new' : undefined}
            >
              {(columnKey) => {
                if (columnKey === 'cover') {
                  const src = coverSrc(item.picUrl);
                  return (
                    <TableCell>
                      {src ? (
                        <img
                          src={src}
                          alt=""
                          loading="lazy"
                          className="h-10 w-14 shrink-0 rounded-md border border-default-200 object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              'none';
                          }}
                        />
                      ) : (
                        <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-md bg-default-100 text-default-300">
                          <ImageOff size={14} />
                        </div>
                      )}
                    </TableCell>
                  );
                }

                if (columnKey === 'publishTime') {
                  const value = dayjs(item.publishTime * 1e3).format(
                    'YYYY-MM-DD HH:mm:ss',
                  );
                  return <TableCell>{value}</TableCell>;
                }

                if (columnKey === 'title') {
                  return (
                    <TableCell>
                      <Link
                        className="block max-w-[480px] truncate font-medium hover:text-primary"
                        isBlock
                        color="foreground"
                        target="_blank"
                        title={item.title}
                        href={`https://mp.weixin.qq.com/s/${item.id}`}
                      >
                        {item.title}
                      </Link>
                    </TableCell>
                  );
                }
                return <TableCell>{getKeyValue(item, columnKey)}</TableCell>;
              }}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default ArticleList;
