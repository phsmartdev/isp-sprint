import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3333';
const port = Number(process.env.WEB_PORT ?? 5173);

/**
 * Marca da instância (VITE_BRAND, ver src/brand.ts): título da aba, ícone, cor do navegador e o atributo
 * data-brand do <html>, que escolhe as cores, os raios e as fontes de styles/tokens.css antes da primeira pintura.
 */
const brand = process.env.VITE_BRAND === 'yepnet' ? 'yepnet' : 'bkt';
const HEAD = {
  bkt: { title: 'BKT · RevOps', icon: '<link rel="icon" type="image/png" href="/brand/bkt-symbol.png" />', themeColor: '#2D3339' },
  yepnet: { title: 'Yepnet · ISP Sprint', icon: '<link rel="icon" href="/api/v1/public/brand/favicon" />', themeColor: '#081F5C' },
}[brand];

function brandHtml(): Plugin {
  return {
    name: 'isp-brand-html',
    transformIndexHtml: (html) =>
      html
        .replace('<html lang="pt-BR">', `<html lang="pt-BR" data-brand="${brand}">`)
        .replace('%BRAND_TITLE%', HEAD.title)
        .replace('%BRAND_ICON%', HEAD.icon)
        .replace('%BRAND_THEME_COLOR%', HEAD.themeColor),
  };
}

export default defineConfig({
  plugins: [react(), brandHtml()],
  define: { 'import.meta.env.VITE_BRAND': JSON.stringify(brand) },
  server: {
    port,
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  test: { environment: 'jsdom', globals: false },
} as never);
