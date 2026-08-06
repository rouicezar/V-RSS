import { Toaster } from 'sonner';
import { Outlet } from 'react-router-dom';

import Nav from '../components/Nav';

export function BaseLayout() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-default-50 to-background dark:from-background dark:to-background">
      {/* 顶部装饰性光晕 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/5 to-transparent" />
      <main className="relative min-h-screen">
        <Nav></Nav>
        <div className="mx-auto w-full max-w-[1760px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
