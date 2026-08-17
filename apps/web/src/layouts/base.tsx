import { Toaster } from 'sonner';
import { Outlet, useLocation } from 'react-router-dom';

import Nav from '../components/Nav';

export function BaseLayout() {
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-b from-default-50 to-background dark:from-background dark:to-background">
      {/* 顶部装饰性光晕（品牌绿） */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-primary/6 via-primary/3 to-transparent" />
      {/* 页面切换过渡：路径变化时淡入上移 */}
      <main className="relative min-h-screen">
        <Nav />
        <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          <div key={pathname} className="vrss-page-enter">
            <Outlet />
          </div>
        </div>
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
