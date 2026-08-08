import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  Button,
  useDisclosure,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Chip,
} from '@nextui-org/react';
import { toast } from 'sonner';
import { PlusIcon } from '@web/components/PlusIcon';
import dayjs from 'dayjs';
import { StatusDropdown } from '@web/components/StatusDropdown';
import { trpc } from '@web/utils/trpc';
import { statusMap } from '@web/constants';
import { Users } from 'lucide-react';
import { useEffect, useState } from 'react';

const AccountPage = () => {
  const { isOpen, onOpen, onClose, onOpenChange } = useDisclosure();
  const [count, setCount] = useState(0);
  const [loginDone, setLoginDone] = useState(false);

  const { refetch, data, isFetching } = trpc.account.list.useQuery({});
  const { data: pipelineInfo } = trpc.platform.pipeline.useQuery();
  const activePipeline = pipelineInfo?.activePipeline ?? 1;

  const queryUtils = trpc.useUtils();

  const { mutateAsync: updateAccount } = trpc.account.edit.useMutation({});

  const { mutateAsync: deleteAccount } = trpc.account.delete.useMutation({});

  const { mutateAsync: addAccount } = trpc.account.add.useMutation({});

  const { mutateAsync, data: loginData } =
    trpc.platform.createLoginUrl.useMutation({
      onSuccess(data) {
        if (data.uuid) {
          setCount(180);
        }
      },
    });

  const { data: loginResult } = trpc.platform.getLoginResult.useQuery(
    {
      id: loginData?.uuid ?? '',
    },
    {
      // 每 2 秒轮询一次扫码状态，成功后停止
      refetchInterval: loginDone ? false : 2 * 1e3,
      refetchIntervalInBackground: false,
      enabled: !!loginData?.uuid && !loginDone,
      async onSuccess(data) {
        if (data.vid && data.token) {
          setLoginDone(true);
          const name = data.username!;
          await addAccount({ id: `${data.vid}`, name, token: data.token });

          onClose();
          toast.success('添加成功', {
            description: `账号：${name}`,
          });
          refetch();
        } else if (
          data.message &&
          /失败|错误|失效|过期|无效/.test(data.message)
        ) {
          toast.error(`登录失败: ${data.message}`);
        }
      },
    },
  );

  useEffect(() => {
    let timerId;
    if (count > 0 && isOpen) {
      timerId = setTimeout(() => {
        setCount(count - 1);
      }, 1000);
    }
    return () => timerId && clearTimeout(timerId);
  }, [count, isOpen]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary shadow-sm">
            <Users size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">账号管理</h1>
            <p className="mt-1 text-sm text-default-500">
              当前方案共 {data?.items.length || 0} 个账号 · 当前为方案
              {activePipeline} ·
              {activePipeline === 1
                ? ' .xyz 微信读书账号'
                : ' 自有公众号后台账号'}
            </p>
          </div>
        </div>
        <Button
          onPress={() => {
            setLoginDone(false);
            onOpen();
            mutateAsync();
          }}
          size="md"
          color="primary"
          endContent={<PlusIcon />}
        >
          添加公众号账号
        </Button>
      </div>
      <Table
        aria-label="账号列表"
        classNames={{
          base: 'rounded-2xl border border-default-200 bg-content1 shadow-sm',
          th: 'text-xs uppercase tracking-wide text-default-500 py-3.5',
          td: 'py-3',
          tr: 'transition-colors hover:bg-default-50/60',
        }}
      >
        <TableHeader>
          <TableColumn>ID</TableColumn>
          <TableColumn>用户名</TableColumn>
          <TableColumn>状态</TableColumn>
          <TableColumn>方案</TableColumn>
          <TableColumn>更新时间</TableColumn>
          <TableColumn>操作</TableColumn>
        </TableHeader>
        <TableBody
          emptyContent={<div className="m-auto text-center">暂无数据</div>}
          isLoading={isFetching}
          loadingContent={<Spinner />}
        >
          {data?.items.map((item) => {
            const isBlocked = data?.blocks.includes(item.id);

            return (
              <TableRow key={item.id}>
                <TableCell>
                  <span className="font-mono text-xs text-default-500">
                    {item.id.length > 24 ? item.id.slice(0, 24) + '…' : item.id}
                  </span>
                </TableCell>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell>
                  {isBlocked ? (
                    <Chip className="capitalize" size="sm" variant="flat">
                      今日小黑屋
                    </Chip>
                  ) : (
                    <Chip
                      className="capitalize"
                      color={statusMap[item.status].color}
                      size="sm"
                      variant="flat"
                    >
                      {statusMap[item.status].label}
                    </Chip>
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    size="sm"
                    variant="flat"
                    color={item.pipeline === 2 ? 'success' : 'primary'}
                  >
                    方案{item.pipeline}
                  </Chip>
                </TableCell>
                <TableCell>
                  {dayjs(item.updatedAt).format('YYYY-MM-DD')}
                </TableCell>
                <TableCell className="flex gap-2">
                  <StatusDropdown
                    value={item.status}
                    onChange={(value) => {
                      updateAccount({
                        id: item.id,
                        data: { status: value },
                      }).then(() => {
                        toast.success('更新成功!');
                        refetch();
                      });
                    }}
                  ></StatusDropdown>

                  <Button
                    size="sm"
                    color="danger"
                    onPress={() => {
                      deleteAccount(item.id).then(() => {
                        toast.success('删除成功!');
                        refetch();
                      });
                    }}
                  >
                    删除
                  </Button>
                </TableCell>
              </TableRow>
            );
          }) || []}
        </TableBody>
      </Table>

      <Modal
        isOpen={isOpen}
        onOpenChange={async () => {
          onOpenChange();
          await queryUtils.platform.getLoginResult.cancel();
        }}
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col items-start gap-1 border-b border-default-100 pb-3">
                <span className="text-lg">添加公众号后台账号</span>
                <span className="text-xs font-normal text-default-400">
                  {activePipeline === 1
                    ? '方案1：使用微信扫码登录 .xyz 微信读书管线'
                    : '方案2：使用微信扫码登录自有公众号后台管线'}
                </span>
              </ModalHeader>
              <ModalBody>
                <div className="m-auto pb-8 text-center">
                  {loginData ? (
                    <div>
                      <div className="relative">
                        {loginResult?.message && (
                          <div className="absolute top-0 left-0 bottom-0 right-0 bg-white bg-opacity-75 flex justify-center items-center">
                            <div className="text-sm font-medium text-default-600">
                              {loginResult?.message}
                            </div>
                          </div>
                        )}
                        {loginData?.scanUrl ? (
                          <img
                            src={loginData.scanUrl}
                            width={200}
                            height={200}
                            alt="公众号后台登录二维码"
                            className="mx-auto rounded-xl border border-default-200 bg-white p-2"
                          />
                        ) : (
                          <Spinner />
                        )}
                      </div>
                      <div className="mt-4">
                        方案{activePipeline}扫码登录{' '}
                        {!loginResult?.message && count > 0 && (
                          <span className="text-red-400">({count}s)</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="m-auto flex justify-center align-middle items-center">
                      <Spinner />
                      二维码加载中
                    </div>
                  )}
                </div>
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
};

export default AccountPage;
