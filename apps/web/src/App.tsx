import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Feeds from './pages/feeds';
import Login from './pages/login';
import { BaseLayout } from './layouts/base';
import { TrpcProvider } from './provider/trpc';
import ThemeProvider from './provider/theme';

// 代码分割：重页面懒加载（首屏仅加载 Feeds/Login）
const Accounts = lazy(() => import('./pages/accounts'));
const Library = lazy(() => import('./pages/library/Library'));
const Analysis = lazy(() => import('./pages/analysis/Analysis'));

function App() {
  return (
    <BrowserRouter basename="/dash">
      <ThemeProvider>
        <TrpcProvider>
          <Suspense
            fallback={
              <div className="flex h-screen items-center justify-center">
                <div className="flex items-center gap-2 text-default-400">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-default-300 border-t-primary" />
                  <span className="text-sm">加载中...</span>
                </div>
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<BaseLayout />}>
                <Route index element={<Feeds />} />
                <Route path="/feeds/:id?" element={<Feeds />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/library" element={<Library />} />
                <Route path="/analysis" element={<Analysis />} />
                <Route path="/login" element={<Login />} />
              </Route>
            </Routes>
          </Suspense>
        </TrpcProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
