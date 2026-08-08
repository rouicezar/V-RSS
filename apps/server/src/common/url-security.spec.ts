import { isWeixinArticleUrl, isWeixinImageUrl } from './url-security';

describe('URL security helpers', () => {
  it('accepts only HTTPS Weixin article URLs', () => {
    expect(isWeixinArticleUrl('https://mp.weixin.qq.com/s/abc')).toBe(true);
    expect(isWeixinArticleUrl('https://mp.weixin.qq.com/s?__biz=x')).toBe(true);
    expect(isWeixinArticleUrl('http://mp.weixin.qq.com/s/abc')).toBe(false);
    expect(isWeixinArticleUrl('https://mp.weixin.qq.com.evil.test/s/abc')).toBe(
      false,
    );
  });

  it('accepts only known HTTPS Weixin image hosts', () => {
    expect(isWeixinImageUrl('https://mmbiz.qpic.cn/a.jpg')).toBe(true);
    expect(isWeixinImageUrl('https://wx.qlogo.cn/a.jpg')).toBe(true);
    expect(isWeixinImageUrl('https://127.0.0.1/a.jpg')).toBe(false);
    expect(isWeixinImageUrl('https://mmbiz.qpic.cn.evil.test/a.jpg')).toBe(
      false,
    );
  });
});
