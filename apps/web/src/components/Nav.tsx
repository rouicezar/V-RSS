import {
  Badge,
  Link,
  Navbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem,
  NavbarMenu,
  NavbarMenuItem,
  NavbarMenuToggle,
  Tooltip,
} from '@nextui-org/react';
import { ThemeSwitcher } from './ThemeSwitcher';
import Logo from './Logo';
import { useLocation } from 'react-router-dom';
import { appVersion } from '@web/utils/env';

const navbarItemLink = [
  {
    href: '/feeds',
    name: '公众号源',
  },
  {
    href: '/library',
    name: '文章库',
  },
  {
    href: '/analysis',
    name: '分析',
  },
  {
    href: '/accounts',
    name: '账号管理',
  },
];

const Nav = () => {
  const { pathname } = useLocation();

  return (
    <div className="sticky top-0 z-40">
      <Navbar
        isBordered
        maxWidth="full"
        height="4rem"
        classNames={{
          base: 'bg-background/80 backdrop-blur-md',
          wrapper: 'mx-auto w-full max-w-[1760px] px-4 sm:px-6 lg:px-8',
          brand: 'flex-1',
        }}
      >
        <Tooltip
          content={
            <div className="p-1">
              <span className="block text-medium">当前版本: v{appVersion}</span>
            </div>
          }
          placement="right"
        >
          <NavbarBrand className="cursor-default gap-2.5">
            <Logo size={34} className="shrink-0 drop-shadow-sm" />
            <div className="flex flex-col leading-none">
              <p className="text-xl font-bold tracking-tight text-foreground">
                V-RSS
              </p>
              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.18em] text-default-400">
                WeChat Reader
              </p>
            </div>
          </NavbarBrand>
        </Tooltip>

        <NavbarContent className="sm:hidden" justify="start">
          <NavbarMenuToggle aria-label="打开导航菜单" />
        </NavbarContent>

        <NavbarContent
          className="hidden gap-1 sm:flex lg:gap-1.5"
          justify="center"
        >
          {navbarItemLink.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <NavbarItem key={item.href}>
                <Link
                  href={item.href}
                  className={`rounded-full px-4 py-2 text-[15px] font-medium transition-colors ${
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-default-500 hover:bg-default-100 hover:text-foreground'
                  }`}
                >
                  {item.name}
                </Link>
              </NavbarItem>
            );
          })}
        </NavbarContent>

        <NavbarContent justify="end" className="flex-1">
          <ThemeSwitcher />
        </NavbarContent>

        <NavbarMenu className="gap-1 pt-4">
          {navbarItemLink.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <NavbarMenuItem key={item.href}>
                <Link
                  href={item.href}
                  className={`w-full rounded-xl px-4 py-2.5 text-base font-medium ${
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-default-600'
                  }`}
                >
                  {item.name}
                </Link>
              </NavbarMenuItem>
            );
          })}
        </NavbarMenu>
      </Navbar>
    </div>
  );
};

export default Nav;
