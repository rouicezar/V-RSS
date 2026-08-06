import type { Config } from 'tailwindcss';
import { nextui } from '@nextui-org/react';
import typography from '@tailwindcss/typography';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../node_modules/@nextui-org/theme/dist/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  darkMode: 'class',
  plugins: [
    nextui({
      themes: {
        light: {
          colors: {
            // V-RSS 品牌绿：替换 NextUI 默认蓝
            primary: {
              DEFAULT: '#03a055',
              foreground: '#ffffff',
              '50': '#e9faf1',
              '100': '#c8f2dd',
              '200': '#92e5bb',
              '300': '#55d695',
              '400': '#25c276',
              '500': '#03a055',
              '600': '#028a4a',
              '700': '#02723d',
              '800': '#045c34',
              '900': '#064c2d',
            },
            secondary: {
              DEFAULT: '#028a4a',
              foreground: '#ffffff',
            },
            success: {
              DEFAULT: '#03a055',
              foreground: '#ffffff',
            },
          },
        },
        dark: {
          colors: {
            primary: {
              DEFAULT: '#03a055',
              foreground: '#ffffff',
              '50': '#0a2f20',
              '100': '#0d4630',
              '200': '#126040',
              '300': '#15804f',
              '400': '#18a05f',
              '500': '#03a055',
              '600': '#2fd07e',
              '700': '#5ee3a0',
              '800': '#9df0c6',
              '900': '#d5fbe8',
            },
            secondary: {
              DEFAULT: '#028a4a',
              foreground: '#ffffff',
            },
            success: {
              DEFAULT: '#03a055',
              foreground: '#ffffff',
            },
          },
        },
      },
    }),
    typography,
  ],
};
export default config;
