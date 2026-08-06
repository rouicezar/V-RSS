import { useId } from 'react';

/**
 * V-RSS 品牌 Logo
 * 绿色渐变圆角方块 + 白色 V 形（品牌首字母）+ RSS 信号弧线（订阅/汇聚）
 * size 单位 px
 */
export default function Logo({
  size = 32,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      aria-label="V-RSS"
    >
      <defs>
        <linearGradient id={`lg-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#03a055" />
          <stop offset="1" stopColor="#02723d" />
        </linearGradient>
      </defs>
      {/* 品牌绿渐变底 */}
      <rect width="48" height="48" rx="12" fill={`url(#lg-${uid})`} />
      {/* 白色 V 形 */}
      <path
        d="M13 15 L24 33 L35 15"
        stroke="#ffffff"
        strokeWidth="4.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* RSS 信号弧线（右上） */}
      <path
        d="M32.5 23.5 a8.5 8.5 0 0 1 8.5 8.5"
        stroke="#ffffff"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        opacity="0.9"
      />
      <path
        d="M35 20 a13 13 0 0 1 11 11"
        stroke="#ffffff"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}
