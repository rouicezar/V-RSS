import { Button, Input } from '@nextui-org/react';
import { setAuthCode, isValidAuthCode } from '@web/utils/auth';
import { Lock } from 'lucide-react';
import Logo from '@web/components/Logo';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const LoginPage = () => {
  const [codeValue, setCodeValue] = useState('');

  const navigate = useNavigate();

  const handleConfirm = () => {
    if (!codeValue) {
      toast.error('请输入 AuthCode');
      return;
    }
    if (!isValidAuthCode(codeValue)) {
      toast.error('AuthCode 只能包含字母/数字/符号（不支持中文）');
      return;
    }
    setAuthCode(codeValue);
    navigate('/');
  };

  return (
    <div className="relative m-auto mt-[8vh] flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-default-200/60 bg-content1/90 px-8 pb-10 pt-8 shadow-xl backdrop-blur">
      <div className="pointer-events-none absolute -inset-x-8 -top-10 -z-10 h-40 bg-gradient-to-b from-primary/15 to-transparent blur-2xl" />
      <div className="flex flex-col items-center gap-2">
        <Logo size={60} className="drop-shadow-lg" />
        <h1 className="text-2xl font-bold tracking-tight">V-RSS</h1>
        <p className="text-xs text-default-500">
          微信公众号订阅 · 知识库管理 · AI 学习分析
        </p>
      </div>
      <Input
        value={codeValue}
        onValueChange={setCodeValue}
        label="AuthCode"
        placeholder="请输入访问授权码"
        startContent={<Lock size={14} className="text-default-400" />}
      />
      <Button
        color="primary"
        size="lg"
        onPress={handleConfirm}
        className="font-medium"
      >
        进入系统
      </Button>
    </div>
  );
};

export default LoginPage;
