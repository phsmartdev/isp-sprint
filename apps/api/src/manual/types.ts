import type { PlaybookType } from '@isp/domain';
/** Um capítulo do Manual do sistema (vira um playbook da categoria Manual do sistema). */
export type ManualChapter = { slug: string; type: PlaybookType; title: string; description: string; keywords: string[]; src: string };
