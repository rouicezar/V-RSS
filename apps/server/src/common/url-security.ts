const ARTICLE_HOST = 'mp.weixin.qq.com';
const IMAGE_HOSTS = new Set([
  'mmbiz.qpic.cn',
  'mmbiz.qlogo.cn',
  'wx.qlogo.cn',
  'wx.qpic.cn',
]);

function parseHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function isWeixinArticleUrl(value: string): boolean {
  const url = parseHttpsUrl(value);
  return Boolean(
    url &&
    url.hostname === ARTICLE_HOST &&
    (url.pathname === '/s' || url.pathname.startsWith('/s/')),
  );
}

export function isWeixinImageUrl(value: string): boolean {
  const url = parseHttpsUrl(value);
  return Boolean(url && IMAGE_HOSTS.has(url.hostname));
}
