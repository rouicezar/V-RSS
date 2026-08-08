# V-RSS 全局文字系统（Design Tokens）

> 统一所有页面的字号、字重、颜色。新页面/新组件必须遵循本规范，禁止使用未定义字号。

## 字号阶梯

| Token       | 值   | 用途                                   | 示例                                                                   |
| ----------- | ---- | -------------------------------------- | ---------------------------------------------------------------------- |
| `text-xs`   | 12px | 辅助文字：时间戳、统计数字、角标、标签 | `共 57 篇 · 第 1/6 页`、`今日请求 3/100`                               |
| `text-sm`   | 14px | 正文、描述文字、表格内容、弹窗说明     | 页面标题下的功能描述、表格行                                           |
| `text-base` | 16px | 正文强调（链接、弹窗正文）             | 二维码状态提示、导出说明                                               |
| `text-lg`   | 18px | 区块/卡片标题、弹窗标题、订阅名        | 雷达卡片标题「我的关注雷达」、弹窗「添加公众号源」                     |
| `text-2xl`  | 24px | **页面主标题**（每页顶部唯一）         | 「公众号源」「文章库」「知识分析」「账号管理」                         |
| 特殊        | —    | 仅允许以下例外                         | Nav 品牌名 `text-xl`、Nav 导航项 `text-[15px]`、弹窗文章标题 `text-xl` |

## 字重

- 页面主标题 / 区块标题：`font-bold`
- 正文 / 描述：`font-normal`（默认）
- 弱辅助：`font-normal`

## 文字颜色语义

| Token                                           | 用途                           | 示例                          |
| ----------------------------------------------- | ------------------------------ | ----------------------------- |
| `text-foreground`                               | 主文本（标题、正文核心）       | 页面标题、订阅名              |
| `text-default-600`                              | 次强调正文                     | 状态提示、重要信息            |
| `text-default-500`                              | **描述性文字**（说明一句话）   | 标题下「订阅管理 · 采集同步」 |
| `text-default-400`                              | **弱化辅助**（时间/统计/次要） | 时间戳、页数统计、版本号      |
| `text-primary`                                  | 品牌强调、可交互强调           | 高亮、链接 hover              |
| `text-danger` / `text-warning` / `text-success` | 语义状态                       | 限流警告、收藏星标            |

## 页面结构模板（统一）

```tsx
{
  /* 页面标题：2xl + 渐变图标 + 描述 */
}
<div className="flex items-center gap-3.5">
  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary shadow-sm">
    <Icon size={22} />
  </div>
  <div>
    <h1 className="text-2xl font-bold tracking-tight">页面名</h1>
    <p className="mt-1 text-sm text-default-500">功能概述</p>
  </div>
</div>;
```

## 检查清单（开发/审查时）

1. 页面主标题是否 `text-2xl font-bold`
2. 卡片标题是否 `text-lg font-bold`
3. 描述是否 `text-sm text-default-500`
4. 辅助是否 `text-xs text-default-400`
5. 无 `text-[Npx]` 非标准字号（导航 15px 除外）
6. 颜色只用上述语义，不新增随机色
