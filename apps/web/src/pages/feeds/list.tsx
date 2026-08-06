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

const PAGE_SIZE = 10;

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

  return (
    <div>
      <Table
        classNames={{
          table: 'min-h-[420px]',
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
          <TableColumn key="title">标题</TableColumn>
          <TableColumn width={180} key="publishTime">
            发布时间
          </TableColumn>
        </TableHeader>
        <TableBody
          isLoading={isLoading || isFetching}
          emptyContent={'暂无数据'}
          items={items || []}
          loadingContent={<Spinner />}
        >
          {(item) => (
            <TableRow key={item.id}>
              {(columnKey) => {
                let value = getKeyValue(item, columnKey);

                if (columnKey === 'publishTime') {
                  value = dayjs(value * 1e3).format('YYYY-MM-DD HH:mm:ss');
                  return <TableCell>{value}</TableCell>;
                }

                if (columnKey === 'title') {
                  return (
                    <TableCell>
                      <Link
                        className="block max-w-[640px] truncate visited:text-neutral-400"
                        isBlock
                        showAnchorIcon
                        color="foreground"
                        target="_blank"
                        title={value}
                        href={`https://mp.weixin.qq.com/s/${item.id}`}
                      >
                        {value}
                      </Link>
                    </TableCell>
                  );
                }
                return <TableCell>{value}</TableCell>;
              }}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default ArticleList;
