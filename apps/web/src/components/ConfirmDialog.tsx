import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@nextui-org/react';
import React from 'react';

/**
 * 统一确认对话框（NextUI 风格，替代浏览器原生 window.confirm）
 * 用法：
 *   const [open, setOpen] = useState(false);
 *   <ConfirmDialog
 *     isOpen={open}
 *     title="确认操作"
 *     message="执行后不可撤销，确定继续？"
 *     color={open ? 'danger' : 'primary'}   // 危险操作传 'danger'
 *     onConfirm={() => { setOpen(false); doSomething(); }}
 *     onClose={() => setOpen(false)}
 *   />
 */
export const ConfirmDialog: React.FC<{
  isOpen: boolean;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  color?: 'primary' | 'danger';
  isLoading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}> = ({
  isOpen,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  color = 'primary',
  isLoading = false,
  onConfirm,
  onClose,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onClose}
      size="sm"
      backdrop="blur"
      classNames={{ base: 'rounded-2xl border border-default-200 shadow-xl' }}
    >
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader className="flex-col items-start gap-1 border-b border-default-100 pb-3">
              <span className="text-lg">{title}</span>
            </ModalHeader>
            <ModalBody className="py-4 text-sm text-default-600">
              {message}
            </ModalBody>
            <ModalFooter className="border-t border-default-100 pt-3">
              <Button
                size="md"
                variant="flat"
                onPress={() => {
                  onClose();
                  close();
                }}
              >
                {cancelText}
              </Button>
              <Button
                size="md"
                color={color}
                isLoading={isLoading}
                onPress={() => {
                  onConfirm();
                }}
              >
                {confirmText}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
